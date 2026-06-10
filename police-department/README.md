# Police-Department CCTV Video-Intelligence Demo

A self-contained customer demo built on top of the existing `ai-demo` AWS / OpenShift / RHOAI platform. Drops 30-second CCTV clips into S3, runs them through a 5-task Tekton perception pipeline (multimodal VLM caption + ASR + object detection + structured write), and exposes three LangGraph persona agents (Detective, Patrol, Evidence Clerk) with HITL approval over a small HTMX UI.

## Two-Repo Model

| Repo | Path | Role |
|---|---|---|
| Platform | `../../ai-demo-stack-aws/` (sibling) | AWS infra, OCP, RHOAI, KServe, vLLM runtime, Llama 3.1 8B, Aurora pgvector, Open WebUI, Portkey. **Read-only** to this demo. |
| Demos | `..` (`company-demos`) | This demo + future siblings (`healthcare/`, `retail/`, …). |

This subsystem **never modifies the platform repo**. It consumes the platform's services and adds its own resources under demo-only namespaces (`pd-cctv`, `pd-personas`).

## One-Command Deploy

```bash
# 1. Set the required env vars
export HF_TOKEN=hf_...                         # Hugging Face token (Qwen2.5-VL pull)
export AURORA_HOST=ai-demo-ocp-db.cluster-...rds.amazonaws.com
export AURORA_PASSWORD='Demo1234#'             # platform default (URL-encoded as %23 in conn strings)
export AWS_REGION=us-east-1

# 2. Run the bootstrap chain
cd police-department
bash bootstrap/00_preflight.sh
bash bootstrap/01_secrets.sh
bash bootstrap/02_fetch_models.sh              # idempotent — skips if model already in S3
bash bootstrap/03_apply_argocd.sh              # the only step that mutates the cluster
bash bootstrap/04_seed_samples.sh              # uploads a test clip
bash bootstrap/05_smoke.sh                     # end-to-end verification
```

Single ArgoCD entrypoint:

```bash
oc apply -f police-department/argocd/bootstrap-application.yaml
```

## Architecture (1-paragraph)

S3 `clips/police-department/<clip_id>.mp4` → in-cluster CronJob watcher → Tekton EventListener → 5-task PipelineRun. Tasks `vlm-caption` (Qwen2.5-VL on T4), `whisper-asr` (CPU), `yolo-detect` (CPU) run in parallel; `structure-and-write` joins outputs into a Pydantic-typed bundle and writes to Aurora schema `pd_cctv` (clips, narrations, custody_log, entities, events, relationships) + pgvector embeddings + S3 artifact bundle + MLflow run. Three LangGraph personas (Detective / Patrol / Evidence Clerk) run as a FastAPI service in `pd-personas` ns; each does hybrid retrieval (pgvector + KG-lite walks) and calls Llama 3.1 8B via the existing Portkey gateway. Every persona response is parked in Redis and gated by an HTMX HITL queue at `https://pd-hitl-route-pd-personas.<cluster-domain>/hitl/queue` — operator approves/rejects/edits before release; the decision is appended to `pd_cctv.custody_log`.

## GPU Time-Share

Single g4dn.xlarge T4 (16 GB VRAM). Both `llama-3-1-8b` (in `ai-demo` ns) and `pd-qwen25-vl-7b` (in `pd-cctv` ns) request `nvidia.com/gpu: 1`. The GPU MachineSet is `maxReplicas: 1`. Knative scale-to-zero choreographs the swap: each InferenceService scales to zero after ~60s idle, freeing the GPU for the other. A PrometheusRule alerts if both ever go `Ready: True` simultaneously.

## Layout

See `ARCHITECTURE.md` and `docs/`. Key directories:

- `argocd/` — bootstrap Application + 7 child Applications
- `manifests/` — plain-YAML Kubernetes resources, organised by sync wave
- `sql/` — Aurora schema migration files (mounted into init Job via ConfigMap)
- `personas/` — FastAPI source for the LangGraph persona service
- `bootstrap/` — idempotent shell scripts (00 → 99)
- `tests/` — e2e smoke + unit pytests
- `docs/` — RUNBOOK, DEMO_SCRIPT, TROUBLESHOOTING, ARCHITECTURE, PLATFORM_GAPS

## Teardown

```bash
bash police-department/bootstrap/99_teardown.sh
```

Cascades through ArgoCD prune. Optional `DROP SCHEMA pd_cctv CASCADE` is prompted (default no).
