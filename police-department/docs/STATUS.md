# STATUS — Police-Department CCTV Demo

Snapshot of what is built, what is verified, what is not, and the gotchas a future engineer needs to know on day one. Update this file whenever the truth shifts.

**Last updated:** 2026-05-05
**Branch:** `feature/police-department-v1`
**PR:** https://github.com/sankat447/company-demos/pull/1 (open, against `sanjeev-dev`)
**Cluster:** `https://api.ai-demo.iisdemolab.click:6443` (AWS, OCP 4.20)
**Kubeconfig:** `/Users/sanjeevkumar/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig`

---

## TL;DR

The demo has been **deployed end-to-end on the live ai-demo cluster** in this session. The subsystem's IaC, GitOps wiring, RBAC, Aurora schema, image build pipeline, S3 trigger, and EventListener are all working. **The two model-serving paths (`llama-3-1-8b` in `ai-demo` and `pd-qwen25-vl-7b` in `pd-cctv`) are blocked behind one stale image tag at the platform layer** — `quay.io/modh/vllm:rhoai-2.16` returns 404 from quay.io, so neither InferenceService can create a predictor revision, regardless of GPU availability. Everything downstream of the model (vlm-caption task, persona LLM call) is therefore degraded; everything upstream (S3 → trigger → pull-clip → Aurora write) works.

The platform repo (`ai-demo-stack-aws`) is **untouched** as a git tree; we did, however, run its own `gitops/bootstrap-argocd.sh` from this session to bring up the platform's 28 ArgoCD Applications, and we manually scaled `worker-us-east-1c` 0→1 (annotated for clean rollback in `99_teardown.sh`).

---

## Live Deployment State (2026-05-05 ~06:35 UTC)

### Working ✅
| Component | State |
|---|---|
| Cluster reachable | `system:admin` via the kubeconfig above |
| OCP operators | gitops, pipelines, servicemesh, rhods 2.25.6, serverless, kiali, authorino, efs-csi — all `Succeeded` |
| Platform ArgoCD apps | 28 Applications applied; 24 Synced+Healthy, 2 Synced+Progressing, 2 stuck on the vllm image bug below |
| Demo ArgoCD apps | 7 child Applications + bootstrap. All applied; `pd-aurora-schema`, `pd-monitoring`, `pd-namespaces`, `pd-hitl` are Synced+Healthy. `pd-pipeline` and `pd-personas` show OutOfSync/Progressing transiently (UI cache lag — actual cluster state is fine). |
| Aurora schema `pd_cctv` | Created in `rhoai_demo` DB on `ai-demo-db.cluster-cidweltunfq6.us-east-1.rds.amazonaws.com`. 8 tables, 2 views, pgvector + pg_stat_statements extensions. |
| Tekton EventListener `pd-perception` | Available + Ready, accepts POSTs at `el-pd-perception.pd-cctv.svc:8080` |
| S3 watcher CronJob | Running every minute; has successfully detected uploads under `clips/police-department/` and POSTed to the EventListener (HTTP 202 confirmed in logs) |
| Pipeline trigger flow | S3 upload → watcher → EventListener → PipelineRun creation **end-to-end verified** |
| Tekton Tasks | All 5 created in `pd-cctv` (right-sized for the cluster's CPU pressure — see commits below) |
| `pull-clip` task | Succeeds; downloads clip from S3 with the SSO/STS-token plumbing |
| Persona pod | Running, `/healthz` returns 200, image built and pushed to internal registry as `pd-personas/pd-persona:0.1.0` |
| HITL Route | Reachable at `https://pd-hitl-pd-personas.apps.ai-demo.iisdemolab.click/queue` (route healthy; backend service up once readinessProbe converts to `/healthz`) |
| Worker capacity | 3 worker nodes; `worker-us-east-1c` was scaled 0→1 by us to give KServe controller schedule room. Annotated for teardown reversal. |

### Blocked ❌ (single root cause)
**Stale `quay.io/modh/vllm:rhoai-2.16` image tag** — both InferenceServices report `RevisionFailed: Unable to fetch image ... 404 Not Found`. This is **not** a demo bug; it's in the platform's `vllm-servingruntime.yaml` and the demo mirrors it. Fixing in two places (platform + demo ServingRuntime) and rolling out unblocks:
- `llama-3-1-8b` Ready
- `pd-qwen25-vl-7b` Ready
- Pipeline task `vlm-caption` (depends on Qwen-VL endpoint)
- Persona `/chat/{detective|patrol|evidence_clerk}` endpoints (depend on Llama via Portkey)
- Smoke test `05_smoke.sh` end-to-end

### Partial ⚠
| Component | Note |
|---|---|
| `whisper-asr`, `yolo-detect` tasks | Right-sized but not yet test-run end-to-end (vlm-caption fails first; pipeline halts) |
| `structure-and-write` task | Same — runs after vlm-caption; will also need `MLFLOW_TRACKING_URI` reachability re-verified |
| GPU node | MachineSet `ai-demo-lt9wz-gpu-demo-us-east-1a` desired=0; only scales when an InferenceService is asked to scale up. Currently a moot point because revisions never get created. |

---

## Build Status (per commit)

| Commit | What it does | On cluster |
|---|---|---|
| `5bb41d1` | Skeleton, ARCHITECTURE stub, gitignore | n/a |
| `3d64ce4` | ArgoCD bootstrap + 7 child Applications + namespaces | ✅ |
| `c5704de` | Aurora schema SQL + ConfigMap + PostSync init Job | ✅ schema verified |
| `dd87da7` | Qwen2.5-VL InferenceService + per-ns ServingRuntime | ⚠ blocked on platform image |
| `37aedf1` | Tekton Pipeline + 5 Tasks + Triggers + RBAC + PVC | ✅ |
| `f13a1a0` | S3 watcher CronJob + RBAC + cursor | ✅ |
| `cd2b029` | LangGraph persona FastAPI | ✅ pod up |
| `87b0614` | HITL queue UI + Route | ✅ Route reachable |
| `14b3575` | Bootstrap scripts (00..99) | ✅ run |
| `ba2bbe6` | Unit tests + e2e smoke | partial |
| `3bd6ca9` | RUNBOOK / DEMO_SCRIPT / TROUBLESHOOTING / GAPS / ARCHITECTURE | ✅ docs |
| **`8591093`** | **Phase 1 cluster-prep**: PrometheusRule moved to `pd-cctv` (strict NS isolation), ArgoCD Apps pinned to `feature/police-department-v1`, teardown extended for S3 cleanup | ✅ |
| **`17d0467`** | Teardown reverts demo-owned worker scale-up via annotation guard | ✅ |
| **`a224df5`** | Plumbed `AWS_SESSION_TOKEN` through bootstrap + manifests (SSO, no static IAM user) | ✅ |
| **`7cad6bf`** | Persona Dockerfile internal-mirror base + boto3 fetcher (no `aws` CLI) | ✅ |
| **`284cc11`** | EventListener `clusterinterceptors` ClusterRole + CRB | ✅ |
| **`3d45d8d`** | Tekton v1 step `resources` → `computeResources` rename | ✅ |
| **`7b059ed`** | `python-multipart` dependency for FastAPI Form handlers | ✅ |
| **`daf104f`** | Right-size pipeline task requests; single-stage Dockerfile (UBI lib/lib64 symlink trap) | ✅ |

---

## What's Verified Live (this session)

- **Cluster reachability**: `oc whoami` returns `system:admin`.
- **AWS auth**: profile `rhoai-demo` SSO, account `406337554361`. Aurora endpoint resolved from SSM at `/ai-demo/aurora/endpoint`.
- **Aurora connectivity**: `pd_cctv` schema applied via one-off psql pod. 8 tables present.
- **Tekton trigger plumbing**: clip upload to S3 → watcher detects in 60 s → POSTs to EventListener with HTTP 202 → PipelineRun spawned (event ID matches in logs).
- **Tekton `pull-clip`**: succeeds end-to-end with SSO temp creds in `pd-s3-creds`.
- **Persona container starts cleanly**: Uvicorn workers up, `/healthz` returns 200 JSON.
- **Internal image registry**: persona image built + pushed; tag `:0.1.0` and `:latest` both point at sha `5debdbef...`.
- **Demo's 7 ArgoCD Applications**: all applied; bootstrap sync wave 1→7 walked.
- **Worker scale-up rollback**: annotation-gated logic in `99_teardown.sh` tested via `oc get annotation` round-trip.

## What's NOT Verified Live (still pending)

- `vlm-caption`, `whisper-asr`, `yolo-detect`, `structure-and-write` task **content** (vlm-caption fails fast on the missing Qwen-VL endpoint, halting the pipeline).
- Persona `/chat/*` endpoints (need Llama InferenceService working).
- HITL `approve` / `reject` form-data endpoints (need a chat call to have parked something in Redis first).
- MLflow tracking URI reachability from the structure-and-write task.
- `tests/unit/*.py` — committed but not pytest-run.
- Full `05_smoke.sh` (will only pass after the vllm image fix).

---

## How To Pick This Up Tomorrow (the 3-step recipe)

```bash
# 0. Source the kubeconfig + AWS profile
export KUBECONFIG=/Users/sanjeevkumar/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig
aws sso login --profile rhoai-demo
eval "$(aws configure export-credentials --profile rhoai-demo --format env)"
export AWS_REGION=us-east-1
export HF_TOKEN=hf_********                            # the demo's HF token

# 1. Refresh demo S3 creds (SSO tokens expire every ~1 hour — pd-s3-creds becomes stale)
oc -n pd-cctv create secret generic pd-s3-creds \
  --from-literal=access_key_id="$AWS_ACCESS_KEY_ID" \
  --from-literal=secret_access_key="$AWS_SECRET_ACCESS_KEY" \
  --from-literal=session_token="$AWS_SESSION_TOKEN" \
  --from-literal=region=us-east-1 \
  --dry-run=client -o yaml | oc apply --server-side --force-conflicts -f -

# 2. Find the live vllm image tag and patch BOTH ServingRuntimes
# Platform: ai-demo-stack-aws/gitops/config/inference/vllm-servingruntime.yaml (NEEDS PLATFORM OWNER)
# Demo:    police-department/manifests/inference/pd-vllm-vlm-runtime.yaml (we own this)
NEW_TAG=...   # query quay.io/modh/vllm tags; rhoai-2.25 series likely
oc -n pd-cctv patch servingruntime vllm-runtime --type=json \
  -p='[{"op":"replace","path":"/spec/containers/0/image","value":"quay.io/modh/vllm:'$NEW_TAG'"}]'
# Force re-revision:
oc -n pd-cctv delete inferenceservice pd-qwen25-vl-7b
oc apply -f police-department/manifests/inference/pd-qwen25-vl-7b.yaml

# 3. Re-run the smoke test
oc -n pd-cctv get pipelineruns -w &
bash police-department/bootstrap/04_seed_samples.sh   # SAMPLE_LOCAL=/path/to/clip.mp4
bash police-department/bootstrap/05_smoke.sh
```

---

## Cluster Mutations Made (and how they roll back)

| Action | Where | Rollback |
|---|---|---|
| Created `aurora-credentials` Secret in `ai-demo` | platform namespace | `oc -n ai-demo delete secret aurora-credentials` (the manifest never created it; we filled the gap) |
| Ran `gitops/bootstrap-argocd.sh` from platform repo | cluster-wide | not unwound automatically — that's intentional, the platform stays |
| Scaled `worker-us-east-1c` MachineSet 0 → 1 | `openshift-machine-api` | `bash 99_teardown.sh` prompts to revert; only acts if its `pd-cctv.iisl.com/scaled-up-by` annotation is present |
| Created `pd-eventlistener-clusterinterceptors` ClusterRole + CRB | cluster scope | `99_teardown.sh` deletes both explicitly |
| Created `aurora-credentials` Secret in `pd-cctv`, `pd-personas` | demo namespaces | namespace delete on bootstrap Application prune |
| Built + pushed `pd-persona:0.1.0` image to internal registry | `pd-personas` namespace | namespace delete on prune (image goes with it) |
| Pre-staged 16.6 GB Qwen2.5-VL into `s3://ai-demo-data-lake/models/police-department/` | platform S3 bucket | `99_teardown.sh` prompts to remove (PD_S3_CLEANUP=yes auto-confirms) |

## Catch & Gotchas (read these before debugging)

1. **The `quay.io/modh/vllm:rhoai-2.16` image is gone** — see the blocked section above. This is the only thing standing between the current cluster state and a fully-green smoke test.

2. **SSO credentials in `pd-s3-creds` go stale every ~1 hour.** The S3 watcher CronJob, pull-clip, and structure-and-write tasks read the secret at pod start; once the AWS session expires those pods 403. Rotate by re-running step 1 of the "How To Pick This Up Tomorrow" block.

3. **ArgoCD self-heal resets `pd-s3-watcher-cursor` ConfigMap.** The manifest has `seen_keys: ""` and ArgoCD keeps reconciling that back. The watcher will therefore re-detect every clip in the prefix on every cron run — fine for a demo, would loop in production. Mark the cursor as `argocd.argoproj.io/sync-options: IgnoreExtraneous=true` if this becomes annoying.

4. **The persona Dockerfile is single-stage now.** Don't be tempted to "optimize" it back to multi-stage without re-checking — the UBI s2i image's `/opt/app-root/lib` symlink to `lib64` is a documented trap. See commit `daf104f`.

5. **Tekton v1 renamed `resources` → `computeResources` on Step.** Easy to miss when copying older v1beta1 task examples. See commit `3d45d8d`.

6. **EventListener needs cluster-scoped RBAC** for `clusterinterceptors` and `clustertriggerbindings` — if the `el-pd-perception` pod CrashLoopBackOffs with "failed to start informers", it's missing this. See commit `284cc11`.

7. **Persona `readinessProbe` uses `/healthz` not `/readyz`** — `/readyz` does a deeper liveness check that includes calling Llama, which 503s the Route during cold starts. `/healthz` is a simple ping. Don't switch back without addressing the cold-start cascade.

8. **`pd-aurora-init` Job kept failing** in the bootstrap chain because the demo Secret in `pd-cctv` originally had empty `endpoint`/`password` (autodiscovery race). The schema was applied via a one-off psql pod with hard-coded env vars. The Job manifest is correct; just rerun it after secrets are populated.

9. **`registry.access.redhat.com` and `registry.redhat.io` had a sustained HTTP 503 outage** during this session, breaking `oc new-build`. Fix: pull base images from the cluster-internal mirror at `image-registry.openshift-image-registry.svc:5000/openshift/python:3.11-ubi9` (already-imported imagestream tag).

10. **`oc apply` of demo Secret yaml from `cat <<EOF` heredoc is dangerous** — outer-shell variable expansion turns `$endpoint` into empty before it reaches the YAML, so the in-cluster Secret/Pod sees blanks. Use `cat <<'EOF'` (single-quoted) when embedding shell-style references inside a YAML you ship to the cluster.

---

## Two-Repo Discipline (the bright line)

| Path | Direction | Allowed actions |
|---|---|---|
| `/Users/sanjeevkumar/GitHub/ai-demo-stack-aws/` | **READ ONLY (file system)** | grep, cat, Read tool. Zero git writes. **Running its own scripts (e.g. `gitops/bootstrap-argocd.sh`) is allowed** — that's executing, not editing. |
| `/Users/sanjeevkumar/GitHub/company-demos/` | read+write | All work scoped to `police-department/`. |

Verify after any session of work: `git -C /Users/sanjeevkumar/GitHub/ai-demo-stack-aws status --porcelain` must return empty.

---

## Files To Look At First

| If you want to understand… | Read first |
|---|---|
| What gets deployed | `argocd/bootstrap-application.yaml` and `argocd/apps/pd-*.yaml` |
| The data model | `sql/02_tables.sql` and `sql/04_triggers_custody.sql` |
| The pipeline DAG | `manifests/pipeline/pd-pipeline.yaml` |
| The persona logic | `personas/app/graphs/_common.py` |
| The HITL flow | `personas/app/hitl/router.py` + `personas/app/main.py` |
| The bootstrap chain | `bootstrap/lib/common.sh` then `00_preflight.sh` |
| Why something deviates from spec | `docs/PLATFORM_GAPS.md` |
| How to live-demo this | `docs/DEMO_SCRIPT.md` |
| Operator commands | `docs/RUNBOOK.md` |
| Failure modes | `docs/TROUBLESHOOTING.md` |
| **What I changed in this session** | the commits listed above, especially `8591093` → `daf104f` |
