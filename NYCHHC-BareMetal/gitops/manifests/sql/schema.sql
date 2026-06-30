-- NYCHHC-BareMetal demo (OBGYN AI Scheduling) — schema bootstrap on the in-stack
-- PLATFORM Postgres (iis-ai-postgres-primary.iis-ai-data.svc, db rhoai_demo).
--
-- This file only ensures the demo-owned SCHEMAS + pgvector extension exist. ALL
-- tables and their synthetic data are created idempotently by the backend at
-- startup (scheduling/seed.py → seed_data.py, the single source of truth), so the
-- live demo and the offline SQLite fake stay byte-for-byte consistent.
--
-- destroy.sh drops these schemas; the Postgres instance itself is untouched.
-- FOR DEMONSTRATION ONLY — SYNTHETIC DATA. No PHI.

CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector (image pgvector/pgvector:pg16)

CREATE SCHEMA IF NOT EXISTS workforce;   -- demo tables (sched_*, roster, risk_today, appt_history, audit_log, …)
CREATE SCHEMA IF NOT EXISTS rag;         -- reserved (RAG not used on baremetal)
