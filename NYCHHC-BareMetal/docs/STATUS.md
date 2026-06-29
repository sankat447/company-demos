# Status — NYCHHC-BareMetal

> ⚠️ FOR DEMONSTRATION ONLY — SYNTHETIC DATA.

Canonical state of the demo. Update on every meaningful change.

## Current state (2026-06-29)
**Built end-to-end; `make verify` GREEN offline; NOT yet deployed live on ocp419.**

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
