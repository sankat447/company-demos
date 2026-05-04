# Architecture — Police-Department CCTV Demo

Stub. The finalized version with C4 + sequence diagrams will land in Phase 11. This file exists at the top level for discoverability; the canonical architecture document is `docs/ARCHITECTURE.md` (also stub for now).

## High-level data flow

```
                              ┌────────────────────────────┐
   operator drops              │  S3: ai-demo-data-lake     │
   clip.mp4   ────────────────▶│  clips/police-department/  │
                              └────────────┬───────────────┘
                                           │ list every 60s
                                           ▼
                              ┌────────────────────────────┐
                              │ pd-s3-watcher (CronJob)    │ ns: pd-cctv
                              └────────────┬───────────────┘
                                           │ POST
                                           ▼
                              ┌────────────────────────────┐
                              │ pd-pipeline EventListener  │ ns: pd-cctv
                              └────────────┬───────────────┘
                                           │ TriggerTemplate
                                           ▼
                       ┌──────────────────────────────────────────┐
                       │      pd-perception PipelineRun           │
                       │ ┌────────┐                               │
                       │ │ pull-  │──▶ workspace PVC              │
                       │ │ clip   │                               │
                       │ └────────┘                               │
                       │      │                                   │
                       │      ├──▶ vlm-caption ──┐                │
                       │      ├──▶ whisper-asr ──┼─▶ structure-   │
                       │      └──▶ yolo-detect ──┘   and-write    │
                       └──────────────────────┬───────────────────┘
                                              │
                       ┌──────────────────────┼────────────────────────┐
                       ▼                      ▼                        ▼
              Aurora pd_cctv         S3 processed/             MLflow run
              (clips, narrations,    police-department/        tag demo=
              entities, events,                                 police-department
              relationships,
              custody_log, vectors)
                       │
                       │ retrieval
                       ▼
                       ┌────────────────────────────┐
                       │ pd-persona-service (FastAPI)│ ns: pd-personas
                       │  /chat/{detective|patrol|   │
                       │         evidence_clerk}     │
                       │  /hitl/{queue,approve,..}   │
                       └────────────┬───────────────┘
                                    │ Portkey
                                    ▼
                       ┌────────────────────────────┐
                       │ Llama 3.1 8B (ai-demo ns)  │
                       └────────────────────────────┘
```

## GPU choreography

```
   t=0   Llama gets a query        ┌─── pd-qwen25-vl-7b: scaled to 0
         llama-3-1-8b: SCALES UP   │    no GPU
         GPU: occupied  ◀──────────┘
   t=70  Llama idle 60s
         llama-3-1-8b: SCALES DOWN
         GPU: free
   t=80  pipeline triggers vlm-caption
         pd-qwen25-vl-7b: SCALES UP (cold start ~120s first time)
         GPU: occupied
   ...
```

The PrometheusRule `pd-gpu-mutex` raises a critical alert if both InferenceServices report `Ready: True` simultaneously for >2 min.
