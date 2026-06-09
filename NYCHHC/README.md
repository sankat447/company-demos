# NYC Health + Hospitals — Predictive Hospital Workforce & Patient-Flow

**Agentic AI Demo** · runs on the existing ROSA / Red Hat OpenShift AI stack on AWS

> ⚠️ **FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.**
> No real PHI is used anywhere in this demo. Every dataset is synthetically
> generated or public-domain. See [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

---

## What this is

A clinician/operations-facing **agentic copilot** that helps NYC Health + Hospitals
staff anticipate and manage **workforce coverage and patient flow**. A user can ask,
in plain language:

> *"Explain coverage risks next week and what I should do about it."*

…and an LLM agent plans a multi-step answer: it queries operational data, reads two
predictive models, cross-references staffing/PTO policy via RAG, and returns a
narrated, cited recommendation — with **human approval required before any schedule
write**.

It is a thin **application layer** on top of an already-provisioned platform. It
**consumes** existing services (vLLM, Portkey, Aurora, MongoDB, Redis, MinIO, Vault,
Keycloak, n8n, MLflow, Grafana) by connection string — it does **not** re-deploy them.

## Requirement coverage

| Req | Theme | What the demo shows |
|-----|-------|---------------------|
| **4.1** | User Roles & Access | Keycloak OIDC — Scheduler/Coordinator, HR-Ops Mgr, Provider (MD/APP), SysAdmin, each with scoped views |
| **4.2** | Scheduling & PTO | **Smart Scheduling** (optimal-slot using no-show + load) and **PTO Impact** (n8n human-in-the-loop backfill/swaps) — exposed as agent tools |
| **4.3** | Predictive Analytics & Alerts | **Coverage Risk** (reads demand/coverage forecast) and **No-Show Mitigation** (scores appointments, prioritized reminders) — two KServe models |
| **4.4** | Reporting & Dashboards | **Insights & Reporting** — Text-to-SQL over Aurora via an MCP server, narrated to Grafana panels |

## Demo scope (what's deep vs. light)

This is a **15-minute leadership demo**, optimized to *look impressive and be credible*,
not to be production-ready. The deep vertical path is **4.3 + 4.4 + the conversational
copilot**. 4.2 (scheduling/PTO) is wired as real agent tools but demonstrated more
lightly. Everything explicitly shortcut is documented in
[docs/COMPLIANCE.md](docs/COMPLIANCE.md) and [docs/LESSONS_LEARNED.md](docs/LESSONS_LEARNED.md).

## Documentation map

| Doc | Purpose |
|-----|---------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the demo's pods connect to the existing platform (Mermaid diagram) |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | Every synthetic dataset + RAG source + Aurora table schemas |
| [docs/COMPLIANCE.md](docs/COMPLIANCE.md) | What is **not** production-ready — "what changes for real PHI" |
| [docs/LESSONS_LEARNED.md](docs/LESSONS_LEARNED.md) | Gotchas captured as we build |
| `DEMO_SCRIPT.md` | *(written last)* 15-minute presenter walk-through |

## Repository layout

```
NYCHHC/
├── README.md                  ← you are here
├── ARCHITECTURE.md
├── DEMO_SCRIPT.md             (written last)
├── docs/
│   ├── DATA_SOURCES.md
│   ├── COMPLIANCE.md
│   └── LESSONS_LEARNED.md
├── backend/                   FastAPI + LangChain ReAct agent + MCP server
├── frontend/                  Streamlit role UIs (NYC H+H branded)
├── models/                    No-Show + Coverage-Forecast training → MLflow → KServe
├── ingestion/                 RAG: scrape → embed → upsert pgvector
├── gitops/                    Kustomize tree + ArgoCD Application
├── keycloak/                  nychhc-demo realm export (4 roles)
├── grafana/                   dashboard.json
├── n8n/                       PTO-impact + no-show-cron + weekly-usage flows
└── scripts/                   bootstrap.sh / teardown.sh
```

## Status

🚧 **Documentation / design review phase.** No application code written yet.
Pending your review of `ARCHITECTURE.md`, `docs/DATA_SOURCES.md`, and
`docs/COMPLIANCE.md` before backend work begins.
