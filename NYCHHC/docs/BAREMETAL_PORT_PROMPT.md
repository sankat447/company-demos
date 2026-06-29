# Build prompt — NYCHHC Predictive Workforce demo, ported to the on-prem baremetal stack

> Paste everything below the line into a fresh Claude Code session opened in
> `~/GitHub/company-demos` (so it can read both the `NYCHHC/` reference and the
> `amboy/` baremetal template). The new work lives in a new folder `NYCHHC-BareMetal/`.

---

You are an AI Solution Architect at IIS. Build a **complete, GitOps-deployable
"Predictive Hospital Workforce & Patient-Flow" agentic AI demo** for NYC Health +
Hospitals, running on our **on-prem baremetal OpenShift AI stack** — functionally
identical to the existing AWS version, but re-architected for baremetal. All work
goes in a NEW self-contained folder **`company-demos/NYCHHC-BareMetal/`**.

## Step 0 — read the two sources of truth FIRST (do not skip)

1. **Functional + UX reference (what to build):** read the existing AWS implementation
   at `company-demos/NYCHHC/` — especially `docs/FUNCTIONAL_SPEC.md` (DR-01…DR-12),
   `docs/STATUS.md`, `docs/LESSONS_LEARNED.md`, `ARCHITECTURE.md`, the backend
   (`backend/src/nychhc_copilot/` — note `agent/react.py` with the **deterministic
   intent router** `route()`, `scheduling/`, `tools/`), the frontend
   (`frontend/` static SPA + `frontend/demoer/` presenter console), `db/schema.sql`,
   and `grafana/`. This is the behavior you must reproduce **exactly**.
2. **Baremetal conventions reference (how to deploy here):** read the sibling demo
   `company-demos/amboy/` — it already runs on this exact baremetal stack. Mirror its
   conventions: `deploy.sh`/`destroy.sh` phase structure, `gitops/manifests/`
   (kustomize), `build/` BuildConfigs (internal registry), out-of-band secret
   bootstrap, standalone ArgoCD Application, scoped teardown by label, KServe-from-MinIO
   model serving, and its `docs/`/`CLAUDE.md`. Also read its `ARCHITECTURE.md`.

Reproduce **functionality from NYCHHC**, **plumbing/conventions from amboy**.

## The platform you deploy onto: `ai-demo-stack-baremetal`

Local clone: `~/GitHub/ai-demo-stack-baremetal` (repo `github.com/sankat447/ai-demo-stack-baremetal`).
You **consume** this platform; you NEVER redeploy or modify it (raise a PR if a platform
change is ever needed).

- **Cluster:** OCP 4.21, compact 3-node, **CPU-only — NO GPU**. Cluster `ocp419`,
  domain `crucible.iisl.com`. Routes: `https://<route>-<ns>.apps.ocp419.crucible.iisl.com`
  (self-signed wildcard → clients use `-k`/verify-off).
- **Cluster auth:** `export KUBECONFIG=~/GitHub/ai-demo-stack-baremetal/install/_artifacts/auth/kubeconfig`
  (the default `~/.kube` token is expired). No AWS, no SSO.
- **Fixed tiered namespaces (do NOT invent new ones):**
  `iis-ai-ai` (gateway/agents + KServe models), `iis-ai-ui` (UIs, grafana, n8n),
  `iis-ai-data` (stateful), `iis-ai-system` (vault/keycloak/mlflow).
  Deploy demo workloads into these tiers; prefix every resource `nychhc-`, label
  `demo: nychhc`. Scoped teardown deletes ONLY by `demo: nychhc` (never the shared ns).
- **Storage classes:** `ocs-storagecluster-ceph-rbd` (RWO default),
  `ocs-storagecluster-cephfs` (RWX).
- **In-stack services + creds (read/confirm from the baremetal repo's gitops/config):**
  - **Postgres + pgvector:** `iis-ai-postgres-primary.iis-ai-data.svc:5432`,
    db `rhoai_demo`, user `rhoai_admin`, pw `Demo1234#` (image `pgvector/pgvector:pg16`).
    → this REPLACES Aurora. Demo owns schemas `workforce`, `rag`, `sched_*`.
  - **MinIO (app S3):** `minio.iis-ai-data.svc:9000` (console 9001),
    `minioadmin` / `Demo1234#`. → REPLACES the S3 data lake. Use a bucket
    `nychhc-models` for KServe model artifacts.
  - **Portkey (OpenAI-compatible gateway):** `http://portkey.iis-ai-ai.svc:8787`.
    → REPLACES the GPU granite vLLM for the chat fallback (see LLM note below).
  - **Vault** (dev): `http://vault.iis-ai-system.svc:8200` token `Demo1234#`
    (optional — only if you tokenize anything; NYCHHC has no PHI so likely unused).
  - **Keycloak:** `http://keycloak.iis-ai-system.svc:8080` (only `master` realm exists;
    use dev-mode role header like amboy unless you provision a realm).
  - **MLflow:** `http://mlflow.iis-ai-system.svc:5000`. **Grafana + n8n** in `iis-ai-ui`.

## Cloud → baremetal mapping (apply this to every component)

| AWS NYCHHC (source) | Baremetal NYCHHC-BareMetal (target) |
|---|---|
| ROSA/RHOAI `ai-demo`, `*.apps.ai-demo.iisdemolab.click` | OCP `ocp419`, `*.apps.ocp419.crucible.iisl.com` |
| Aurora PostgreSQL (creds via SSM) | in-stack Postgres+pgvector `iis-ai-postgres-primary.iis-ai-data.svc:5432` |
| S3 `ai-demo-data-lake` + long-lived IAM user | in-stack MinIO `minio.iis-ai-data.svc:9000` + `nychhc-models` bucket |
| ECR + **Terraform** (deploy standard) | OpenShift **internal registry** via BuildConfig+ImageStream; **NO Terraform, NO ECR, NO IAM** — kustomize gitops + ArgoCD + deploy.sh/destroy.sh (amboy pattern) |
| GPU A10G + **granite-3.1-2b vLLM** (KServe) | **NO GPU** → chat fallback LLM via **Portkey → Claude** (`claude-sonnet-4-6`, OpenAI-compatible at `portkey.iis-ai-ai.svc:8787`); deterministic router stays primary |
| sklearn models on KServe `nychhc-sklearn` runtime (S3 storageUri) | same two sklearn models on **CPU KServe**, custom predictor image (internal registry), `storageUri` → **MinIO** (s3-compatible, KServe `serving.kserve.io/s3-*` annotations point at the MinIO endpoint); label `iis-ai-ai` `opendatahub.io/dashboard=true` so they show in the RHOAI dashboard |
| AWS SSO profile `rhoai-demo` | `KUBECONFIG=.../ai-demo-stack-baremetal/install/_artifacts/auth/kubeconfig` |
| Grafana `rhoai-monitoring` | Grafana in `iis-ai-ui` (provision NYCHHC dashboard via API; remove on destroy) |
| GPU/worker MachineSet scale-up | **none** — no GPU; cluster is fixed 3-node. Drop all MachineSet scaling. |
| namespace `nychhc-demo` | the four FIXED tiers; resources prefixed `nychhc-`, label `demo: nychhc` |

## Architecture decisions for baremetal (resolve these explicitly)

- **LLM:** The whole point of the NYCHHC **deterministic intent router** (`route()`)
  is that headline asks (doctors/openings by specialty, no-show rate by provider, unit
  status, PTO impact, cancel-by-name) are answered by calling the real scheduling
  service against Postgres and returning plain-language results — **no LLM needed**.
  Port that router verbatim. For open-ended fallback, use **Claude via Portkey**
  (`ChatOpenAI` base_url `http://portkey.iis-ai-ai.svc:8787`, model `claude-sonnet-4-6`,
  **always set `max_tokens`** — Anthropic-via-Portkey 400s without it). Make the LLM
  optional/config-driven so the demo fully works (router + rules) even with no API key.
- **Predictive models (DR-06 no-show, DR-08 forecast):** keep the two CPU sklearn
  models. Serve via KServe (custom predictor image, sklearn pinned to training version,
  joblib pulled from MinIO) OR bake into the backend — but prefer KServe-from-MinIO to
  showcase RHOAI model serving (mirror amboy `22-pii-model.yaml` + the digest-pinning
  trick). Keep the graceful **rules fallback** when a model is down.
- **Single image, multiple roles** (amboy pattern): one image with entrypoints for
  backend (FastAPI) + sklearn predictor; frontend can be its own static image.
- **Auth/roles (DR-01):** dev-mode role header (Scheduler/HR-Ops/Provider) like amboy's
  `X-Amboy-Roles`; OIDC-ready but no realm required.

## Functional scope — reproduce ALL of NYCHHC's DR-01…DR-12

Read `NYCHHC/docs/FUNCTIONAL_SPEC.md` for the authoritative list. In brief: role-based
panes (Scheduler/HR-Ops/Provider); scheduling drill-down (new/modify/cancel via
specialty → doctor → calendar → assign-to-patient); PTO impact engine (reassign/
reschedule, apply-all-auto); provider PTO request → impact; no-show risk; coverage
forecast; conversational **Workforce Assistant** that does all of the above in chat via
the deterministic router; dashboards/charts; NL → data answer. Reuse NYCHHC's data
model (`db/schema.sql` — providers/specialties/patients/appointments/PTO/risk_today)
and the **same synthetic roster** (real names like Dr. Raj Patel & Dr. Elena Sokolova
for Cardiology; Dr. Omar Haddad & Yuki Tanaka NP for Pulmonology).

## Hard constraints (carry over verbatim)

- **All data SYNTHETIC; no PHI, ever.** Fictional names, phones `555-01xx`, MRNs `SYN-xxxx`.
- **Mandatory banner on every page + every chat/API response:**
  `FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA`
  (keep an ASCII variant for HTTP headers — em-dash breaks header encoding).
- **UI = Claude "paper + clay + serif" aesthetic** (Fraunces/Inter), official NYC H+H
  logo, IIS co-brand. Port the static SPA + the `/demoer` presenter console.
- **Scoped, independent deploy/destroy:** `deploy.sh` stands the demo up on the
  baremetal platform; `destroy.sh` removes ONLY `demo: nychhc`-labeled objects and the
  demo schemas/buckets — NEVER the shared namespaces or platform services. Refuse to
  delete anything not carrying the demo label.
- **Secrets bootstrapped out-of-band** by deploy.sh into a synced-path-EXCLUDED secret
  (so ArgoCD selfHeal/prune never blanks them — police-dept/amboy lesson).
- Commit per milestone on branch `sanjeev-dev`; ArgoCD `targetRevision` defaults to
  `sanjeev-dev` (push the branch so ArgoCD can sync). Standalone Application with
  `resources-finalizer` + prune + selfHeal; does NOT edit the platform app-of-apps.

## Lessons to bake in up front (don't re-learn them)

From `NYCHHC/docs/LESSONS_LEARNED.md` and `amboy` (memory): 
1. **Deterministic router > small-model tool-calling** — port `route()`; it's the
   reason chat is reliable.
2. **Teardown race:** the ArgoCD app has `selfHeal + CreateNamespace`; **disable
   automated sync BEFORE deleting the Application**, then delete labeled resources, then
   retry — else it re-creates objects mid-teardown.
3. **ArgoCD sync-waves stall on a hung wave-N Job** — make bootstrap Jobs (pgvector
   tables, MinIO bucket) robust: set `HOME=/tmp`/`MC_CONFIG_DIR` for the `mc` job
   (arbitrary UID has no HOME) or they hang and block ALL later waves.
4. **`oc start-build --follow` does NOT fail the script on a failed build — add `--wait`.**
5. **Anthropic via Portkey requires `max_tokens` on every request.**
6. **Internal-registry `:latest` digest caching** serves stale images — pin
   Deployments/IS to the freshly-built digest (`oc get istag nychhc:latest -o
   jsonpath={.image.metadata.name}`) and `ignoreDifferences` it in the Application.
7. **`oc exec POD -- python - <<EOF` needs `-i`** or stdin isn't forwarded.
8. **KServe sometimes drops the model ClusterIP** (only headless `-predictor` remains)
   → own a stable ClusterIP Service selecting the predictor pod (amboy `22-pii-model`).
9. UBI python multi-stage `lib`→`lib64` symlink silently drops pip packages — prefer
   single-stage (memory: `feedback_ubi_python_lib_lib64_symlink_trap`).
10. Single-quote `cat <<'EOF'` for inline YAML with `$vars`; quote paths with `&`.

## Deliverables (the `NYCHHC-BareMetal/` folder)

Mirror NYCHHC's layout, adapted to amboy plumbing:
```
NYCHHC-BareMetal/
├── README.md  ARCHITECTURE.md  CLAUDE.md
├── deploy.sh  destroy.sh        # phased, scoped (amboy style); NO terraform
├── Makefile                     # build / lint / verify (kustomize build must pass)
├── scripts/lib.sh               # helpers (kubeconfig, psql-in-cluster, grafana, minio)
├── backend/                     # FastAPI + deterministic router + scheduling + tools
├── frontend/                    # Claude-styled static SPA + /demoer console
├── models/                      # train no-show + forecast; publish joblib → MinIO
├── build/                       # BuildConfigs (backend, frontend, sklearn predictor)
├── gitops/
│   ├── application.yaml         # standalone ArgoCD App (kustomize, sanjeev-dev)
│   └── manifests/               # kustomize: SA/RBAC, bootstrap jobs (pgvector,minio),
│                                #   configmap, backend, frontend, KServe IS+runtime,
│                                #   routes, sql/schema.sql
├── grafana/nychhc-dashboard.json
└── docs/  FUNCTIONAL_SPEC / DEPLOYMENT / STATUS / LESSONS_LEARNED / COMPLIANCE
```

## Milestones (commit each on `sanjeev-dev`)

- **M0 — recon:** read both reference folders + confirm baremetal service DNS/creds
  from the platform repo; write `ARCHITECTURE.md` with the mapping above. Confirm scope
  with me before building.
- **M1 — data model + synthetic seed** (Postgres schemas `workforce`/`rag`/`sched_*`,
  same roster as NYCHHC; pgvector for RAG if you keep DR-11/12 citations).
- **M2 — backend** (FastAPI; port `scheduling/` service + `tools/` + the deterministic
  `route()`; Postgres provider replacing Aurora; Portkey→Claude fallback, optional).
- **M3 — predictive models** (train no-show + forecast; publish to MinIO; CPU KServe IS
  + custom predictor image; rules fallback).
- **M4 — frontend** (Claude-styled SPA, role panes, scheduling drawer, charts, chat) +
  **/demoer** presenter console.
- **M5 — gitops** (kustomize manifests, bootstrap Jobs, standalone ArgoCD App) + Grafana
  dashboard provisioning.
- **M6 — deploy.sh/destroy.sh** (phased, scoped, secrets out-of-band, digest pinning,
  teardown-race fix) + `make verify` green offline.
- **M7 — LIVE on ocp419** (`./deploy.sh`), end-to-end smoke: role panes, scheduling
  book/cancel, PTO impact, chat headline asks return REAL data via the router, models
  Ready (or rules fallback), Grafana dashboard, demoer drives the live tab.

## Acceptance

`kustomize build NYCHHC-BareMetal/gitops/manifests` valid; `make verify` green;
`./deploy.sh` brings the whole demo up on ocp419 with **no manual steps**; `./destroy.sh`
removes only demo-owned objects and leaves the four shared namespaces + platform
services intact; the Workforce Assistant answers "Which cardiologists have openings?",
"What's the no-show rate by provider?", "Put Dr. Tanaka on PTO 6/16–6/20 and show the
impact" with real, plain-language results.

Start with **M0**: read both reference folders, confirm the baremetal service
DNS/creds against `~/GitHub/ai-demo-stack-baremetal`, and present the mapping +
milestone plan for my confirmation before writing code.
