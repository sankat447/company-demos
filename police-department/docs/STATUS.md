# STATUS — Police-Department CCTV Demo

Snapshot of what is built, what is verified, what is not, and the gotchas a future engineer needs to know on day one. Update this file whenever the truth shifts.

**Last updated:** 2026-06-12
**Branch:** `sanjeev-dev` (police-department/v1 merged in 2026-06-08 at `942340a`)
**Cluster:** `https://api.ai-demo.iisdemolab.click:6443` (AWS, OCP 4.21 · RHEL 9.6)
**MachineSet prefix:** `ai-demo-fs25h` (auto-detected — see lesson 17.17; do not hardcode)
**Kubeconfig:** `/Users/sanjeevkumar/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig`
**Demo URL** (operator chat): https://pd-persona-pd-personas.apps.ai-demo.iisdemolab.click/
**Presenter URL** (second-screen control deck): https://pd-persona-pd-personas.apps.ai-demo.iisdemolab.click/presenter
**Predictor URL** (Knative KServe route): https://pd-qwen25-vl-7b-predictor-pd-cctv.apps.ai-demo.iisdemolab.click/v1/models

## What's new since 2026-05-21 (post-merge to sanjeev-dev)

- ✅ **Presenter page at `/presenter`** — second-screen control deck with preset prompt buttons that type into the demo chat char-by-char and submit (lesson 17.30, 17.31)
- ✅ **GPU MachineSet auto-taint** with `nvidia.com/gpu=true:NoSchedule` so platform pods don't squat (lesson 17.23)
- ✅ **05_views.sql idempotent** — drops the `v_clip_summary` view before re-creating since 07_faces_plates.sql widens it (lesson 17.21)
- ✅ **`pd_cctv.operator_corrections` table** baked into the schema CM (lesson 17.16)
- ✅ **BGE-small staging** added to `bootstrap/02_fetch_models.sh` (lesson 17.22)
- ✅ **MLflow `s3:PutObject` permission** on `mlflow-artifacts/*` for the pd-demo-s3-rw IAM user (lesson 17.15)
- ✅ **Step 13.5** wires Tekton coschedule=disabled + `pd-results-prune-creds` + Pipelines console plugin (lessons 17.9, 17.10, 17.13)
- ✅ **Persona prompts have ABSOLUTE override rule** for operator corrections (lesson 17.25)
- ✅ **Chat-window CSS fix** — outer card no longer scrolls; video preview + input row stay pinned (lessons 17.27, 17.28)
- ✅ **Pipeline `displayName: "Objects & Licence Plates"`** on faces-and-plates task

---

## TL;DR

The demo is **demo-ready in mock mode**. A polished single-page chat UI with IIS Tech branding lives at the URL above; users can drag-drop a CCTV mp4, watch the 6-stage perception pipeline run live, then chat with three personas (Detective / Patrol / Evidence Clerk) about the clip. All three personas surface license-plate OCR readings and face counts when the perception pipeline finds them.

GPU is **OFF** by default to save cost. The demo defaults to `mock` mode, where the VLM and persona LLM responses are canned-but-grounded against real Aurora rows. Switching to `local` (on-cluster Llama via Portkey) or `claude` (Anthropic via Portkey) is a single dropdown click; both still need a small platform-side patch to land before they 200 (see Blocked section).

The platform repo (`ai-demo-stack-aws`) is **untouched** as a git tree throughout.

---

## Live Deployment State

### Working ✅

| Component | State |
|---|---|
| **Live URL** | `https://pd-persona-pd-personas.apps.ai-demo.iisdemolab.click/` returns HTTP 200, served by `pd-persona:0.2.0` |
| Cluster reachable | `system:admin` via the kubeconfig above |
| OCP operators | gitops, pipelines, servicemesh, rhods 2.25.6, serverless, kiali, authorino, efs-csi — all `Succeeded` |
| Aurora schema `pd_cctv` | 10 tables (added `plates`, `faces` in this session), 2 views, pgvector |
| Tekton EventListener | Available + Ready at `el-pd-perception.pd-cctv.svc:8080` |
| S3 watcher CronJob | Running every minute; cursor primed; **no longer loops** (selfHeal data-blanking fix landed) |
| **6-stage perception pipeline** | `pull-clip → {vlm-caption, whisper-asr, yolo-detect, faces-and-plates} → structure-and-write` — verified end-to-end on the cluster, all 6 tasks succeed in ~3 min on the synthetic test clip |
| Mock VLM | `pd-qwen25-vl-7b-mock` Deployment in `pd-cctv`, returns OpenAI-shaped responses on CPU (no GPU spend) |
| **Chat UI** | Drag-drop upload, live processing card with all 6 stages, 64×36 video thumbnails on each Recent Clip tile, IIS Tech branded header + footer, three-persona chat panel |
| `/api/thumb/{clip_id}` | Streams JPEG thumbnails generated on-demand via `imageio-ffmpeg` (UBI lacks `ffmpeg-free`) |
| Tekton Results auto-prune | CronJob in `pd-cctv` purges archived rows >20 min old every 5 min, keeps console clean during testing |
| Worker capacity | 3 worker nodes; one was scaled 0→1 during initial bring-up. Annotated for clean rollback. |

### Blocked / Deferred ⏳

| Item | Detail |
|---|---|
| Live Llama (`local` mode) | Platform's `gitops/config/inference/vllm-servingruntime.yaml` still pins the stale `quay.io/modh/vllm:rhoai-2.16` tag. Demo-side ServingRuntime is fixed (`rhoai-2.25-cuda`). Handoff artifacts ready in `docs/PLATFORM_PR_PREP_vllm_image.md` + `docs/platform-vllm-runtime-rhoai-2.25-cuda.patch`. |
| Live Claude (`claude` mode) | Needs Portkey config to map `claude-sonnet-4` to Anthropic; works the same as `local` once configured. |
| GPU bring-up | Deliberately deferred. Both modes above need GPU only when a real LLM is queried; while in `mock`, GPU stays scaled to 0 ($0). |

### Partial ⚠

| Component | Note |
|---|---|
| Plate / face detection on demo clips | The pipeline DAG path is verified, but the existing 1MB synthetic test clips have no actual plates or faces visible. A real police video will produce non-zero plate/face rows. |
| `yolov8n-face.pt` cache | Task downloads the 6 MB model on first run; no PVC pre-cache yet. |
| `tests/unit/*.py` | Committed but not pytest-run in CI. |

---

## What's New Since the Last Snapshot

These are the substantive deltas vs the 2026-05-05 status:

1. **Chat UI shipped** (`personas/app/web/`) — single-page UI with header brand, drop-zone, processing card, recent clips with thumbnails, three-persona chat. Mode toggle in header (mock / local / claude) patches the `pd-llm-mode` ConfigMap at runtime.
2. **IIS Tech branding** — header brand mark + tagline ("AI That Works"), footer attribution, browser-tab title.
3. **License-plate + face detection** — new 6th Tekton task `pd-task-faces-and-plates` (YOLOv8n-face + easyocr); new Aurora tables `pd_cctv.plates` + `pd_cctv.faces`; all three persona prompts learned how to use them; mock LLM mirrors the same context.
4. **Thumbnails for Recent Clips** — `/api/thumb/{clip_id}` ffmpeg-extracts a 256×144 JPEG on demand, caches to pod tmp; ffmpeg ships via the `imageio-ffmpeg` pip wheel (UBI 9 has no `ffmpeg-free`).
5. **Drop-zone polish** — clean dashed border with cyan-on-hover (the earlier gradient-stripe trick rendered as solid blue blocks on Safari/Chrome around the rounded corners).
6. **ArgoCD selfHeal data-blanking fix** — the watcher's cursor ConfigMap and the Aurora / S3 / Portkey Secrets had their `data:` fields declared empty in git, so selfHeal kept resetting them every reconcile. Cursor manifest now carries no `data:` block at all (watcher fully owns it); Secrets get `ignoreDifferences` on `/data` in their owning ArgoCD Apps.
7. **Persona Route 502/503 fix** — added `maistra.io/expose-route: true` label to the pod template + a per-workload PERMISSIVE PeerAuthentication, since the cluster's mesh-default mTLS is STRICT and the OCP Router can't speak mTLS.
8. **Dockerfile layer cache** — split deps install from app code copy; future small edits rebuild in ~30 s instead of ~10 min.
9. **Tekton Results auto-prune CronJob** — the OpenShift Pipelines stack ships an archive layer (Postgres-backed); without retention tuning, the console showed every old run forever. CronJob purges `pd-cctv` rows older than 20 min every 5 min.

---

## Build Status (recent commits)

| Commit | What it does |
|---|---|
| `aabbf69` | Pin demo's vLLM ServingRuntime to `rhoai-2.25-cuda` (Quay-side fix on our half) |
| `9c08391` | Chat UI bundle: upload → S3 → EventListener, mode toggle, processing panel, three-persona chat |
| `3c2f11a` | IIS Tech branding (header + footer) |
| `72aa647` | Fix S3-watcher reset loop (selfHeal) + persona Route 502/503 (maistra label + PA PERMISSIVE) |
| `05e4391` | Stop ArgoCD selfHeal blanking watcher cursor + Aurora secret (data-less manifest) |
| `417e568` | Drop-zone polish + thumbnail strip |
| `371438e` | License-plate OCR + face detection in perception pipeline (new task, Aurora schema, persona context) |
| `deb9471` | Tekton Results prune CronJob (testing-phase) |
| `053d16d` | Surface faces-and-plates as 5th UI progress stage + fetch yolov8n-face.pt at task start |
| `facf61a` | Split deps install from app copy in Dockerfile (future builds in ~30 s) |
| (current) | This STATUS.md refresh |

---

## How To Pick This Up Tomorrow

```bash
# 0. Source kubeconfig + AWS profile
export KUBECONFIG=/Users/sanjeevkumar/GitHub/ai-demo-stack-aws/environments/demo/ocp-install-dir/ai-demo/auth/kubeconfig
aws sso login --profile rhoai-demo
eval "$(aws configure export-credentials --profile rhoai-demo --format env)"
export AWS_REGION=us-east-1

# 1. Refresh demo S3 + Aurora creds (SSO tokens go stale every ~12h)
for ns in pd-cctv pd-personas; do
  oc -n "$ns" create secret generic pd-s3-creds \
    --from-literal=access_key_id="$AWS_ACCESS_KEY_ID" \
    --from-literal=secret_access_key="$AWS_SECRET_ACCESS_KEY" \
    --from-literal=session_token="$AWS_SESSION_TOKEN" \
    --from-literal=region=us-east-1 \
    --dry-run=client -o yaml | oc apply -f -
done

# 2. Verify the live URL (mock mode by default — no GPU needed)
curl -sk -o /dev/null -w "%{http_code}\n" https://pd-persona-pd-personas.apps.ai-demo.iisdemolab.click/
# Expect: 200

# 3. (Optional) Switch to claude mode if Portkey is configured
oc -n pd-personas patch configmap pd-llm-mode --type=merge -p '{"data":{"mode":"claude"}}'
```

---

## Cluster Mutations Made (and how they roll back)

| Action | Where | Rollback |
|---|---|---|
| Built + pushed `pd-persona:0.2.0` (latest sha `e23caa55…`) to internal registry | `pd-personas` | namespace delete on Application prune |
| Mock VLM Deployment | `pd-cctv` | namespace delete on Application prune |
| Per-workload PERMISSIVE PeerAuthentication | `pd-personas` | namespace delete on Application prune |
| `pd-results-prune` CronJob (Tekton archive cleaner) | `pd-cctv` | `oc -n pd-cctv delete cronjob pd-results-prune` |
| Aurora schema additions: `pd_cctv.plates`, `pd_cctv.faces`, updated `v_clip_summary` | Aurora `rhoai_demo.pd_cctv` | manual `DROP TABLE plates, faces; CREATE OR REPLACE VIEW v_clip_summary AS …` (old version), or run `99_teardown.sh` which drops the whole schema |
| Worker scale-up `worker-us-east-1c` 0→1 | `openshift-machine-api` | `99_teardown.sh` annotation-gated revert |

---

## Catch & Gotchas (read these before debugging)

1. **SSO credentials expire every ~12 hours.** When `pd-s3-creds` is older than that, S3 downloads return `400 Bad Request` from the HEAD probe. Symptoms: `pull-clip` fails, persona `/api/thumb` returns 404. Fix: re-run step 1 of "How To Pick This Up Tomorrow".

2. **ArgoCD selfHeal will re-blank any Secret or ConfigMap whose `data:` is declared empty in git.** This is true even when `ignoreDifferences` is set — that flag only changes diff status display, not whether selfHeal applies the manifest. Two options: (a) declare no `data:` in the manifest (cluster fully owns it) — this is what `pd-s3-watcher-cursor` does now; (b) keep `ignoreDifferences` AND populate the secret post-hoc — this is what the Aurora / S3 / Portkey secrets do.

3. **OCP Router cannot speak mTLS.** The cluster's mesh-default PeerAuthentication is STRICT. Any Route-fronted workload in `pd-personas` (or any mesh-member namespace) needs (a) `maistra.io/expose-route: "true"` on the pod template AND (b) a per-workload `PeerAuthentication` set to `PERMISSIVE`. Both are required — without either you get a 503 / 502.

4. **Tekton Results archives every PipelineRun forever by default.** OpenShift Pipelines installs a Postgres-backed history layer. The console reads from both live K8s and this archive. To keep the console view tidy during testing, the `pd-results-prune` CronJob purges old `pd-cctv` rows every 5 minutes. For production, replace with operator-level retention via the `tekton-results-config-results-retention-policy` ConfigMap.

5. **The persona Dockerfile must keep deps install BEFORE app copy** (commit `facf61a`). Otherwise every code edit triggers a full ~10-min torch / sentence-transformers / transformers reinstall.

6. **The persona Dockerfile is single-stage.** UBI 9's `/opt/app-root/lib` is a symlink to `lib64`; multi-stage `COPY --from` follows the symlink but doesn't recreate it, dropping packages like `python-multipart` from the runtime image.

7. **`ffmpeg-free` is not in UBI 9.** It's a Fedora package. The persona image gets ffmpeg via the `imageio-ffmpeg` pip wheel, which bundles a static binary copied to `/usr/local/bin/ffmpeg`.

8. **Tekton v1 renamed `resources` → `computeResources` on Step.** Easy to miss when copying older v1beta1 task examples.

9. **EventListener needs cluster-scoped RBAC** for `clusterinterceptors` and `clustertriggerbindings`. `el-pd-perception` will CrashLoopBackOff with "failed to start informers" if it's missing.

10. **Persona `readinessProbe` uses `/healthz` not `/readyz`.** `/readyz` calls Llama, which 503s the Route during cold starts. Don't change this without addressing the cold-start cascade.

11. **Mode switching takes ~60 s for vlm-caption tasks.** The persona pod has `pd-llm-mode` mounted as a ConfigMap volume; the kubelet propagates ConfigMap updates in roughly that window. The persona service re-reads the file on every chat call (sub-second).

---

## Two-Repo Discipline (the bright line)

| Path | Direction | Allowed actions |
|---|---|---|
| `/Users/sanjeevkumar/GitHub/ai-demo-stack-aws/` | **READ ONLY (file system)** | grep, cat, Read tool. Zero git writes. Running its own scripts (e.g. `gitops/bootstrap-argocd.sh`) is allowed. |
| `/Users/sanjeevkumar/GitHub/company-demos/` | read+write | All work scoped to `police-department/`. |

Verify after any session of work: `git -C /Users/sanjeevkumar/GitHub/ai-demo-stack-aws status --porcelain` must return empty.

---

## Files To Look At First

| If you want to understand… | Read first |
|---|---|
| What gets deployed | `argocd/bootstrap-application.yaml` and `argocd/apps/pd-*.yaml` |
| The data model | `manifests/aurora/pd-aurora-schema-configmap.yaml` (all SQL inline) |
| The pipeline DAG | `manifests/pipeline/pd-pipeline.yaml` |
| The new face/plate task | `manifests/pipeline/pd-task-faces-and-plates.yaml` |
| The persona logic | `personas/app/graphs/_common.py` |
| The chat UI | `personas/app/web/templates/index.html` + `personas/app/web/router.py` |
| The mock LLM (mock mode) | `personas/app/tools/llm_mock.py` |
| The mode switch | `personas/app/tools/mode.py` (reader) + `manifests/personas/pd-llm-mode-configmap.yaml` |
| Why something deviates from spec | `docs/PLATFORM_GAPS.md` |
| How to live-demo this | `docs/DEMO_SCRIPT.md` |
| Operator commands | `docs/RUNBOOK.md` |
| Failure modes | `docs/TROUBLESHOOTING.md` |
