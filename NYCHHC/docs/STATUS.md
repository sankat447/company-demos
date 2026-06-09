# STATUS — NYCHHC Predictive Workforce & Patient-Flow

> ⚠️ FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.
> Canonical state of the live deployment + every cluster mutation and how to revert.
> Last updated: 2026-06-09.

## Live URLs

- **Demo UI (frontend):** https://nychhc-frontend-nychhc-demo.apps.ai-demo.iisdemolab.click
- **Backend API:** https://nychhc-copilot-nychhc-demo.apps.ai-demo.iisdemolab.click
  (`/health`, `/api/data/*`, `/api/sched/*`, `/api/chat` SSE)
- Branch: `feature/nychhc-v1` on `github.com/sankat447/company-demos` (path `NYCHHC/`).
- Cluster: `ai-demo` OCP, AWS acct `406337554361`, `us-east-1`, SSO profile `rhoai-demo`.
  KUBECONFIG: `~/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig`.

## What's deployed (namespace `nychhc-demo`, label `demo=nychhc`)

| Component | State |
|-----------|-------|
| Frontend (static SPA — Claude paper/clay/serif, role-driven, NYC H+H logo) | ✅ Running |
| Backend (FastAPI + LangChain agent + data/scheduling APIs) | ✅ Running, `mode=live` |
| `nychhc-llm` — granite-3.1-2b vLLM on GPU (Workforce Assistant LLM) | ✅ Ready (KServe RawDeployment) |
| `noshow` / `forecast` — sklearn KServe via `nychhc-sklearn` runtime | ✅ Ready |
| Aurora schemas `workforce` + `rag` + `sched_*` (auto-seeded on backend start) | ✅ Seeded |

Functional: role-based panes (Scheduler/HR-Ops/Provider), scheduling drill-down
(new/modify/cancel via specialty→doctor→calendar), PTO impact + apply-all-auto,
dashboards/charts, Assistant chat (book/cancel/PTO/status via tools). DR-01…DR-12.

## Demo-owned AWS resources (Terraform state key `nychhc/terraform.tfstate`)

- ECR repo `nychhc/copilot` (tags: `0.1.0`/`latest` backend, `sklearn` predictor) and
  `nychhc/frontend`.
- IAM user **`nychhc-demo-s3-rw`** (long-lived key) — bucket-scoped to
  `s3://ai-demo-data-lake/models/nychhc/*`; used by the KServe storage-initializer.
- S3 model artifacts under `s3://ai-demo-data-lake/models/nychhc/{granite-2b,noshow,forecast}/`.

## Cluster mutations made (and how to revert)

| Mutation | Why | Revert |
|----------|-----|--------|
| Scaled worker MachineSet `ai-demo-fs25h-worker-us-east-1c` 1→2 | cluster CPU-saturated; app pods Pending | annotated `nychhc-demo.iisl.com/scaled-up-by=nychhc-demo`; `destroy.sh` scales back to 1 |
| Scaled GPU MachineSet `ai-demo-fs25h-gpu-demo-us-east-1a` 0→1 | granite vLLM needs the A10G | annotated likewise; `destroy.sh` scales back to 0 |
| Demo schemas/tables on shared Aurora `ai-demo-db` (db `rhoai_demo`) | demo data | `destroy.sh` drops schemas; cluster untouched |
| `nychhc-llm-predictor` Deployment `strategy: Recreate` (live patch) | single-GPU rollout deadlock | removed with the namespace on teardown |

`destroy.sh` removes ONLY demo-owned objects (ns, ArgoCD app, schemas, ECR repos,
IAM user, S3 model prefix, MachineSet scale-backs). It never touches platform state.

## Secrets bootstrapped out-of-band (not in git)

- `nychhc-aurora` — Aurora DSN from SSM `/ai-demo/aurora/*` (deploy.sh).
- `ecr-push` — ECR docker-registry creds (build push + pod pull); ~12h, refresh per deploy.
- `nychhc-s3-creds` — long-lived IAM key for the KServe S3 storage-initializer,
  annotated `serving.kserve.io/s3-*`, linked to SA `nychhc-copilot-sa`.

## Operate

```bash
export KUBECONFIG=~/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig
aws sso login --profile rhoai-demo            # ~1h session

# Rebuild after a code change (in-cluster build → ECR → rollout):
oc -n nychhc-demo create secret docker-registry ecr-push --docker-server=406337554361.dkr.ecr.us-east-1.amazonaws.com \
  --docker-username=AWS --docker-password="$(aws ecr get-login-password --profile rhoai-demo --region us-east-1)" \
  --dry-run=client -o yaml | oc apply -f -
oc -n nychhc-demo start-build nychhc-copilot  --from-dir=backend  --follow   # backend
oc -n nychhc-demo start-build nychhc-frontend --from-dir=frontend --follow   # frontend
oc -n nychhc-demo rollout restart deploy/nychhc-copilot deploy/nychhc-frontend
```

Models: `models/serving/` (sklearn predictor) builds via `oc start-build nychhc-sklearn
--from-dir=models/serving`. granite re-stage: `huggingface_hub.snapshot_download` →
`aws s3 sync` → `s3://ai-demo-data-lake/models/nychhc/<model>/`, then delete the
predictor pod to re-pull.

## Known limitations / TODO

- **granite-2b** is small: explicit asks (book/cancel/PTO) work; open-ended "status"
  questions can hallucinate numbers. Upgrade to **granite-3.1-8b** for tool-grounded
  answers (fits the A10G; ~16 GB to stage). See LESSONS_LEARNED #6.
- STS-free: `nychhc-s3-creds` is a long-lived IAM key (KServe can't use STS tokens).
- Not built: Keycloak realm (4 roles), Grafana dashboards import, n8n flows,
  `DEMO_SCRIPT.md`, full Faker seed + pgvector RAG corpus.

See **docs/LESSONS_LEARNED.md** for the full gotcha list and **docs/DEPLOYMENT.md**
for the scoped Terraform deploy/destroy design.
