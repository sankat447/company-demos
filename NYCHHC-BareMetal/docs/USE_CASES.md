# Use-Case Traceability — OBGYN AI Scheduling (UC1–UC8 ↔ implementation ↔ BR)

> ⚠️ FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA.

Maps the spec (`NYC_HHC_AI_Scheduling_Use_Case_Specification.md`, UC1–UC8) + the
Design Brief's Voice-of-the-Client items to the implementation. UC1–UC6, UC8, and
VC-A (provider load balancing) are built and demo-able on the brief's full synthetic
dataset (5k-row history corpus, 12 named providers, 15 scripted demo patients).
UC7 (outreach execution) remains the one roadmap item.

| UC | Status | Where it lives | Business rules |
|----|--------|----------------|----------------|
| **UC1** Predict no-show risk | ✅ P1 | `risk_today` panel + No-Show sklearn KServe model (`tools/providers/{live,fake}.py`); tunable tiers `tools/providers/base.py:risk_band` (red>65/amber35-65, config `risk_red`/`risk_amber`); degraded banner via `/api/data/model-status` + SPA risk pane | BR-1, BR-2, BR-3 |
| **UC2** Plan coverage 90 days | ✅ | `scheduling/service.py:coverage_plan` over the provider roster + PTO; ranked gaps (Brooks/Wu High-Risk Jul 14-18); `/api/data/coverage`, Planning pane, chat intent | BR-1, BR-2, BR-4 |
| **UC3** Optimize template | ✅ | `service.py:template_reco` over the history corpus (Tue-PM → don't double-block; walk-in full/half day); `/api/data/template`, Planning pane, chat intent | BR-1, BR-2, BR-5 |
| **VC-A** Provider load balancing (transcript) | ✅ | `service.py:load_balance` — demand vs staffing by weekday; `/api/data/load-balance`, Planning pane, chat intent | BR-2 |
| **UC4** PTO conflict & impact | ✅ P1 | `scheduling/service.py:compute_pto_impact` + `coverage_conflict` (overlap detection, service-line minimums `data.py:COVERAGE_MINIMUMS`); router surfaces the conflict; approval blocked on uncovered window | BR-1, BR-2, BR-4, BR-6, BR-7 |
| **UC5** NL schedule query | ✅ P1 | deterministic `agent/react.py:route()` (grounded in real data) + Claude-via-Portkey fallback; clarify + out-of-scope decline; role-permitted actions | BR-1, BR-2, BR-8, BR-9 |
| **UC6** HITL approval gate | ✅ P1 | `api/actions_routes.py` (propose→approve/modify/reject); `audit_log` + `service.record_audit`; SPA Approvals pane; PTO apply routed through the gate | BR-1, BR-6, BR-10 |
| **UC7** Execute outreach/backfill | ◑ Partial | cancel re-offers candidates; the HITL gate has an `outreach` action stub; SMS/email/standby Notification Service deferred | BR-1, BR-11 |
| **UC8** Epic/HR via MCP adapter | ✅ P1 (foundational) | `mcp/epic_adapter.py` (FHIR Appointment/Slot tools, typed errors, degraded); `/api/mcp/tools` + `/api/mcp/call`; stdio `mcp_server.py`; `fhir/appointment.sample.json` | BR-12, BR-13*, BR-14 |

\* BR-13 (BAA before real PHI): N/A in the demo — synthetic data only; the adapter is the seam where a real, BAA-gated Epic FHIR client would plug in.

## Business-rule coverage (BR-1 … BR-14)
| BR | Rule | Implemented by |
|----|------|----------------|
| BR-1 | Nothing auto-executes; every action needs a human decision | UC6 gate (`actions_routes`); PTO apply goes propose→approve |
| BR-2 | Every AI output carries human-readable factors | `risk_today.factors`, model `drivers`, router plain-language answers |
| BR-3 | Risk thresholds tunable post-deploy | `config.risk_red/risk_amber` → `risk_band()` |
| BR-4/5 | Coverage minimums configurable; templates respect them | `data.COVERAGE_MINIMUMS` (UC3 = Phase 2) |
| BR-6 | PTO conflicts surfaced, never silently approved | `coverage_conflict` + UC6 block-on-uncovered |
| BR-7 | HR/PTO remains the third-party system of record | demo is decision-support only; no write-back |
| BR-8 | NL answers grounded in tool data | `route()` answers from Postgres; LLM fallback cleaned |
| BR-9 | Agent calls only role-permitted tools | `route(role=…)` gating + `X-NYCHHC-Roles` header |
| BR-10 | Approved actions attributable (user + timestamp) | `audit_log` (actor_user, actor_role, ts) |
| BR-11 | Outreach respects contact preference | UC7 (Phase 2) |
| BR-12 | No Epic creds in the AI layer | `EpicAdapter` is the only data path; AI calls tools, not Epic |
| BR-13 | BAA before real PHI | synthetic only; documented cutover gate |
| BR-14 | Synthetic schema mirrors FHIR for seamless cutover | `epic_adapter` returns FHIR R4 Appointment/Slot; `fhir/` sample |

## Design-Brief ASK list (clarified flows) → implementation

The "Ask list & approach" doc specified the exact assistant flows. Each is built as a
deterministic router intent (grounded, advisory) + an LLM tool, computed from the data:

| ASK | Capability | Implementation |
|----|-----------|----------------|
| **1** Template / Tuesday | Cancellation split (**advance vs true no-show**); double-block only where true no-shows are high (Mon AM), tighten waitlist where advance (Tue PM); walk-in full-vs-half-day scenario + $ savings | `service.cancellation_breakdown`, `template_reco`, `walkin_volume/scenario`; `/api/data/{cancellations,walkins,template}`; Planning pane |
| **2** Forward PTO coverage | Coverage = skill/service-mix minimums + clustering; proactive 90-day scan; **approve-ahead** with stagger / per-diem options | `coverage_plan`, `can_approve_pto`; chat + Planning |
| **3** Consolidated dept view | Cycle time = sum of handoffs; attribute the slip to the **clerical intake** stage | `cycle_time` over `cycle_log`; `/api/data/cycle-time`; Reporting pane |
| **4** Load & duration | **Headcount ≠ capacity** — demand (provider-minutes/weekday) from the **forecast model served by KServe** vs staffed minutes; rebalance (Mon 3 / Tue 7) | `load_balance` calls `models.demand_forecast()` → KServe `nychhc-forecast`; chat + Planning |
| **5** Epic backbone (NFR) | PHI stays in Epic — analyse aggregates, **route patient-level to Epic chat**, decline PHI, read-from-Epic framing | router intents + `epic_post` audit action; system prompt |
| **6** Value story | Reframe individual → **department-level** justification artifact | router value-narrative from real metrics + Claude; advisory |
| **Proactive** | System-initiated "heads-up" (Tue-PM cancellations, forming coverage risk, Tuesday overload, cycle-time slip) | `/api/data/insights`; dashboard insights strip |

Cross-cutting: the Claude **system prompt** encodes this logic (advance≠no-show, coverage=skill-mix,
headcount≠capacity, cycle-time=handoffs, PHI-in-Epic, reframe→department) and every recommendation is
**advisory** with a confirm-before-acting nudge.

## AI model serving (OpenShift AI / KServe)
Every ML model in the demo is **served by KServe on OpenShift AI** — no model runs inside the
app process. The deterministic analytics (cancellation split, cycle-time, coverage, capacity
math) are business logic, not models. The conversational LLM is **Claude via Portkey** (external)
because the baremetal stack is CPU-only (no GPU for a local LLM); the deterministic router stays
primary.

| Model | KServe InferenceService (`iis-ai-ai`) | Features → output | Called by |
|-------|----------------------------------------|-------------------|-----------|
| **No-show risk** (UC1) | `nychhc-noshow` | 7 features → P(no-show) | `LiveModels.no_show_scores` → risk panel / chat; rules fallback if unreachable (degraded banner) |
| **Demand forecast** (ASK4) | `nychhc-forecast` | day-of-week → demand-minutes | `LiveModels.demand_forecast` → `load_balance` capacity view; history fallback if unreachable (`demand_source`) |

Both ISes are pinned to the built image digest, load the joblib **MinIO-first** (baked fallback),
and appear under **OpenShift AI → Model Serving** (`iis-ai-ai` carries `opendatahub.io/dashboard=true`).
The single predictor image serves either model via `NYCHHC_ROLE=predictor`.

## Actors & roles (DR-01 / spec §2)
Scheduler (persona **Selamawit**), **Approver** (HR/Operational Manager), Provider,
**Leadership** (Chair/CCO reporting). Dev-mode role header `X-NYCHHC-Roles`; OIDC-ready.

## Demo threads (live smoke — `make verify-cluster`)
- **UC1**: "Which OBGYN appointments are at risk today?" → red/amber/green + factors; degraded banner if the model is down.
- **UC5/UC8**: "Which OB providers have openings?" / "who can cover Dr. Okonkwo on 6/30?" → grounded via the Epic MCP tools; ambiguous asks get a clarifying question; nursing/PHI asks are declined.
- **UC4/UC6**: "Put Dr. Okonkwo on PTO 6/16–6/20 and show the impact" → impacted appts + **coverage conflict** (overlaps Stein, Inpatient OB below 2); approving it is **blocked** until overridden; the decision is **audited**.
