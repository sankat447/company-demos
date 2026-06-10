# STATUS — NYCHHC Predictive Workforce & Patient-Flow

> ⚠️ FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.
> Canonical state of the deployment + every cluster mutation and how to revert.
> Last updated: 2026-06-10.

## ⏹ Current state: TORN DOWN (cost-parked)

`./destroy.sh` ran clean on 2026-06-10. **Nothing demo-owned is running** — no
namespace, no pods, no GPU node, no ECR images, no demo IAM user, no S3 model
artifacts. The platform (`ai-demo-stack-aws`) is fully intact (verified: `ai-demo`
namespace + Aurora SSM still present).

Verified torn-down inventory:

| Object | State after destroy |
|--------|---------------------|
| Namespace `nychhc-demo` (+ all workloads, IS, routes) | ❌ deleted |
| ArgoCD Application `nychhc-demo` | ❌ deleted |
| GPU MachineSet `ai-demo-fs25h-gpu-demo-us-east-1a` | ✅ restored to **0** (no GPU node billing) |
| Worker MachineSet `ai-demo-fs25h-worker-us-east-1c` | ✅ restored to **1** |
| IAM user `nychhc-demo-s3-rw` | ❌ deleted |
| S3 `s3://ai-demo-data-lake/models/nychhc/*` | ❌ emptied |
| ECR repos `nychhc/copilot`, `nychhc/frontend` (+ terraform state) | ❌ destroyed |
| Demo Aurora schemas `workforce`, `rag`, `sched_*` | ❌ dropped (cluster untouched) |
| Grafana NYCHHC dashboard + datasource + folder | ❌ removed |

## ▶ Bring it ALL back — one command

```bash
export KUBECONFIG=~/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig
cd ~/GitHub/company-demos/NYCHHC
./deploy.sh        # owns the SSO login; ~20-25 min (GPU node + first granite stage)
```

`deploy.sh` is **fully self-contained** — every step that used to be manual is now in
the script (see docs/DEPLOYMENT.md for the ordered list). On a clean platform it:
1. `terraform apply` (ECR repos, isolated state).
2. Namespace + `ecr-push` registry secret.
3. **Scales the GPU MachineSet 0→1 and worker up** (annotation-guarded; records the
   original count so destroy restores GPU→0). Done early so the node provisions while
   images build.
4. In-cluster builds backend + frontend → ECR.
5. Aurora secret (from SSM) + schema/seed.
6. **KServe S3 creds**: IAM user `nychhc-demo-s3-rw` + `nychhc-s3-creds` secret (static
   key — storage-init can't use STS) linked to the SA.
7. **Stages all models to S3**: 2 sklearn models, the **granite LLM** (`stage_llm.sh`,
   ~5 GB first time — no HF egress from the cluster), and the in-cluster **sklearn
   predictor image** build.
8. Grafana dashboard, **waits for the GPU node**, then applies the ArgoCD Application.
9. Waits for rollouts + smoke test; prints the demo URL.

> First post-teardown deploy re-downloads granite (~5 GB) to your laptop, then syncs to
> S3; later deploys skip it. Refresh the ECR token (~12h) if a re-deploy can't pull.

## URLs (recreated on deploy)

- **Demo UI:** https://nychhc-frontend-nychhc-demo.apps.ai-demo.iisdemolab.click
- **Presenter console:** …/demoer/
- **Backend API:** https://nychhc-copilot-nychhc-demo.apps.ai-demo.iisdemolab.click
  (`/health`, `/api/data/*`, `/api/sched/*`, `/api/chat` SSE)
- **Grafana:** https://grafana-rhoai-monitoring.apps.ai-demo.iisdemolab.click/d/nychhc-workforce
  (`admin`/`Demo1234#`)
- Branch: `sanjeev-dev` on `github.com/sankat447/company-demos` (path `NYCHHC/`).
  ArgoCD app pins `targetRevision: feature/nychhc-v1` (repoint to `sanjeev-dev` if desired).
- Cluster: `ai-demo` OCP, AWS acct `406337554361`, `us-east-1`, SSO profile `rhoai-demo`.
  KUBECONFIG: `~/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig`.

## What gets deployed (namespace `nychhc-demo`, label `demo=nychhc`)

| Component | Notes |
|-----------|-------|
| Frontend (static SPA — Claude paper/clay/serif, role-driven, NYC H+H logo) | static `http.server` |
| Backend (FastAPI + LangChain agent + **deterministic intent router** + data/sched APIs) | `mode=live` |
| `nychhc-llm` — granite-3.1-2b vLLM on GPU (Workforce Assistant LLM) | KServe RawDeployment, A10G |
| `noshow` / `forecast` — sklearn KServe via `nychhc-sklearn` runtime | CPU |
| Aurora schemas `workforce` + `rag` + `sched_*` (auto-seeded on backend start) | shared Aurora |

**Chat reliability:** the Workforce Assistant answers the demo's headline asks via a
**deterministic router** (`agent/react.py → route()`) that calls the real scheduling
service against Aurora and returns the actual result in plain language — so it never
depends on granite-2b's flaky tool-calling (which narrates "I'll use the X function…").
Covered: doctors/openings by specialty, no-show rate by provider, unit status, PTO
impact, cancel-by-name. Unmatched questions fall through to the LLM (output cleaned).

## Cluster mutations made by deploy (and how destroy reverts)

| Mutation | Why | Revert (destroy.sh) |
|----------|-----|---------------------|
| Scale worker MachineSet up | cluster CPU-saturated | restores recorded `prev-replicas` (→1) |
| Scale GPU MachineSet 0→1 | granite vLLM needs the A10G | restores `prev-replicas` (→0) |
| Demo schemas on shared Aurora | demo data | drops schemas; cluster untouched |
| IAM user `nychhc-demo-s3-rw` + S3 model prefix | KServe S3 pull | deletes user + empties prefix |

`destroy.sh` removes ONLY demo-owned objects. It disables the ArgoCD app's automated
sync before deleting it (so selfHeal+CreateNamespace can't re-create the namespace
mid-teardown), then retries the namespace delete, then restores MachineSets, IAM, S3,
and runs `terraform destroy`. It verifies the platform is intact at the end.

## Secrets bootstrapped out-of-band (not in git)

- `nychhc-aurora` — Aurora DSN from SSM `/ai-demo/aurora/*` (deploy.sh).
- `ecr-push` — ECR docker-registry creds (build push + pod pull); ~12h, refresh per deploy.
- `nychhc-s3-creds` — long-lived IAM key for the KServe S3 storage-initializer,
  annotated `serving.kserve.io/s3-*`, linked to SA `nychhc-copilot-sa` (deploy.sh).

## Known limitations / TODO

- **granite-2b** is small; the deterministic router covers the demo's headline asks.
  For arbitrary open-ended questions, upgrade to **granite-3.1-8b** (`HF_MODEL=…-8b
  S3_SUBDIR=granite-8b ./models/stage_llm.sh`, then point IS `nychhc-llm` storageUri +
  `--served-model-name` + memory limit ~14Gi + ConfigMap `NYCHHC_PRIMARY_MODEL`).
- STS-free: `nychhc-s3-creds` is a long-lived IAM key (KServe can't use STS tokens).
- Not built: Keycloak realm (4 roles), n8n flows, full Faker seed + pgvector RAG corpus.

See **docs/LESSONS_LEARNED.md** for the full gotcha chain and **docs/DEPLOYMENT.md**
for the scoped Terraform deploy/destroy design.
