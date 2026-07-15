# Amboy — NPI-Safe Investment & Credit Report Comparison

A bank executive uploads **two annual investment/credit reports** and gets a
trustworthy year-over-year comparison, deterministic risk flags, and an executive
summary — **without any NPI (nonpublic personal information) ever reaching the LLM,
the vector store, or the logs.**

Runs end-to-end on synthetic data on the **ai-demo-stack-baremetal** platform
(OpenShift 4.21, CPU-only, no GPU) via **one ArgoCD Application**.

```
upload 2 reports ─▶ de-identify (tokenize) ─▶ index de-id chunks + numeric facts
                         │                          │
                    Vault transit              pgvector (NPI-free)
                  token⇄ciphertext                   │
                         │                    deterministic compare/flags/scenario
                  gated reveal (npi-reveal)          │
                         ▼                    narrate-only agent ──▶ Portkey (egress)
                   append-only audit                 ▲ only verified numbers
```

## The six layers (each = one container role)

| Layer | Role (AMBOY_ROLE) | Namespace | What it does |
|---|---|---|---|
| Intake/Experience | `ui` (Streamlit) | `iis-ai-ui` | upload reports, show comparison + flags, gated reveal |
| Privacy Gateway | `deid_gateway` (FastAPI) | `iis-ai-ai` | `/ingest` tokenizes, `/detokenize` (gated), `/retrieve` |
| Deterministic engine | `metrics_engine` (FastAPI) | `iis-ai-ai` | `/compare` `/scenario` `/flag_policy` over NPI-free facts |
| Agent | `compare_agent` (LangGraph) | `iis-ai-ai` | narrates VERIFIED numbers only, via Portkey |
| Data & Keys | Postgres+pgvector, MinIO, Vault | `iis-ai-data` / `iis-ai-system` | facts, token_vault, audit, de-id chunks |
| Governance | n8n + Grafana | `iis-ai-ui` | ingest+sign-off workflow, audit dashboard |

Presidio analyzer + anonymizer run as the **official CPU images**; the gateway
calls them over HTTP. Embeddings run **locally** (MiniLM baked into the image) so
even de-identified text is never sent out to vectorize.

## Beyond the core (current build)

- **React web UI** (`web/`, route `amboy-web`) with three workflow functions:
  **Sensitive Document Intake** (de-identify a report), **Compare and Vectorize
  Documents** (comparability → accept fields → index), **AI Insights from Documents**
  (grounded chat with **report-aware suggested prompts** authored at comparability time).
- **PII/NPI detector served on OpenShift AI (KServe)** — Piiranha (DeBERTa) as
  InferenceService `amboy-pii-model`, base model in MinIO (served from S3), with a
  fine-tuned head that adds org-specific classes (e.g. ACCOUNT). `pii_model` role.
- **Model Training = an OpenShift AI Data Science Pipeline (Kubeflow Pipelines v2)** —
  the `/model-training` console submits a real DSP run (ingest→featurize→train→evaluate
  →register→deploy→smoke), tracked under **Experiments and runs**; the trained head is
  re-provisioned on KServe. See `app/pipeline/`, `gitops/manifests/24-pipeline-server.yaml`.
- **OpenShift Pipelines (Tekton)** for the non-ML functionality (`tekton/`):
  `amboy-build-deploy`, `amboy-doc-process`, `amboy-comparison`, `amboy-governance` —
  they orchestrate the existing BuildConfigs + services (reuse, not reimplement) and
  leave the model/DSP untouched. See `tekton/README.md`.
- **OpenShift AI Applications launcher tile** (`gitops/openshift-ai-tile.yaml`).

## Run it

```bash
make verify          # OFFLINE gate: privacy invariants + metrics + grounding (no cluster)
./deploy.sh          # scoped, idempotent deploy onto the baremetal cluster
make verify-cluster  # LIVE gate: ingest, /detokenize 403, prompt/NPI scan, audit rows
./demo-reset.sh      # between demos: base model, no uploads/comparisons/DSP runs (keeps pipelines)
./destroy.sh         # scoped, label-guarded teardown (never touches platform)
```

`deploy.sh` builds the images in-cluster (internal registry — no ECR), applies the
standalone ArgoCD Application (`gitops/application.yaml`), pins the freshly-built
digest, seeds the base PII model + synthetic reports into MinIO, uploads the training
pipeline to the OpenShift AI Pipeline Server, applies the Applications tile, and
applies the Tekton pipelines. Override `GIT_REVISION`, `PORTKEY_API_KEY`, `*_PASSWORD`
via env. `demo-reset.sh -y` skips the confirm prompt.

## Non-negotiable design patterns → where handled

| Pattern | Where |
|---|---|
| 1. De-identify **before** the trust boundary (Portkey egress) | `app/common/deid.py`, `deid_gateway/main.py:/ingest` |
| 2. Deterministic-first / extract-compute-narrate (LLM never computes a number) | `metrics_engine/compute.py` + `compare_agent/grounding.py` |
| 3. Reversible deterministic tokenization + gated re-ID | `common/tokenizer.py` (Vault HMAC+encrypt), `common/auth.py` (npi-reveal), `sql` token_vault + audit |
| 4. Reuse, don't add | all infra is reused platform services (`common/config.py`) |
| 5. GitOps-only, fixed namespaces, CPU-only | `gitops/` kustomize + Application; `iis-ai-*` tiers; CPU requests/limits |
| 6. Human-in-the-loop + traceability | n8n sign-off workflow; append-only `amboy.audit_log` everywhere |
| 7. Generate → validate → assemble → verify | per-milestone `make verify` + `kustomize build` gates |

## Baremetal stack constraints → where handled

| Constraint | Where |
|---|---|
| Deploy via GitOps only (App-of-Apps style) | standalone ArgoCD `Application` (prune + finalizer) |
| Fixed tiered namespaces, don't invent | every resource sets `iis-ai-{ai,ui,data,system}` |
| No GPU — CPU only | CPU-only requests/limits; MiniLM CPU; external LLM via Portkey |
| Storage classes set explicitly | demo uses reused PVCs/MinIO; no new PVCs created |
| Self-signed TLS; http east-west, edge-TLS only on UI | Service DNS http everywhere; `60-ui.yaml` edge Route only |
| No ECR | in-cluster `BuildConfig` → internal registry + cross-ns `RoleBinding` |
| SA + SCC | `amboy` SA; arbitrary-UID-safe image → default `restricted-v2` (no anyuid) |
| Secrets from Vault in prod | `amboy-creds` out-of-band Secret (deploy.sh); Vault transit for tokens |

## Privacy invariants (automated)

`tests/privacy_invariants.py` (offline) + `tests/e2e.sh` (live) assert:
no synthetic NPI in de-id objects / indexed chunks / the prompt to Portkey /
`audit_log.detail`; the agent prompt is `[ENTITY:hex]` tokens + numbers only;
`/detokenize` is 403 without `npi-reveal` and audited when 200; every figure in
the narrative also exists in the metrics-engine output (grounding check).

## Demo-vs-prod gaps (explicit)

- **Vault** runs in DEV mode (root token) on the platform — demo only.
- **Auth**: `AMBOY_AUTH_DEV_MODE=1` trusts an `X-Amboy-Roles` header instead of a
  verified Keycloak JWT (realm/clients not always provisioned). Prod path
  (`common/auth.py`) verifies the JWT against the realm JWKS.
- **MinIO SSE** needs a KMS; buckets are created and best-effort encrypted.
- Demo credentials (`Demo1234#`) match the platform defaults — replace for real use.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data-flow + trust boundary, and
[CLAUDE.md](CLAUDE.md) for the subsystem conventions.
