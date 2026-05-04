# CLAUDE.md — Police-Department Demo Subsystem

Context primer for future Claude Code sessions in this directory.

## Hard Rules

1. **Never write to `/Users/sanjeevkumar/GitHub/ai-demo-stack-aws/`.** That is the platform repo. It is the source of truth for the cluster's existing apps. If a change there appears necessary, stop and surface it as a "Decision Needed" — do not edit.
2. **Plain YAML, not Kustomize.** ArgoCD child Applications use `directory.include` glob filters (e.g. `pd-task-*.yaml`). Match the platform pattern exactly — do not introduce `kustomization.yaml` files.
3. **`pd-` prefix on every resource name** (Deployment, Service, Route, Pipeline, Task, ConfigMap, Secret, ServingRuntime, InferenceService). Two exceptions: namespaces (`pd-cctv`, `pd-personas` — already prefixed) and `vllm-runtime` (intentionally same name as the platform's, name-collision-safe across namespaces).
4. **Two demo namespaces only**: `pd-cctv` (workloads, GPU, pipeline) and `pd-personas` (FastAPI persona service + HITL UI).
5. **GPU mutex**: every GPU-requesting workload must be Knative scale-to-zero with `maxReplicas: 1`. Read `manifests/inference/pd-qwen25-vl-7b.yaml` and `manifests/monitoring/pd-gpu-mutex-prometheusrule.yaml` before adding any GPU workload.
6. **No Vault, no Authorino policy** in the current iteration — platform doesn't have those wired. Use direct K8s `Secret` resources and unauthenticated Routes; track gaps in `docs/PLATFORM_GAPS.md`.
7. **Idempotent bootstrap scripts**: every script in `bootstrap/` must be safe to re-run.

## Key Reference Files in the Sibling Platform Repo

| Pattern | Path |
|---|---|
| App-of-Apps wiring | `ai-demo-stack-aws/gitops/apps/applications.yaml` |
| vLLM ServingRuntime | `ai-demo-stack-aws/gitops/config/inference/vllm-servingruntime.yaml` |
| KServe InferenceService | `ai-demo-stack-aws/gitops/config/inference/llama-inferenceservice.yaml` |
| Aurora init Job pattern | `ai-demo-stack-aws/gitops/jobs/pgvector-init.yaml` |

## Platform Services We Consume (do not duplicate)

- Aurora pgvector at `ai-demo-ocp-db.cluster-...rds.amazonaws.com`, db `rhoai_demo`, user `rhoai_admin` — credentials in Secret `aurora-credentials` (ns `ai-demo`)
- Portkey gateway at `http://portkey.ai-demo.svc:8787/v1/chat/completions`
- Llama 3.1 8B InferenceService `llama-3-1-8b` in ns `ai-demo`
- Redis at `redis.ai-demo.svc:6379`
- MongoDB at `mongodb.ai-demo.svc:27017`
- MLflow at `http://mlflow.rhoai-mlflow.svc:5000`
- S3 bucket `ai-demo-data-lake` (prefixes: `clips/police-department/`, `processed/police-department/`, `models/police-department/`)
- Tekton Pipelines operator (cluster-wide)
- KServe + Knative Serving (cluster-wide)

## Sync Waves Used by This Demo

| Wave | Application | Path |
|---|---|---|
| 1 | `pd-namespaces` | `manifests/namespaces` |
| 2 | `pd-aurora-schema` | `manifests/aurora` |
| 3 | `pd-inference` | `manifests/inference` |
| 4 | `pd-pipeline` | `manifests/pipeline` |
| 5 | `pd-personas` | `manifests/personas` |
| 6 | `pd-hitl` | `manifests/hitl` |
| 7 | `pd-monitoring` | `manifests/monitoring` |

## Local Validation (run before commit)

```bash
# Plain YAML lint
find police-department/manifests police-department/argocd -name '*.yaml' -print0 \
  | xargs -0 -n1 oc apply --dry-run=client -f

# Shell scripts
shellcheck police-department/bootstrap/*.sh police-department/bootstrap/lib/*.sh \
  police-department/tests/e2e/*.sh

# SQL syntax (Postgres-specific psql --single-transaction)
# (manual — only when you have psql with Aurora reachable)
```
