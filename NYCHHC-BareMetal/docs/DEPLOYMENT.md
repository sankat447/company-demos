# Deployment — NYCHHC-BareMetal

> ⚠️ FOR DEMONSTRATION ONLY — SYNTHETIC DATA.

Scoped, idempotent, self-contained deploy onto the running **ai-demo-stack-baremetal**
cluster (OCP 4.21, `ocp419.crucible.iisl.com`). No Terraform, no ECR, no GPU. The demo
creates only `demo: nychhc`-labeled objects and never modifies the platform.

## Prerequisites
- `oc`, `kubectl`, `python3.11` on PATH.
- Cluster auth — the default `~/.kube` token is expired, so:
  ```bash
  export KUBECONFIG=~/GitHub/ai-demo-stack-baremetal/install/_artifacts/auth/kubeconfig
  ```
  (`deploy.sh`/`destroy.sh` default to this path if `KUBECONFIG` is unset.)
- The four platform tiers must already exist: `iis-ai-ai`, `iis-ai-ui`, `iis-ai-data`,
  `iis-ai-system`.

## Deploy
```bash
./deploy.sh
```
Override via env: `GIT_REVISION` (ArgoCD targetRevision, default `sanjeev-dev`),
`PORTKEY_API_KEY` (enables the LLM fallback), `PG_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.

### Phases
| # | Phase | What |
|---|-------|------|
| 0 | preflight | tools + auth + namespaces; label `iis-ai-ai` `opendatahub.io/dashboard=true` |
| 1 | secrets | out-of-band `nychhc-creds` Secret (incl. URL-escaped `AURORA_DSN`) in ai/ui/data — **not** in git, so selfHeal never blanks it |
| 2 | backend build | `oc start-build nychhc --from-dir=. --follow --wait` → internal registry |
| 3 | frontend build | `oc start-build nychhc-frontend --from-dir=frontend --follow --wait` |
| 4 | ArgoCD app | apply `gitops/application.yaml` (targetRevision substituted) |
| 5 | wait sync | poll until `Synced`/`Healthy` (~10 min cap) |
| 6 | digest pin | patch the 2 KServe ISes to the freshly-built digest (ArgoCD `ignoreDifferences` keeps the pin) |
| 7 | grafana | provision the Postgres datasource + dashboard via the Grafana API |

> **Push the branch first.** ArgoCD pulls `NYCHHC-BareMetal/gitops/manifests` from
> `github.com/sankat447/company-demos` at `targetRevision`. Commit + push `sanjeev-dev`
> (or pass `GIT_REVISION`) before/while deploying or the sync has nothing to pull.

### Sync waves
`0` SA + config → `1` bootstrap Jobs (pgvector schema/seed, MinIO bucket+artifacts) →
`2` KServe models → `3` backend → `4` frontend.

## Verify
```bash
make verify         # offline: kustomize build + lint + 27 backend + 4 model tests
make verify-cluster # live: /health, /api/capabilities, scheduling reads, 3 router chat asks, SPA
```

## Teardown
```bash
./destroy.sh
```
Disables ArgoCD automated sync **first** (teardown-race fix), removes the Grafana
dashboard/datasource, deletes the Application (cascade prune), label-sweeps `demo=nychhc`
across the three tiers, removes `nychhc-creds`, drops schemas `workforce`+`rag`, and removes
the `nychhc-models` bucket. The shared namespaces and all platform services are left intact.

## Troubleshooting
- **App not Synced** — `oc -n openshift-gitops get app nychhc-demo -o yaml` (check the branch is pushed).
- **Stale image served** — the predictor is digest-pinned by Phase 6; re-run `deploy.sh` after a rebuild.
- **mc/bootstrap Job hung** — it sets `HOME=/tmp`; a hung wave-1 Job blocks later waves.
- **Models not Ready** — KServe controller can be flaky on this cluster; the backend uses the
  rules fallback automatically, so the demo still works.
- **Chat returns "rephrase"** — that's the LLM fallback with no `PORTKEY_API_KEY`; the router
  still answers the headline asks. Set `PORTKEY_API_KEY` to enable open-ended chat.
