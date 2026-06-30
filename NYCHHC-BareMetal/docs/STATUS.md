# Status — NYCHHC-BareMetal

> ⚠️ FOR DEMONSTRATION ONLY — SYNTHETIC DATA.

Canonical state of the demo. Update on every meaningful change.

## Design-Brief rebuild — P2 (2026-06-30) — offline GREEN, redeploy pending push+key
Rebuilt to the full NYC_HHC_AI_Design_Brief dataset + use cases (client feedback: "not
enough data / functionality missing; chat must work; keep the session"). `make verify`
GREEN (51 backend + 4 model). Committed locally on sanjeev-dev (not pushed).
- **Data (single-source generator `scheduling/seed_data.py`, seed=42):** 12 named providers
  (Chen/Patel/Santos/Hassan/Walsh/Kim/Rivera/Nair/Brooks/Wu/Moore/Okafor), 15 scripted demo
  patients (Daniel Brooks first red @87%), populated upcoming schedule with Tue-PM/Mon-AM
  patterns, Brooks/Wu High-Risk PTO conflict, ~2,400-row `appt_history` corpus. Seeding moved
  to the backend (`ensure_seeded` fills all tables); `schema.sql` is DDL-only.
- **Model:** no-show retrained on the brief's 7 features (appt_type, day, time, prior_noshows,
  has_contact, provider_type, visit_count); `LiveModels` + rules fallback updated to the contract.
- **Chat works:** router expanded (no-show, at-risk list, 90-day coverage, template/double-block,
  provider load, PTO, cancel, status) + Claude-via-Portkey agent tools (coverage_plan,
  template_optimization, provider_load) + corrected SQL schema doc. **Session persists** across
  tab/role switches in the SPA.
- **Use cases:** UC1–UC6, UC8 + VC-A all demo-able; new **Planning** pane (coverage/load/template).
- **Next (gated on you):** push sanjeev-dev + set PORTKEY_API_KEY, then `./destroy.sh && ./deploy.sh`
  (drops old schemas so OBGYN data reseeds) + `make verify-cluster`.

## OBGYN revision — Phase 1 (2026-06-29) — LIVE on ocp419
Evolved the demo to the revised **OBGYN AI Scheduling** spec (UC1–UC8) — see
[USE_CASES.md](USE_CASES.md). `make verify` GREEN (46 backend + 4 model); **redeployed via
destroy→deploy; `make verify-cluster` PASSED 8/8** (ArgoCD Synced/Healthy, both KServe models
Loaded, Grafana imported). The 3 headline asks answer with real OBGYN router data (OB openings;
no-show rate; Okonkwo PTO 6/16-6/20 → impact + coverage conflict). Phase-1 increments on `sanjeev-dev`:
- **OBGYN re-theme** — roster/patients/appointments/risk panel + UI now OBGYN (OB/GYN/MFM/
  Midwifery, inpatient 24/7 + outpatient, persona Selamawit). Scripted UC4 beat: Okonkwo+Stein
  overlapping OB leave.
- **UC8** Epic MCP adapter (`mcp/epic_adapter.py`) — FHIR-shaped tools, typed errors, `/api/mcp/*`.
- **UC1** tunable risk thresholds (BR-3) + degraded-mode banner.
- **UC4** PTO overlap-conflict + service-line coverage minimums (BR-4/6).
- **UC5** out-of-scope decline + clarify + role-permitted actions (BR-9).
- **UC6** HITL approval gate + `audit_log` (BR-1/6/10); SPA Approvals pane; PTO apply gated.
- **Roles** Scheduler/Approver/Provider/Leadership + a Leadership reporting pane.
- **Phase 2 (deferred):** UC2 90-day coverage, UC3 template optimization, UC7 outreach execution.
**Next:** `./deploy.sh` (re-seed OBGYN, rebuild, rollout) + `make verify-cluster` on the OBGYN threads.

### Chat conversation memory (2026-06-29, LIVE)
Chat was stateless (each `/api/chat` saw only the current message). Added `SessionMemory`
(`agent/memory.py`): bounded per-session transcript replayed into the LLM + a context bag the
router uses for follow-ups. Verified live: PTO impact → **"apply all auto"** applies it (executed +
audited as `chat:Scheduler`). Per-tab `session_id` from the SPA; "Clear" → `POST /api/chat/reset`.
+4 tests (50 backend total).

## Prior state (generic workforce demo) — LIVE on ocp419
**LIVE on ocp419 — deployed end-to-end via `./deploy.sh`; `make verify` + `make verify-cluster` GREEN.**

- ArgoCD app `nychhc-demo` Synced + Healthy. Pods: `nychhc-backend` 1/1, `nychhc-frontend` 1/1,
  both KServe predictors 1/1 (`nychhc-noshow`/`nychhc-forecast` InferenceServices READY, models Loaded).
  Bootstrap jobs (pgvector schema/seed, minio bucket+artifacts) Complete.
- **Live URLs**
  - UI: https://nychhc-frontend-iis-ai-ui.apps.ocp419.crucible.iisl.com
  - Backend: https://nychhc-copilot-iis-ai-ai.apps.ocp419.crucible.iisl.com (`/health`, `/api/capabilities`)
  - Grafana: https://grafana-iis-ai-ui.apps.ocp419.crucible.iisl.com (dashboard "NYCHHC — Workforce & Patient-Flow")
- **Smoke (`make verify-cluster`) PASSED** — all 8 checks. The 3 headline asks answer with REAL data
  via the deterministic router (no LLM key set): cardiologists Patel/Sokolova + openings; no-show rate
  by provider (Adebayo 42% / Tanaka 39%); Tanaka PTO 6/16-6/20 → 4 appts auto-reassigned to Haddad.
- **Deploy fixes applied this run**: (1) build invokes the entrypoint via `bash` (UBI build can't chmod
  a root-owned COPY'd file); (2) `_dates()` parses the `6/16-6/20` M/D form so PTO impact routes
  deterministically; (3) scripts use `applications.argoproj.io` (`oc get application` is ambiguous with
  the `app.k8s.io` CRD → the sync-wait was reading empty status).

### Build history note
`make verify` GREEN offline (kubectl kustomize 17 resources + lint + 27 backend + 4 model tests).

- **M0 recon** — both reference folders read; baremetal service DNS/creds verified against
  `ai-demo-stack-baremetal/gitops/config/apps/`; scope confirmed (router+LLM, no RAG; in-app
  PTO engine, no n8n); [ARCHITECTURE.md](../ARCHITECTURE.md) written.
- **M1 data model** — `gitops/manifests/sql/schema.sql` (schemas `workforce`/`rag`; roster,
  risk_today, pto_queue, departments/providers/shifts/appointments/pto_requests + synthetic seed);
  `sched_*` tables created idempotently by the backend at startup.
- **M2 backend** — ported verbatim from NYCHHC: `route()` (5 intents), `scheduling/`, 12 tools,
  providers (live = psycopg + httpx + Portkey). Only `config.py` defaults + one Portkey header
  changed for baremetal. **27/27 backend tests pass.**
- **M3 models** — no-show + forecast retrained (sklearn **1.9.0**), `publish.sh` → MinIO; single
  image `predictor` role (MinIO-first, baked fallback) + rules fallback. **4/4 model tests pass.**
- **M4 frontend** — static SPA + `/demoer` ported; same-origin nginx BFF proxy to the backend;
  nginx-unprivileged image.
- **M5 gitops** — `application.yaml` (standalone, prune+selfHeal, `ignoreDifferences` on both
  KServe image digests) + kustomize base (17 resources across the 3 tiers); BuildConfigs;
  Grafana dashboard JSON. `kubectl kustomize` renders clean.
- **M6 scripts** — `deploy.sh`/`destroy.sh` (phased, scoped by `demo=nychhc`, secrets out-of-band,
  digest-pinning, teardown-race fix), `scripts/lib.sh`, `scripts/smoke.sh`, `Makefile`.
  **`make verify` GREEN** (kustomize build + lint + 27 backend + 4 model tests).

## Next
- **M7** — `./deploy.sh` on ocp419, then `make verify-cluster`: role panes; scheduling book/cancel;
  PTO impact; the 3 headline chat asks via the router (real data); models Ready (or rules fallback);
  Grafana dashboard; demoer drives the live tab. Push `sanjeev-dev` first so ArgoCD can sync.

## How to operate
- Deploy: `./deploy.sh`  · Teardown: `./destroy.sh`  · Offline gate: `make verify`  ·
  Live smoke: `make verify-cluster`.
- Auth: `export KUBECONFIG=~/GitHub/ai-demo-stack-baremetal/install/_artifacts/auth/kubeconfig`.
- Enable open-ended chat: set `PORTKEY_API_KEY` before `deploy.sh` (router works without it).

## Cluster mutations this demo makes (all reverted by destroy.sh)
- `nychhc-creds` Secret in iis-ai-{ai,ui,data}.
- `demo: nychhc` objects across the 3 tiers (builds, images, deploys, svcs, routes, jobs, KServe IS).
- Postgres schemas `workforce` + `rag` (+ `sched_*` tables) in `rhoai_demo`.
- MinIO bucket `nychhc-models`.
- Grafana datasource `NYCHHC Postgres` + dashboard `nychhc-workforce`.
- Label `opendatahub.io/dashboard=true` on `iis-ai-ai` (left in place — harmless, platform-level).
