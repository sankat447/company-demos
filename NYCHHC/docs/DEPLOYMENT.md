# Deployment — scoped, on top of `ai-demo-stack-aws`

> ⚠️ FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.

Terraform is the deployment standard (mirrors the platform repo). The demo **stands
on** the existing `ai-demo-stack-aws` platform and creates **only demo-owned
objects**. `deploy.sh` brings it up; `destroy.sh` removes it without touching the
platform.

## Independence guarantees

| Concern | How it's scoped |
|---------|-----------------|
| **Terraform state** | Own key `nychhc/terraform.tfstate` in the shared bucket `ai-demo-stack-tfstate`. `terraform destroy` can only ever see demo resources. |
| **AWS resources** | Only an **ECR repo** `nychhc/copilot` (+ optional IRSA, off by default). Tagged `Project=nychhc, demo=nychhc, CostCenter=IIS-NYCHHC-DEMO`. |
| **Database** | Reuses the platform Aurora **cluster**, but owns only schemas `workforce` + `rag`. Teardown drops the schemas; the cluster is untouched. |
| **OpenShift** | Own namespace `nychhc-demo` (label `demo=nychhc`), own ArgoCD Application `nychhc-demo`. No edit to the platform app-of-apps. |
| **Platform reads** | SSM `/ai-demo/aurora/*`, VPC, OIDC — all via read-only data sources. Never managed. |

`destroy.sh` refuses to delete the namespace unless it carries `demo=nychhc`, and
verifies the platform Aurora SSM + `ai-demo` namespace still exist afterward.

## Prerequisites

- `aws`, `terraform` (≥1.7), `oc`, `jq` on PATH. **No local docker/podman needed** —
  images build in-cluster via OpenShift BuildConfig.
- AWS SSO profile **`rhoai-demo`** (`aws sso login --profile rhoai-demo`).
- `KUBECONFIG` pointing at the `ai-demo` cluster (`oc whoami` works).
- The branch must be **pushed to GitHub** — ArgoCD pulls manifests from
  `sankat447/company-demos` at `targetRevision: feature/nychhc-v1`.
- Platform must be up (Aurora SSM params present, Portkey reachable).

## Deploy

```bash
cd company-demos/NYCHHC
cp terraform/terraform.tfvars.example terraform/terraform.tfvars   # optional; defaults are fine
./deploy.sh
```

`deploy.sh` is **fully self-contained** — a single run on a clean platform brings
the entire demo up with no manual steps. In order:
1. `terraform apply` — ECR repos (isolated state).
2. Create namespace `nychhc-demo` + the `ecr-push` registry secret (build push + pod pull).
2b. **Scale up compute** (guarded): GPU MachineSet `0→1` (granite needs an A10G) and
   a worker MachineSet up for CPU headroom. Records each set's **original** replica
   count in an annotation so `destroy.sh` restores it exactly (GPU back to `0`).
   Done early so the GPU node (~8–10 min to join + load the NVIDIA driver) provisions
   while images build.
3. **In-cluster builds**: `oc start-build … --from-dir` for backend + frontend
   (OpenShift BuildConfig, Docker strategy) → pushes images to ECR.
4. Bootstrap the `nychhc-aurora` Secret from SSM (not in git → ArgoCD never blanks it).
5. Apply `db/schema.sql` to the shared Aurora (schemas + seed) via an in-cluster
   ephemeral psql pod (Aurora is in-VPC, unreachable from a laptop).
6. **KServe S3 pull creds**: create the long-lived IAM user `nychhc-demo-s3-rw`
   (read-only, `models/nychhc/*`), mint a static key into secret `nychhc-s3-creds`
   (with `serving.kserve.io/s3-*` annotations), and link it to the SA. KServe's
   storage-initializer **cannot use STS** session tokens, so a static key is required.
6a. **Stage all model artifacts to S3** (`SKIP_MODELS=1` to skip): train+upload the
   two sklearn models, stage the **granite LLM** (`models/stage_llm.sh` — idempotent,
   ~5 GB first time; the cluster has no HuggingFace egress so the model must come
   from S3), and run the in-cluster build of the **sklearn predictor image**
   (`nychhc-sklearn` runtime used by the noshow/forecast InferenceServices).
6b. Provision the NYCHHC Grafana dashboard + datasource (scoped).
6c. **Wait for the GPU node** to expose `nvidia.com/gpu` before the LLM IS syncs.
7. `oc apply` the demo's ArgoCD Application → syncs `gitops/manifests` (backend,
   frontend, the 3 KServe InferenceServices + 2 ServingRuntimes).
8. Wait for rollouts + smoke-test; print the frontend Route (demo URL).

> First post-teardown deploy re-downloads granite (~5 GB) to your laptop then syncs
> it to S3; later runs skip it (the artifact is already in S3). `huggingface_hub` is
> pip-installed on demand by `models/stage_llm.sh`.

## Destroy (demo only)

```bash
./destroy.sh
```

Drops the demo schemas → removes the Grafana dashboard/datasource → deletes the
ArgoCD Application (cascade-prunes workloads) → deletes the namespace (label-guarded)
→ **restores scaled MachineSets to their recorded originals** (GPU→0, worker→1, so
no demo compute is left running) → deletes the `nychhc-demo-s3-rw` IAM user + the
`models/nychhc/*` S3 artifacts → `terraform destroy` (ECR/IRSA) → verifies the
platform is intact. Removes **only** demo-owned objects.

## Notes / open items

- **Mesh mTLS (ARCHITECTURE.md D1):** if the in-cluster Portkey svc call fails after
  TLS (STRICT mesh), set `NYCHHC_PORTKEY_BASE_URL` in `gitops/manifests/20-configmap.yaml`
  to Portkey's **Route** — no code change.
- **Predictive models / n8n:** the ConfigMap leaves their URLs empty until the
  `models/` and `n8n/` steps land; the backend degrades gracefully (rules fallback,
  logged proposals) until then.
- **Image account:** the Deployment pins account `406337554361`. `deploy.sh` warns
  if the live account differs.
