# Architecture — Police-Department CCTV Demo

Canonical architecture document.

## Two-repo model

| Layer | Repo | Path | Boundary |
|---|---|---|---|
| Platform | `ai-demo-stack-aws` | sibling dir | RHOAI, KServe, Aurora pgvector, Open WebUI, Portkey, Tekton operator. **Read-only** to this demo. |
| Demos | `company-demos` | this repo | One subdirectory per customer demo. Police-department is the first. |

The platform exposes services this demo *consumes*: vLLM ServingRuntime, Llama 3.1 8B InferenceService, Aurora pgvector DB `rhoai_demo`, S3 bucket `ai-demo-data-lake`, Portkey gateway, Redis, MongoDB, MLflow.

The demo *adds*: a pd-cctv namespace (multimodal inference + Tekton pipeline + S3 watcher), a pd-personas namespace (FastAPI agent service + HITL UI), a `pd_cctv` schema in the existing Aurora DB, and the police-department prefix in S3 (`clips/`, `models/`, `processed/`).

## Sync waves

```
Wave 1: pd-namespaces        (pd-cctv, pd-personas + ServiceMeshMember)
Wave 2: pd-aurora-schema     (ConfigMap + PostSync init Job)
Wave 3: pd-inference         (vllm-runtime + InferenceService + GPU mutex rule via wave 7)
Wave 4: pd-pipeline          (RBAC, PVC, 5 Tasks, Pipeline, EventListener, S3 watcher)
Wave 5: pd-personas          (Deployment + Service + Route)
Wave 6: pd-hitl              (extra Route to /hitl path)
Wave 7: pd-monitoring        (PrometheusRule pd-gpu-mutex)
```

## Data flow

```
operator drops clip.mp4 to s3://ai-demo-data-lake/clips/police-department/
   │
   ▼  (every 60s)
pd-s3-watcher CronJob (pd-cctv)
   │  POST {clip_s3_uri, clip_id, uploaded_by}
   ▼
EventListener Service el-pd-perception (pd-cctv)
   │  TriggerTemplate
   ▼
PipelineRun pd-perception (pd-cctv)
   ├─ pull-clip       (S3 download, sha256 → workspace PVC)
   ├─ vlm-caption     (ffmpeg keyframes → POST Qwen2.5-VL → caption.json)
   ├─ whisper-asr     (CPU faster-whisper medium → transcript.json)
   ├─ yolo-detect     (CPU YOLOv8n → detections.json)
   └─ structure-and-write (Pydantic + BGE embed + Aurora write + S3 bundle + MLflow)

Aurora rhoai_demo schema pd_cctv:
   clips, narrations (with embedding), entities, events, relationships, custody_log

operator queries https://pd-persona-pd-personas.<cluster>/chat/{detective|patrol|evidence_clerk}
   │
   ▼
LangGraph persona graph (single step):
   pgvector_query.search(q)  +  pgvector_query.expand(clip_id)
   │
   ▼  (system prompt = persona.md)
portkey_llm.chat_json → http://portkey.ai-demo.svc:8787 → Llama 3.1 8B (ai-demo)
   │  PersonaResponse{prose, claims[], provenance{}}
   ▼
redis_park.park()    →   pending_approval_id     ─┐
custody_log INSERT   →   pd_cctv.custody_log      │
                                                   │
                   operator opens /hitl/queue ◄─────┘
                   approve / reject / edit
                   ─►  custody_log INSERT
```

## GPU time-share

Single T4 (16 GB VRAM). Two GPU-requesting workloads:

| | Llama 3.1 8B | Qwen2.5-VL 7B |
|---|---|---|
| Namespace | `ai-demo` | `pd-cctv` |
| Owner | platform | this demo |
| Knative serverless | yes | yes |
| `minReplicas` | 0 | 0 |
| `maxReplicas` | 1 | 1 |
| `scaleTarget` | 1 | 1 |
| Idle scale-down | ~60 s | ~60 s |

The mutex is enforced by the GPU MachineSet `maxReplicas: 1` (only one g4dn.xlarge node ever runs). The PrometheusRule `pd-gpu-mutex` alerts on the failure mode.

## Resource budget

| Workload | CPU req / lim | Mem req / lim | GPU |
|---|---|---|---|
| pd-qwen25-vl-7b predictor | 2 / 4 | 14Gi / 15Gi | 1 |
| pd-perception pipeline tasks | 2 / 4 each | 4Gi / 6Gi | — |
| pd-persona | 0.3 / 1 | 1Gi / 2Gi | — |
| pd-s3-watcher (per-minute job) | 50m / 200m | 128Mi / 256Mi | — |

Idle cost: ~$0/hour above the platform baseline (everything is scale-to-zero or sub-1 CPU). Active cost during a demo: dominated by the GPU node, identical to platform alone.

## What this demo deliberately does NOT do

See `Appendix B` of the original mission brief and `PLATFORM_GAPS.md`. Notably: no real-time streaming ingest, no edge tier, no DR, no MCP gateways, no full Authorino enforcement, no Vault-injected secrets.

## Where the new conventions are

- Top-level layout mirrors `ropes-&-gray/` sibling demo: a single dir under `company-demos/`.
- Resource prefix `pd-` distinguishes this demo's resources from the platform's.
- ArgoCD wiring uses the platform's exact pattern: plain YAML, `directory.include` glob filters, `project: default`, automated prune+selfHeal.
- One bootstrap Application per demo. Future demos (`healthcare/`, `retail/`) get their own bootstrap Application; users apply each independently.
