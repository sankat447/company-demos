# Functional Spec — Demo Requirements (DR-01 … DR-12)

> ⚠️ **FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.**

Authoritative, demo-sized functional list. Each item is showable in one sitting.
The **AI role** column marks exactly where agentic AI adds value (and a `—` where a
function is deliberately plain). Assumes seeded synthetic data in Aurora — nothing
depends on a live EHR.

## A. Roles & Access (Req 4.1)

| ID | Function | AI role | Audience sees |
|----|----------|---------|---------------|
| **DR-01** | Pick a role context: Scheduler, HR/Ops, Provider | — (copilot tailors answers to the active role) | Role switch; copilot greets in-context |

## B. Scheduling & PTO (Req 4.2)

| ID | Function | AI role | Audience sees |
|----|----------|---------|---------------|
| **DR-02** | View provider schedules across locations / service lines | — | Calendar/grid of seeded schedule |
| **DR-03** | Create / modify an appointment or shift | — (rule validation only) | Add/move a slot manually |
| **DR-04** | Suggest optimal slot for a new appointment | **Smart Scheduling Agent** (LangChain function-calling → Portkey → vLLM), uses no-show score + current load | "Find best slot" → ranked options, one-line reason each |
| **DR-05** | Submit PTO + show coverage impact | **PTO Impact Agent** (n8n human-in-the-loop): recompute coverage, propose backfill/swap | Submit PTO → AI flags the gap, suggests a fix → manager approves |

## C. Predictive Analytics & Alerts (Req 4.3)

| ID | Function | AI role | Audience sees |
|----|----------|---------|---------------|
| **DR-06** | No-show risk score per appointment | **No-Show Prediction model on KServe** | Appointment list with R/A/G risk badges |
| **DR-07** | Act on no-show risk | **No-Show Mitigation Agent** (n8n scheduled) → reminder drafts / overbooking suggestion | High-risk day → "send reminders?" / "safe to overbook 2 slots?" |
| **DR-08** | Coverage risk forecast (1–2 wks out) | **Demand/Coverage Forecast model (KServe)** + Coverage Risk Agent | 2-week view, understaffed slots flagged |
| **DR-09** | Surface a proactive alert | **Coverage Risk Agent** drafts → routes via n8n → dashboard/Slack/email | Alert card: "Tue 9–12 understaffed for Provider A — 2 options to fix" |

## D. Reporting & Conversational Insights (Req 4.4) — hero moment

| ID | Function | AI role | Audience sees |
|----|----------|---------|---------------|
| **DR-10** | Operational dashboards (utilization, no-show rate, PTO vs coverage) | — (Grafana) | Live dashboards |
| **DR-11** | Ask a natural-language question | **Conversational Copilot** (Open WebUI + LangChain RAG over policy/staffing docs in pgvector) | "Explain my coverage risks next week" → narrated answer with sources |
| **DR-12** | NL → data answer / mini-report | **Insights & Reporting Agent** (text-to-SQL via **MCP** over Aurora) | "No-show rate by provider last month" → table + summary, exportable |

## Demo flow (5 beats → becomes DEMO_SCRIPT.md spine)

1. Open on **Scheduler dashboard** (DR-02, DR-10).
2. An **alert fires**: next Tuesday is understaffed (DR-08, DR-09).
3. Ask the copilot **"why?"** in plain language (DR-11).
4. Copilot's plan surfaces a **high no-show cluster** (DR-06) and proposes **reminders + a smart slot fill** (DR-07, DR-04).
5. Switch to **HR view**, approve a pending **PTO** request after seeing AI-computed coverage impact + backfill (DR-05). Close with a spoken report: **"no-show rate by provider last month"** (DR-12).

## Implementation decisions tied to this spec

- **DR-06 / DR-08 models:** **Real lightweight models** (XGBoost) trained on synthetic
  data → MLflow → served as **fixed KServe endpoints**. Backend has a **graceful
  LLM+rules fallback** if an endpoint is unreachable on demo day. *(Confirmed.)*
- **DR-11 surface:** Copilot chat is embedded **inside the Streamlit role app**
  (same `copilot-backend`), with **Open WebUI** available as an alternate entry to
  the same backend — keeps the 5-beat flow on one screen.
- **DR-04/05/07/09/12:** all ride the **MCP tool surface** (`query_aurora`,
  `call_kserve`, `trigger_n8n`) + n8n flows already specced in ARCHITECTURE.md.

## Intentionally out of scope (keep expectations grounded)

HIPAA/security controls · full RBAC · payroll/HRIS write-back · live EHR/FHIR
integration · **live model retraining** (the two models are fixed KServe endpoints).
See [COMPLIANCE.md](COMPLIANCE.md).
