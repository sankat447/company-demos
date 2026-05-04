# STATUS — Police-Department CCTV Demo

Snapshot of what is built, what is verified, what is not, and the gotchas a future engineer needs to know on day one. Update this file whenever the truth shifts.

**Last updated:** 2026-05-04
**Branch:** `feature/police-department-v1`
**PR:** https://github.com/sankat447/company-demos/pull/1 (open, against `sanjeev-dev`)

---

## TL;DR

The entire subsystem is **authored and pushed** as 11 phased commits + 1 PR. **Nothing has been deployed to a cluster yet.** All offline validation (YAML parse, Python parse, bash syntax) is green. End-to-end verification is pending the operator running `bootstrap/00_preflight.sh` → `05_smoke.sh` against the live `ai-demo` cluster.

The platform repo (`ai-demo-stack-aws`) is **untouched** — verified via `git status --porcelain` returning empty.

---

## Build Status (per phase)

| # | Phase | Commit | Files | Verified offline | Verified on cluster |
|---|---|---|---|---|---|
| 1 | Skeleton (README, CLAUDE.md, ARCHITECTURE stub, .gitignore) | `5bb41d1` | 5 | ✅ | n/a |
| 2 | ArgoCD bootstrap + 7 child Applications + 2 namespaces + ServiceMeshMembers | `3d64ce4` | 10 | ✅ YAML | ❌ |
| 3 | Aurora `pd_cctv` schema + ConfigMap + PostSync init Job | `c5704de` | 9 | ✅ YAML, SQL by inspection | ❌ |
| 4 | Qwen2.5-VL InferenceService + per-ns ServingRuntime + GPU-mutex PrometheusRule | `dd87da7` | 3 | ✅ YAML | ❌ |
| 5 | Tekton perception Pipeline (5 Tasks + Triggers + RBAC + PVC) | `37aedf1` | 11 | ✅ YAML | ❌ |
| 6 | In-cluster S3 watcher CronJob + RBAC + cursor ConfigMap (+ ref-only Lambda TF) | `f13a1a0` | 4 | ✅ YAML | ❌ |
| 7 | LangGraph persona FastAPI (Detective/Patrol/EvidenceClerk) + Dockerfile + manifests | `cd2b029` | 22 | ✅ YAML, Python AST | ❌ |
| 8 | HITL queue (HTMX) + approve/reject/inspect endpoints + dedicated Route | `87b0614` | 4 | ✅ YAML, Python AST | ❌ |
| 9 | Bootstrap scripts (00_preflight..99_teardown + lib/common.sh) | `14b3575` | 8 | ✅ `bash -n` | ❌ |
| 10 | Unit tests (pytest, stubbed externals) + e2e smoke + GPU-mutex test | `ba2bbe6` | 7 | ✅ Python AST, `bash -n` | ❌ pytest not run |
| 11 | RUNBOOK + DEMO_SCRIPT + TROUBLESHOOTING + ARCHITECTURE + PLATFORM_GAPS | `3bd6ca9` | 5 | ✅ markdown | n/a |

**Total**: 86 files, 11 commits, ~3500 lines.

---

## What Is Verified

- All 27 YAML manifests parse with Ruby's YAML loader.
- All 16 Python modules parse with `ast.parse`.
- All 9 shell scripts pass `bash -n`.
- All ArgoCD Application sources point at the right repo (`https://github.com/sankat447/company-demos`) and right paths (`police-department/manifests/<area>`).
- The `vllm-runtime` ServingRuntime in `pd-cctv` is a verbatim fork of the platform's runtime in `ai-demo` plus the multimodal flags Qwen-VL needs.
- The `pd-aurora-init` Job mirrors the platform's `pgvector-init` PostSync pattern exactly.
- `git -C ../ai-demo-stack-aws status --porcelain` is empty.

## What Is NOT Verified (waiting on cluster)

- ArgoCD repo allowlist actually accepts `https://github.com/sankat447/company-demos` (may need a one-shot `Secret` add — see TROUBLESHOOTING.md §5).
- `pd-aurora-init` Job actually creates the schema (depends on the platform's pgvector extension already being present in `ai-demo`'s `rhoai_demo` DB).
- Qwen2.5-VL pulls cleanly from HF via `bootstrap/02_fetch_models.sh` — depends on `HF_TOKEN` having access to `Qwen/Qwen2.5-VL-7B-Instruct`.
- vLLM `--limit-mm-per-prompt=image=8` is supported by the `quay.io/modh/vllm:rhoai-2.16` image (it is in upstream vLLM ≥0.6; needs confirming).
- Knative scale-to-zero actually choreographs Llama ↔ Qwen-VL on a real GPU.
- The Persona Deployment image — `image-registry.openshift-image-registry.svc:5000/pd-personas/pd-persona:0.1.0` — must be built and pushed separately (the Dockerfile is in `personas/` but no CI builds it yet).
- `tests/unit/*.py` haven't been pytest-run; AST parses but no test execution.

---

## How To Pick This Up Tomorrow

1. **Check the PR**: https://github.com/sankat447/company-demos/pull/1 — verify branch state hasn't drifted.
2. **Skim** `docs/RUNBOOK.md` (operator commands), `docs/ARCHITECTURE.md` (data flow), `docs/PLATFORM_GAPS.md` (what we deliberately stubbed).
3. **Run preflight**: `bash police-department/bootstrap/00_preflight.sh`.
4. **Build & push the persona image** (the one missing piece):
   ```bash
   IMG=image-registry.openshift-image-registry.svc:5000/pd-personas/pd-persona:0.1.0
   cd police-department/personas
   oc -n pd-personas new-build --name pd-persona --strategy=docker --binary
   oc -n pd-personas start-build pd-persona --from-dir=. --follow
   # OR build locally and push to ECR — manifest pulls IfNotPresent
   ```
5. **Walk the bootstrap chain**: `01_secrets.sh` → `02_fetch_models.sh` → `03_apply_argocd.sh` → `04_seed_samples.sh` → `05_smoke.sh`. Each step writes to stderr; the smoke report is at `.smoke-report.md`.

If the cluster needs the repo registered with ArgoCD first:
```bash
oc -n openshift-gitops apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: pd-company-demos-repo
  namespace: openshift-gitops
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: git
  url: https://github.com/sankat447/company-demos
EOF
```

---

## Catch & Gotchas (read these before debugging)

### 1. The persona container image does not exist yet
The Deployment manifest at `manifests/personas/pd-persona-service.yaml` references `pd-persona:0.1.0` in the OCP internal registry. Until you build and push that image (`oc new-build` + `oc start-build`, or local `podman build` + `oc image-registry login`), the pod will `ImagePullBackOff`. This is the single biggest "first run will fail" trap.

### 2. The Aurora schema ConfigMap duplicates the SQL
`manifests/aurora/pd-aurora-schema-configmap.yaml` carries inline copies of the 6 files in `sql/`. **If you edit `sql/*.sql` you must mirror the change into the ConfigMap** — there is no generator script yet. Diff before commit.

### 3. The `pd-` prefix is intentional, not a typo
Platform convention is no prefix (`vllm-runtime`, `llama-3-1-8b`, `open-webui`). We deliberately added `pd-` to demo-owned resources so a future `healthcare/` demo can copy-paste this directory and find-replace `pd-` → `hc-`. The two exceptions are namespace-scoped: `vllm-runtime` (in `pd-cctv` — different namespace, same name is fine) and the namespace names themselves.

### 4. Per-namespace `ServiceMeshMember`, NOT `ServiceMeshMemberRoll`
The platform's SMMR at `ai-demo-stack-aws/gitops/config/platform/servicemesh-smcp.yaml` lists `ai-demo, knative-serving, langchain` and is owned by the platform. We join the mesh from our side via `ServiceMeshMember` in `pd-cctv` and `pd-personas` (referencing `data-science-smcp` in `istio-system`). Do **not** edit the platform SMMR.

### 5. GPU mutex is soft, not hard
`Llama` and `Qwen-VL` both request `nvidia.com/gpu: 1` and the GPU MachineSet is `maxReplicas: 1`. Knative scale-to-zero is the choreography. If both try to scale up in a tight window, one ends up stuck `Pending`. The PrometheusRule `pd-gpu-mutex` is a tripwire; the runbook's pre-demo procedure (`oc patch isvc llama-3-1-8b … minReplicas: 0`) is the workaround.

### 6. The S3 watcher CronJob has 60 s polling latency
This is intentional (no AWS-write requirement) but means demo timing has a minute-floor between "drop clip in S3" and "PipelineRun starts". For sub-second triggering, see `terraform/lambda-s3-bridge.tf.example` (rename to `.tf` and `terraform apply` — that path requires AWS write privileges that the platform does not normally grant from this demo).

### 7. `targetRevision: HEAD` requires the branch to exist on the remote
The bootstrap Application uses `targetRevision: HEAD`, which resolves against the **default branch** of the repo (currently `sanjeev-dev`). Until this PR merges, ArgoCD won't see the new files via `HEAD`. Workarounds:
- Merge the PR first, OR
- Patch the bootstrap Application's `targetRevision` to `feature/police-department-v1` for testing:
  ```bash
  oc -n openshift-gitops patch application pd-bootstrap --type=merge \
    -p '{"spec":{"source":{"targetRevision":"feature/police-department-v1"}}}'
  ```
  And do the same for the 7 child Applications.

### 8. `pd-pipeline-workspace` PVC needs `efs-sc`
The pipeline workspace is `ReadWriteMany` (tasks land on different pods) which requires EFS. The platform installs the EFS CSI driver and a `gp3-csi` (RWO) class. If `efs-sc` is not the EFS-backed StorageClass on your cluster, edit `manifests/pipeline/pd-pipeline-pvc.yaml` to match.

### 9. Aurora password handling
`bootstrap/01_secrets.sh` autodiscovers the password from the platform's `aurora-credentials` Secret in `ai-demo`. If that Secret was rotated or never populated, set `AURORA_HOST` and `AURORA_PASSWORD` env vars explicitly before running. Note: psql connection strings need `#` URL-encoded as `%23` (the platform's password contains `#`).

### 10. The unit tests stub every external boundary
`tests/unit/conftest.py` patches Portkey, pgvector, Redis, and custody-log so tests are hermetic. This means tests pass even if the cluster is dead — they only verify the FastAPI wiring + Pydantic schemas + HITL flow. **They do NOT prove Aurora connectivity, vector search quality, or LLM integration.** That's what `bootstrap/05_smoke.sh` is for.

---

## Open Questions / Decisions Punted

| Q | Status |
|---|---|
| Where do we build/push the persona image (ECR vs internal registry)? | Both supported via `imagePullPolicy: IfNotPresent`; pick at first deploy. |
| Should the bootstrap Application's `targetRevision` be `main`/`sanjeev-dev` or pinned to a tag? | Currently `HEAD`. Pin once we're ready to release. |
| Do we want a CronJob to garbage-collect old S3 clips and processed bundles? | Not built. ROL ops question — runbook can document a manual `aws s3 rm`. |
| Should the e2e smoke test be wired into a `.github/workflows/` action? | No CI in this repo today. Future work. |

---

## Two-Repo Discipline (the bright line)

| Path | Direction | Allowed actions |
|---|---|---|
| `/Users/sanjeevkumar/GitHub/ai-demo-stack-aws/` | **READ ONLY** | grep, cat, Read tool. Zero git writes. Zero file writes. |
| `/Users/sanjeevkumar/GitHub/company-demos/` | read+write | All work scoped to `police-department/`. Top-level `README.md` got a one-line index entry. |

Verify after any session of work: `git -C /Users/sanjeevkumar/GitHub/ai-demo-stack-aws status --porcelain` must return empty.

---

## Files To Look At First

| If you want to understand… | Read first |
|---|---|
| What gets deployed | `argocd/bootstrap-application.yaml` and `argocd/apps/pd-*.yaml` |
| The data model | `sql/02_tables.sql` and `sql/04_triggers_custody.sql` |
| The pipeline DAG | `manifests/pipeline/pd-pipeline.yaml` |
| The persona logic | `personas/app/graphs/_common.py` (every persona is a 4-line wrapper) |
| The HITL flow | `personas/app/hitl/router.py` + `personas/app/main.py` |
| The bootstrap chain | `bootstrap/lib/common.sh` then `00_preflight.sh` |
| Why something deviates from spec | `docs/PLATFORM_GAPS.md` |
| How to live-demo this | `docs/DEMO_SCRIPT.md` |
| Operator commands | `docs/RUNBOOK.md` |
| Failure modes | `docs/TROUBLESHOOTING.md` |
