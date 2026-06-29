# NYC H+H — Predictive Hospital Workforce & Patient-Flow (Baremetal)

> ⚠️ **FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.**

An agentic AI demo for **NYC Health + Hospitals**: role-based workforce scheduling,
PTO impact analysis, no-show risk, coverage forecasting, operational dashboards, and a
conversational **Workforce Assistant** — running on the on-prem **ai-demo-stack-baremetal**
OpenShift AI platform.

This is the **baremetal edition** of [`company-demos/NYCHHC/`](../NYCHHC) (the AWS version):
re-architected to consume the in-stack platform services and deployed with the
[`company-demos/amboy`](../amboy) conventions. See [ARCHITECTURE.md](ARCHITECTURE.md) for the
cloud→baremetal mapping and [CLAUDE.md](CLAUDE.md) for the developer primer.

> **Revised requirement (OBGYN AI Scheduling, UC1–UC8).** The demo now targets the OBGYN
> department per `NYC_HHC_AI_Scheduling_Use_Case_Specification.md`. Phase 1 ships the P1 +
> foundational use cases — UC1 no-show, UC4 PTO conflict, UC5 NL query, **UC6 human-in-the-loop
> approval gate**, and **UC8 Epic/MCP FHIR adapter** ("the AI never touches Epic directly"). See
> [docs/USE_CASES.md](docs/USE_CASES.md) for the UC↔implementation↔BR-1…BR-14 matrix. UC2/UC3/UC7
> are Phase 2. The original DR-01…DR-12 capabilities map onto these UCs.

## What it does (DR-01…DR-12)
- **Role panes** (Scheduler / HR-Ops / Provider) via a dev-mode role header.
- **Scheduling drill-down** — specialty → doctor → calendar → book / modify / cancel
  (with high-risk re-offer).
- **PTO impact engine** — submit PTO → impacted appointments, auto-resolvable reassignments
  vs. manual, apply-all-auto.
- **No-show risk** (DR-06) + **coverage forecast** (DR-08) — two CPU sklearn models on KServe,
  with a graceful rules fallback.
- **Workforce Assistant** — a deterministic intent router answers the headline asks from real
  Postgres data (no LLM needed); open-ended questions fall back to Claude via Portkey.
- **Operational dashboard** in Grafana; everything carries the synthetic-data disclaimer.

## Architecture at a glance
```
Browser ──▶ nychhc-frontend (iis-ai-ui, static SPA + nginx BFF)
                │  /api/* (same-origin proxy)
                ▼
            nychhc-backend (iis-ai-ai, FastAPI + router + scheduling + tools)
                ├─▶ Postgres+pgvector  (iis-ai-data)   real scheduling data
                ├─▶ KServe nychhc-noshow / nychhc-forecast (iis-ai-ai, CPU sklearn)
                └─▶ Portkey :8787 ─▶ Claude (open-ended fallback only)
```
One backend image, two roles (`backend`, `predictor`); the frontend is a separate static image.

## Quickstart
Prereqs: `oc` logged into ocp419 (or `KUBECONFIG` pointing at the platform's
`install/_artifacts/auth/kubeconfig`), `python3.11`.

```bash
make verify        # offline gate: kustomize build + lint + backend/model tests
./deploy.sh        # scoped deploy onto ocp419 (creates only demo=nychhc objects)
make verify-cluster# live smoke of the routes (the 3 headline chat asks)
./destroy.sh       # scoped teardown (removes only demo=nychhc objects + demo schemas/bucket)
```

Try the assistant: *"Which cardiologists have openings?"*, *"What's the no-show rate by
provider?"*, *"Put Dr. Tanaka on PTO 6/16–6/20 and show the impact."*

## Layout
| Path | What |
|------|------|
| `backend/` | FastAPI copilot (router, scheduling, tools, providers, predictor role) |
| `models/` | train no-show + forecast; `publish.sh` → MinIO |
| `frontend/` | static SPA + `/demoer` + nginx BFF |
| `build/` | single-image Dockerfile + entrypoint + BuildConfigs |
| `gitops/` | ArgoCD Application + kustomize manifests (+ `sql/schema.sql`) |
| `grafana/` | dashboard JSON (provisioned by `deploy.sh`) |
| `scripts/` | `lib.sh` helpers + `smoke.sh` |
| `docs/` | FUNCTIONAL_SPEC · DEPLOYMENT · STATUS · LESSONS_LEARNED · COMPLIANCE |

All data is synthetic; no PHI. This demo never modifies the platform — it only consumes
platform services and manages its own `demo: nychhc`-labeled objects.
