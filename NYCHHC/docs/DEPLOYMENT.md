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

`deploy.sh` does, in order:
1. `terraform apply` — ECR repos (isolated state).
2. Create namespace `nychhc-demo` + the `ecr-push` registry secret (build push + pod pull).
3. **In-cluster builds**: `oc start-build … --from-dir` for backend + frontend
   (OpenShift BuildConfig, Docker strategy) → pushes images to ECR.
4. Bootstrap the `nychhc-aurora` Secret from SSM (not in git → ArgoCD never blanks it).
5. Apply `db/schema.sql` to the shared Aurora (schemas + minimal seed) via an
   in-cluster ephemeral psql pod (Aurora is in-VPC, unreachable from a laptop).
6. Train + publish the two models to S3 (`SKIP_MODELS=1` to skip).
7. `oc apply` the demo's ArgoCD Application → syncs `gitops/manifests`.
8. Wait for rollouts + smoke-test; print the frontend Route (demo URL).

## Destroy (demo only)

```bash
./destroy.sh
```

Drops the demo schemas → deletes the ArgoCD Application (cascade-prunes workloads)
→ deletes the namespace (label-guarded) → `terraform destroy` (ECR/IRSA) → verifies
the platform is intact.

## Notes / open items

- **Mesh mTLS (ARCHITECTURE.md D1):** if the in-cluster Portkey svc call fails after
  TLS (STRICT mesh), set `NYCHHC_PORTKEY_BASE_URL` in `gitops/manifests/20-configmap.yaml`
  to Portkey's **Route** — no code change.
- **Predictive models / n8n:** the ConfigMap leaves their URLs empty until the
  `models/` and `n8n/` steps land; the backend degrades gracefully (rules fallback,
  logged proposals) until then.
- **Image account:** the Deployment pins account `406337554361`. `deploy.sh` warns
  if the live account differs.
