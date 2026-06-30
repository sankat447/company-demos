# CLAUDE.md — NYCHHC-BareMetal demo subsystem

Primer for future Claude Code sessions in this directory.

## What this is
NYC Health + Hospitals agentic scheduling demo on the on-prem **ai-demo-stack-baremetal**
platform (port of the AWS `company-demos/NYCHHC/`, reusing **amboy** deployment conventions).
One backend image (two roles) + a separate static-SPA image; one standalone ArgoCD Application.

**Revised to the OBGYN AI Scheduling spec (UC1–UC8).** Phase 1 = P1 + foundational
(UC1 no-show, UC4 PTO conflict, UC5 NL, UC6 HITL gate, UC8 Epic/MCP FHIR adapter). Roles:
Scheduler/Approver/Provider/Leadership. See `docs/USE_CASES.md` for the UC↔impl↔BR matrix.
Key modules added this revision: `mcp/epic_adapter.py` (UC8 FHIR seam — the AI's only data
path), `api/actions_routes.py` (UC6 gate + `audit_log`), `scheduling/service.py:coverage_conflict`
(UC4), `tools/providers/base.py:risk_band` (UC1 tunable tiers). Phase 2: UC2/UC3/UC7.

## Hard rules
1. **Never write to `ai-demo-stack-baremetal/` (or `-aws/`).** Those are platform
   repos / the source of truth for the cluster. This demo only *consumes* their
   services and adds its own standalone ArgoCD Application. If a platform change
   seems needed, surface it as "Decision Needed" — don't edit.
2. **Fixed tiered namespaces — never invent.** `iis-ai-ai` (backend + KServe models),
   `iis-ai-ui` (frontend + Grafana), `iis-ai-data` (pg/minio bootstrap jobs).
   Every resource sets its own `namespace:`.
3. **`nychhc-` prefix + `demo: nychhc` label on every resource.** Teardown is by that
   label; the shared namespaces are NEVER deleted.
4. **CPU-only. No GPU anywhere.** Two tiny sklearn models on KServe; the open-ended
   chat fallback is Claude via Portkey (no local vLLM).
5. **Deterministic router is primary.** `backend/.../agent/react.py → route()` answers
   the headline asks from real Postgres data — NO LLM. The LLM (Claude via Portkey) is
   an optional fallback; the demo works with no API key.
6. **All data SYNTHETIC; no PHI ever.** Fictional names, phones `555-01xx`, MRNs
   `SYN-xxxx`. Disclaimer banner on every page + every API/chat response (ASCII variant
   in HTTP headers — the em-dash breaks header encoding).
7. **Secrets out-of-band.** `nychhc-creds` is created by `deploy.sh`, never in git, so
   ArgoCD selfHeal/prune can't blank it.

## Service map (consumed from the platform — confirmed in baremetal gitops/config)
- Postgres+pgvector: `iis-ai-postgres-primary.iis-ai-data.svc:5432`, db `rhoai_demo`,
  `rhoai_admin`/`Demo1234#`. Demo owns schemas `workforce` (+ `sched_*` tables) and `rag`.
- MinIO: `minio.iis-ai-data.svc:9000`, `minioadmin`/`Demo1234#`, bucket `nychhc-models`.
- Portkey: `http://portkey.iis-ai-ai.svc:8787` → Claude `claude-sonnet-4-6`
  (`x-portkey-provider: anthropic`; ALWAYS send `max_tokens` or Portkey 400s).
- Grafana: route `grafana` in `iis-ai-ui`, `admin`/`Demo1234#`.

## Layout
- `backend/` — FastAPI; `agent/react.py` (router + `_clean`), `scheduling/` (service+seed+data),
  `tools/` (12 LangChain tools) + `tools/providers/` (fake/live; live = psycopg + httpx + Portkey),
  `serving/predictor.py` (the `predictor` role), `config.py`, `llm/portkey.py`.
- `models/` — train no-show + forecast (HistGradientBoosting), `publish.sh` (→ MinIO).
- `frontend/` — static SPA (`index.html`,`css/`,`js/`) + `/demoer` + `nginx.conf` (same-origin
  BFF `/api/*` → `nychhc-backend.iis-ai-ai.svc`) + `Dockerfile`.
- `build/` — `Dockerfile` (single image, role via `NYCHHC_ROLE`), `entrypoint.sh`, BuildConfigs.
- `gitops/` — `application.yaml` + `manifests/` (kustomize: SA, bootstrap jobs, configmap,
  2 KServe IS, backend, frontend, routes, `sql/schema.sql`).
- `grafana/nychhc-dashboard.json`, `scripts/lib.sh`, `scripts/smoke.sh`, `deploy.sh`,
  `destroy.sh`, `Makefile`.

## Single image, two roles
`NYCHHC_ROLE=backend` → `uvicorn nychhc_copilot.main:app :8000`;
`NYCHHC_ROLE=predictor` → `uvicorn nychhc_copilot.serving.predictor:app :8080`
(KServe-v1; loads `{noshow,forecast}/model.joblib` MinIO-first, baked fallback).
sklearn is PINNED to `1.9.0` in the image (joblib unpickle-skew trap).

## Build / deploy / verify
- `make verify` — offline gate (kustomize build + lint + 27 backend + 4 model tests).
- `./deploy.sh` — scoped deploy: creds Secret → build backend → build frontend → ArgoCD app
  → wait sync → digest-pin the 2 KServe ISes → Grafana dashboard.
- `./destroy.sh` — disable auto-sync → remove Grafana → delete App → label-sweep `demo=nychhc`
  → drop schemas → remove bucket. Touches nothing un-labeled.
- `make verify-cluster` — live smoke of the routes (the 3 headline chat asks via the router).

## Lessons baked in (don't re-learn)
Deterministic router > small-model tool-calling · disable ArgoCD auto-sync BEFORE deleting the App
(teardown race) · `HOME=/tmp` on the mc job · `oc start-build --wait` · `max_tokens` every Portkey
call · digest-pin KServe + `ignoreDifferences` (`:latest` caching serves stale) · `oc exec -i` for
stdin · own a stable ClusterIP for the KServe predictor · single-stage UBI python (lib→lib64 drops
pip pkgs) · single-quote `cat <<'EOF'` for inline YAML; quote `&`-paths · BOTH models are KServe-served
AND used: no-show (`nychhc-noshow`) + demand forecast (`nychhc-forecast`, day_of_week→demand-min, used
by `load_balance`) · seed values must match PG column types — sqlite is typeless so type bugs (e.g. int
into a `boolean` column) only surface live and **abort `ensure_seeded`**, silently emptying later tables;
`ensure_seeded` is now **per-table idempotent** (self-heals on restart) · backend Deployment uses
`:latest` and won't auto-roll on rebuild — `oc rollout restart deployment/nychhc-backend` after deploy;
re-run the Completed `nychhc-minio-init` Job to republish model joblibs.
