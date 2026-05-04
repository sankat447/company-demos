# company-demos

Customer-facing demo subsystems built on top of the shared platforms in sibling repos. Each top-level directory is one self-contained demo.

| Demo | Description |
|---|---|
| [`police-department/`](police-department/) | CCTV video-intelligence demo on the `ai-demo` AAP/RHOAI platform — Qwen2.5-VL multimodal pipeline, LangGraph personas (Detective/Patrol/Evidence Clerk), HITL approval. |
| [`ropes-&-gray/`](ropes-&-gray/) | Hybrid AWS AAP + Azure Windows Update Manager patch automation demo, with EDA + Jira webhook integration. |

Other top-level files:

- `extensions/` — shared rulebooks reused across demos
- `iisl-demo-catalogue/` — catalogue UI (separate project)
- `DEMO_FRAMEWORK_TEMPLATE.txt` — reusable provisioning checklist
