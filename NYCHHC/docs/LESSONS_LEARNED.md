# Lessons Learned

Captured as we build. Newest first. (Carry-over platform lessons L1–L10 live in
[ARCHITECTURE.md](../ARCHITECTURE.md#carry-over-lessons-applied-from-the-platform-build).)

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
