-- =============================================================================
-- Amboy NPI-Safe demo — schema (idempotent; safe to re-run).
-- Runs against the reused platform Postgres (db rhoai_demo on
-- iis-ai-postgres-primary.iis-ai-data). All objects live in schema `amboy`.
--
-- TRUST MODEL: nothing in `amboy.report_facts/sector_facts/loan_facts/chunks`
-- may contain NPI — only numbers, categories, and [ENTITY:hex] tokens. The
-- only place an original NPI value exists (encrypted) is `amboy.token_vault`.
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS amboy;

-- ── Portfolio-level numeric facts (deterministic engine reads these) ─────────
CREATE TABLE IF NOT EXISTS amboy.report_facts (
    report_id   TEXT             NOT NULL,   -- 'AMB-FY2024'
    fiscal_year INT              NOT NULL,
    bank        TEXT             NOT NULL,
    metric      TEXT             NOT NULL,   -- 'npa_ratio_pct', 'total_loans_usd', ...
    value       DOUBLE PRECISION NOT NULL,
    unit        TEXT,
    created_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
    PRIMARY KEY (report_id, metric)
);

-- ── Sector concentration facts (NPI-free) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS amboy.sector_facts (
    report_id   TEXT             NOT NULL,
    fiscal_year INT              NOT NULL,
    sector      TEXT             NOT NULL,
    balance_usd DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (report_id, sector)
);

-- ── Loan-level facts WITHOUT NPI (borrower replaced by a stable token) ───────
CREATE TABLE IF NOT EXISTS amboy.loan_facts (
    loan_id        TEXT PRIMARY KEY,
    report_id      TEXT NOT NULL,
    fiscal_year    INT  NOT NULL,
    borrower_token TEXT NOT NULL,            -- [PERSON:hex], stable across reports
    sector         TEXT,
    risk_grade     TEXT,
    balance_usd    DOUBLE PRECISION,
    status         TEXT
);

-- ── De-identified text chunks + LOCAL MiniLM embeddings (384-dim) ────────────
CREATE TABLE IF NOT EXISTS amboy.chunks (
    id          BIGSERIAL PRIMARY KEY,
    report_id   TEXT NOT NULL,
    fiscal_year INT,
    source      TEXT,                        -- 'notes', 'narrative'
    deid_text   TEXT NOT NULL,               -- tokens only — NO NPI
    embedding   vector(384),
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Reversible token<->value map. Value stored as Vault-transit CIPHERTEXT ────
-- (never plaintext). Token is the deterministic HMAC, so same value -> same token.
CREATE TABLE IF NOT EXISTS amboy.token_vault (
    token       TEXT PRIMARY KEY,            -- '[PERSON:9f3a..]'
    entity_type TEXT        NOT NULL,        -- US_SSN, PHONE_NUMBER, PERSON, ...
    ciphertext  TEXT        NOT NULL,        -- vault:v1:... transit ciphertext
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Append-only audit log (actor/action/ts; detail MUST be NPI-free) ─────────
CREATE TABLE IF NOT EXISTS amboy.audit_log (
    id       BIGSERIAL   PRIMARY KEY,
    ts       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor    TEXT        NOT NULL,
    action   TEXT        NOT NULL,           -- ingest|detokenize|tool_call|llm_call
    resource TEXT,
    detail   JSONB,                          -- NO NPI
    outcome  TEXT
);

-- Enforce append-only: block UPDATE/DELETE at the row level.
CREATE OR REPLACE FUNCTION amboy.audit_no_mutate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'amboy.audit_log is append-only (% denied)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_no_mutate ON amboy.audit_log;
CREATE TRIGGER audit_no_mutate
    BEFORE UPDATE OR DELETE ON amboy.audit_log
    FOR EACH ROW EXECUTE FUNCTION amboy.audit_no_mutate();

-- Vector index for similarity retrieval over de-identified chunks.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
    ON amboy.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
