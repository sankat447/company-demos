# RUNBOOK — Police-Department CCTV Demo

Operational reference for the live demo. Owners: demo team.

## Quick reference

| Command | What it does |
|---|---|
| `bash bootstrap/00_preflight.sh` | Verify cluster + platform readiness (read-only) |
| `bash bootstrap/01_secrets.sh`  | Populate Aurora / S3 / HF / Portkey Secrets |
| `bash bootstrap/02_fetch_models.sh` | Stage Qwen2.5-VL in S3 (idempotent, ~6 min if missing) |
| `bash bootstrap/03_apply_argocd.sh` | Apply ArgoCD bootstrap; the **only** mutating step |
| `bash bootstrap/04_seed_samples.sh` | Drop a clip into S3 (synthetic by default) |
| `bash bootstrap/05_smoke.sh`    | End-to-end verification, writes `.smoke-report.md` |
| `bash bootstrap/99_teardown.sh` | Remove the demo, optionally drop schema + S3 clips |

## Where things live

| Resource | Namespace | How to inspect |
|---|---|---|
| Qwen2.5-VL InferenceService | `pd-cctv` | `oc -n pd-cctv get isvc pd-qwen25-vl-7b` |
| vLLM ServingRuntime | `pd-cctv` | `oc -n pd-cctv get servingruntime vllm-runtime` |
| Tekton Pipeline + tasks | `pd-cctv` | `oc -n pd-cctv get pipelines,tasks` |
| EventListener Route | `pd-cctv` | `oc -n pd-cctv get route pd-perception-el` |
| S3 watcher CronJob | `pd-cctv` | `oc -n pd-cctv get cronjob pd-s3-watcher` |
| Persona FastAPI | `pd-personas` | `oc -n pd-personas get deploy/pd-persona route/pd-persona` |
| HITL queue UI | `pd-personas` | `oc -n pd-personas get route pd-hitl` (path `/queue`) |
| GPU mutex alert | `openshift-monitoring` | `oc -n openshift-monitoring get prometheusrule pd-gpu-mutex` |

## GPU mutex behaviour

The cluster has one g4dn.xlarge T4. Two InferenceServices request that GPU: `llama-3-1-8b` (ns `ai-demo`) and `pd-qwen25-vl-7b` (ns `pd-cctv`). They time-share via Knative scale-to-zero (`minReplicas: 0`, idle ~60 s).

**Before a demo run that exercises the VLM** (live narration of a fresh clip), force Llama down so Qwen-VL can take the GPU without delay:

```bash
oc -n ai-demo patch isvc llama-3-1-8b --type=merge \
  -p '{"spec":{"predictor":{"minReplicas":0}}}'
oc -n ai-demo delete pod -l serving.kserve.io/inferenceservice=llama-3-1-8b --ignore-not-found
```

After the run, swap back:

```bash
oc -n pd-cctv delete pod -l serving.kserve.io/inferenceservice=pd-qwen25-vl-7b --ignore-not-found
# Llama scales up automatically on the first persona /chat call.
```

The `pd-gpu-mutex` PrometheusRule alerts in Grafana if both ever go Ready simultaneously.

## Common operations

### Trigger a pipeline by hand

```bash
clip_id=$(uuidgen)
oc -n pd-cctv create -f - <<EOF
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata:
  generateName: pd-perception-manual-
spec:
  pipelineRef: { name: pd-perception }
  serviceAccountName: pd-pipeline-sa
  params:
  - name: clip-s3-uri
    value: s3://ai-demo-data-lake/clips/police-department/<your-key>
  - name: clip-id
    value: $clip_id
  workspaces:
  - name: shared
    persistentVolumeClaim: { claimName: pd-pipeline-workspace }
EOF
```

### Tail a pipeline

```bash
oc -n pd-cctv get pr -w
oc -n pd-cctv logs -f -l tekton.dev/pipelineRun=<pr-name> --all-containers
```

### Drain pending HITL approvals

The Redis park has a 10 min TTL. To clear stale entries manually:

```bash
oc -n ai-demo exec -it deploy/redis -- redis-cli --scan --pattern 'pd:hitl:*' \
  | xargs -I{} oc -n ai-demo exec -it deploy/redis -- redis-cli del {}
```

### Re-apply schema after a drop

```bash
oc -n pd-cctv delete job pd-aurora-init --ignore-not-found
oc -n openshift-gitops annotate application pd-aurora-schema \
  argocd.argoproj.io/refresh=hard --overwrite
```

ArgoCD will re-apply the ConfigMap and the PostSync hook re-runs the migration.

## Updating the schema

1. Edit `sql/0X_*.sql`.
2. Mirror the change into `manifests/aurora/pd-aurora-schema-configmap.yaml` (the ConfigMap holds inline copies — yes it's duplication; a future improvement is a generator script).
3. Commit. ArgoCD syncs the ConfigMap, and the PostSync hook re-runs the migration.

## Security posture (lite)

- mTLS via Service Mesh sidecar in pd-cctv and pd-personas (joined via per-namespace `ServiceMeshMember`, not by editing platform SMMR).
- Authorino is *not* yet enforcing on the persona Route — see `docs/PLATFORM_GAPS.md`.
- Custody-log is append-only at the trigger level; UPDATE/DELETE raise SQL errors.
- Every clip's SHA-256 is in `pd_cctv.clips.sha256`.
- HITL approve/reject is recorded in `pd_cctv.custody_log`.
