# Lessons Learned

Captured as we build. Newest first. (Carry-over platform lessons L1–L10 live in
[ARCHITECTURE.md](../ARCHITECTURE.md#carry-over-lessons-applied-from-the-platform-build).)

---

## Live GPU/model serving on RHOAI — the bring-up gotchas (2026-06-09)

Getting the granite LLM + the two sklearn models serving on the `ai-demo` cluster
hit a chain of real platform traps. In order:

1. **Cluster pods have NO egress to huggingface.co.** vLLM crashed with
   `OSError: couldn't connect to huggingface.co`. Models must be **staged in S3**
   (the platform's own pattern) and pulled by the KServe storage-initializer. We
   download on a laptop (`huggingface_hub.snapshot_download`) → `aws s3 sync` →
   `s3://ai-demo-data-lake/models/nychhc/<model>/`. *(`huggingface-cli download`
   is deprecated → no-ops with a help dump; use `snapshot_download`.)*
2. **KServe storage-initializer doesn't pass STS session tokens.** Temp SSO creds
   (`ASIA…`) → `InvalidAccessKeyId`. Fix: a **long-lived, bucket-scoped IAM user**
   (`nychhc-demo-s3-rw`, the police-department pattern) in the KServe S3 secret
   (`nychhc-s3-creds`, annotated `serving.kserve.io/s3-*`, linked to the predictor SA).
3. **Single-GPU rolling-update deadlock.** A new IS revision can't schedule because
   the old (crashing) pod still holds the one GPU; Deployment keeps both
   ReplicaSets at 1. Fix: delete the **stale ReplicaSet** + set the predictor
   Deployment `strategy: Recreate` (KServe may re-reconcile, so deleting the old RS
   is the reliable unblock). GPU time-slicing shows `allocatable=4` vGPU.
4. **KServe RawDeployment predictor Service is HEADLESS (`clusterIP: None`).** The
   `80→8080` port mapping does NOT apply — the DNS name resolves straight to the pod,
   so callers must hit **`:8080`**, not `:80` (we got `Connection refused` on 80).
5. **vLLM tool-calling is off by default.** The agent's function-calling failed with
   `"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser`.
   Add `--enable-auto-tool-choice --tool-call-parser granite` to the IS args.
6. **A 2B model is too weak for open-ended agentic chat.** `granite-3.1-2b` follows
   "use a table" but not "call the tool" — it *narrates* the call ("I'll use the
   find_doctors function, here's the SQL…"), hallucinates plausible numbers, and
   role-plays a whole fake user/assistant transcript with JSON. Mitigations that only
   cleaned the *format*: `stop=["\nuser:", …]`, `max_tokens` cap, a strict "answer
   only this turn" prompt, and a `_clean()` that truncates at the first fabricated
   turn + strips `<tool_call>`/JSON/code-fence/apology artifacts.
   **The fix that actually grounds answers = a deterministic intent router**
   (`agent/react.py → route()`) that runs **before** the LLM: for the demo's headline
   asks (doctors/openings by specialty, no-show rate by provider, unit status, PTO
   impact, cancel-by-name) it calls the real scheduling service against Aurora and
   returns the actual result in plain language — so the answer never depends on the
   small model's flaky tool-calling. Unmatched questions still fall through to the LLM
   agent (cleaned). A larger model (8B) remains the durable upgrade for arbitrary
   open-ended questions the router doesn't cover.
7. **The cluster ships NO sklearn ServingRuntime** (RHOAI 2.25 has only vLLM
   runtimes). The two `modelFormat: sklearn` IS had no runtime → "Failed", zero pods.
   Fix: our own **`nychhc-sklearn` ServingRuntime** — a tiny FastAPI KServe-v1
   predictor with **sklearn pinned to the training version (1.9)** and the joblibs
   **baked into the image** (no version-skew, no S3 at runtime).
8. **sklearn joblib version skew** breaks unpickling server-side → always serve with
   the exact training sklearn version (bake it).
9. **Mesh STRICT mTLS** blocks a non-mesh pod calling a mesh svc (`portkey.ai-demo.svc`)
   → use the **Route**; but the Route's self-signed ingress cert needs
   `NYCHHC_PORTKEY_VERIFY_SSL=false`. (We ultimately serve our own in-namespace vLLM.)
10. **Platform Portkey is the headless OSS gateway with no provider config** → returns
    `400 x-portkey-provider required`; even Open WebUI isn't actually wired to it. We
    serve our own granite vLLM rather than depend on it.
11. **Cluster runs CPU-hot** → scaled a worker MachineSet +1 (annotation-guarded
    `nychhc-demo.iisl.com/scaled-up-by=nychhc-demo`; `destroy.sh` reverts it).
12. **In-cluster builds, no local docker.** OpenShift BuildConfig (binary,
    `oc start-build --from-dir`) → ECR. ECR token ~12h → refresh each deploy.
    `.dockerignore` must exclude `.venv` (don't upload 100s of MB).
13. **ConfigMap change needs a pod restart** — ArgoCD won't roll the Deployment on a
    ConfigMap edit; `oc rollout restart` after applying.
14. **Make `deploy.sh` carry every "bring-up gotcha" so it's reproducible.** The first
    bring-up did GPU/worker scale-up, the `nychhc-s3-creds` IAM user + secret, granite
    staging to S3, and the sklearn predictor build all **by hand** — none were in
    `deploy.sh`, so a torn-down demo would NOT come back with one command. Folded all
    of them into `deploy.sh`/`scripts/lib.sh` (`cluster_scale_up`, `ensure_s3_creds`,
    `models/stage_llm.sh`, `build_sklearn_runtime`, `wait_for_gpu`). Lesson: a demo
    isn't "deployable" until a single `deploy.sh` on a *clean* platform reproduces it.
15. **Record the ORIGINAL replica count before scaling a shared MachineSet.** Teardown
    must restore the GPU set to **0**, not blindly to 1 — otherwise a GPU node is left
    running and billing. `deploy.sh` stamps `nychhc-demo.iisl.com/prev-replicas=<n>`
    at scale-up; `destroy.sh` scales back to that (fallback: GPU→0, worker→1).

---

## Design phase

- **Reference diagram redefined the demo.** The original brief speced a clinical
  "diagnosis co-pilot"; the attached architecture SVG is a **workforce / patient-flow**
  agentic demo (Reqs 4.1–4.4). Always reconcile the brief against the actual diagram
  before designing — they diverged here.
- **Framework is LangChain, not LangGraph.** Diagram specifies LangChain ReAct /
  function-calling. Don't bring LangGraph in just because the brief mentioned it.
- **MCP server is net-new (`+add` P1).** The single auditable tool surface
  (Aurora / KServe / n8n) is something we build, not consume.
- **Stay outside the service mesh** for `nychhc-demo` unless mTLS is needed — avoids
  the L2 `maistra.io/expose-route` Route-timeout trap entirely.

## Backend scaffold

- **HTTP headers are latin-1; the disclaimer's em-dashes (`—`, U+2014) break header
  encoding.** Putting `DISCLAIMER` in an `X-Demo-Disclaimer` response header raised
  `UnicodeEncodeError`. Fix: keep the canonical em-dash text in JSON/SSE bodies, use
  an ASCII `DISCLAIMER_ASCII` (hyphens) for any header. (`disclaimer.py`)
- **SSE tokenization in tests:** the echo copilot streams word-by-word, so a phrase
  is split across `event: token` frames. Assert against the *reconstructed* answer
  (parse token events), not the raw SSE text.

## Live agent layer (LangChain 1.x)

- **Docstring-by-concatenation isn't a docstring.** `def f(): "lit" + VAR` leaves
  `f.__doc__` = None, so both `StructuredTool.from_function` and FastMCP `@tool`
  raise "Function must have a docstring." Use a literal docstring and pass the
  dynamic schema text via the tool's `description=` instead. (Hit it twice.)
- **LangChain 1.0 moved the agent factory.** `langgraph.prebuilt.create_react_agent`
  is deprecated → use `from langchain.agents import create_agent`.
- **Testing the ReAct loop offline** needs a model with `bind_tools`.
  `GenericFakeChatModel` lacks it (and chokes on empty-content tool-call turns).
  A tiny `BaseChatModel` subclass that scripts `AIMessage`s and returns `self` from
  `bind_tools` drives a *real* tool call through `create_agent` with no LLM. See
  `tests/test_agent.py`.
- **Stream only `AIMessage` chunks** from `astream(stream_mode="messages")` — skip
  empty (tool-call) turns and `ToolMessage`s so tool output doesn't leak to the user.
- **Demo-data realism:** required-staff must equal the *normal roster*, not a
  census/ratio formula — otherwise every day reads "understaffed" and the
  "next Tuesday specifically" beat collapses. Engineer exactly one gap.

## Predictive models (DR-06/08)

- **A KServe model can't resolve `appt_id`→features.** The serving model only sees
  the vector it's POSTed. So `LiveModels` fetches features from Aurora first, then
  sends vectors — and the training feature order (`models/common.NOSHOW_FEATURES`)
  is a hard contract with the client's vector assembly.
- **Serve plain sklearn regressors, no custom pickled classes.** A custom wrapper
  class would need to be importable in the serving image (fragile). Training a
  regressor on the 0/1 no-show label gives a probability-like `.predict` natively.
- **sklearn version skew breaks unpickling server-side.** Train with the same
  sklearn the KServe runtime ships, or the joblib won't load. Pin in CI.
- **RawDeployment, not Knative serverless, for our KServe models.** Avoids the PD
  Knative-revision-thrash + mesh-mTLS issues in a non-mesh namespace; predictor svc
  is a plain ClusterIP `{name}-predictor`.

## Deployment (Terraform, scoped to demo)

- **Verify SSM paths against the module, not an agent summary.** An exploration of
  `ai-demo-stack-aws` reported Aurora at `/ai/aurora/*`; the actual module uses
  `ssm_path_prefix = local.name = "${project_name}-${environment}"` = **`ai-demo`**,
  so the real path is **`/ai-demo/aurora/endpoint`** (matches the original brief L7).
  One grep of `modules/aurora-serverless/main.tf` settled it. Always confirm
  load-bearing infra facts at the source.
- **Platform GitOps is raw-YAML app-of-apps, NOT kustomize.** Matched that — dropped
  the kustomize tree; the demo is plain manifests + one standalone ArgoCD Application.
- **Isolated TF state = safe scoped destroy.** Demo uses its own state key
  `nychhc/terraform.tfstate` in the shared bucket, reads platform values via data
  sources, and never creates a second OIDC provider (references the existing one).
  `terraform destroy` then physically cannot see platform resources.
- **Don't put bootstrapped Secrets in the ArgoCD path.** A Secret created out-of-band
  by `deploy.sh` (no ArgoCD tracking label) won't be pruned/blanked by selfHeal —
  cleaner than the PD re-stamp dance.
- **Aurora is in-VPC** — unreachable from a laptop. Run schema/seed SQL from an
  in-cluster ephemeral psql pod (`oc run ... --image=rhel9/postgresql-16`).

## Platform parity — inherit from police-department (AWS + OpenShift host)

This demo deploys onto the same `ai-demo` OCP cluster, mirroring the
police-department demo's conventions. Carry these from day 1:

- **No GPU for NYCHHC's own pods.** LLM reasoning uses the platform's existing
  GPU-served `llama-3-1-8b` via Portkey. Our two net-new KServe models (DR-06/08)
  are small **CPU sklearn/XGBoost** — no g5/A10G, no time-slicing, no GPU mutex.
- **Mesh STRICT mTLS trap (PD lesson #49/#50).** Cluster mesh default is STRICT
  mTLS. A non-mesh pod calling a mesh service (e.g. `portkey.ai-demo.svc`) can fail
  *after* TLS. Resolution options: call Portkey via its **Route (HTTPS)**; or request
  a **PERMISSIVE PeerAuthentication** on Portkey (platform PR); or **join the mesh**
  (then add `maistra.io/expose-route` per L2). **Open — see ARCHITECTURE.md D1.**
- **Aurora secret is bootstrapped, not committed.** SSM `/ai-demo/aurora/*` →
  `aurora-credentials`-style Secret. ArgoCD blanks it on sync (git source has empty
  values); annotate `argocd.argoproj.io/sync-options=Prune=false` and re-stamp from
  SSM in `01_secrets.sh`. DB `rhoai_demo`, user `rhoai_admin`. Our schemas:
  `workforce`, `rag`.
- **S3 = long-lived IAM, not 1h STS.** PD switched to an IAM user after STS-expiry
  pain. Provision `nychhc-demo-s3-rw` scoped to `s3://ai-demo-data-lake/` prefixes
  (`models/nychhc/`, `processed/nychhc/`). Stamp into a Secret, `Prune=false`.
- **ArgoCD:** apps pin `targetRevision: feature/nychhc-v1`; set `selfHeal=false` on
  the inference app so live patches aren't reverted (PD commit 66e61c5).
- **Image tag trap:** OpenShift BuildConfig outputs `:latest` but Deployments often
  pin a tag → new builds don't roll out. Use `image: …:latest` + `imagePullPolicy:
  Always`, or pin consistently.
- **Avoid `quay.io/modh/vllm:rhoai-2.16`** (404). N/A for us (we don't serve vLLM),
  but relevant if we ever add a ServingRuntime — use a current `rhoai-2.25.x` tag.

<!-- Append new gotchas here as they happen, immediately. -->
