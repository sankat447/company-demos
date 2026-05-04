-- =============================================================================
--  Police-Department demo — pd_cctv schema definition
--  Runs inside the existing Aurora database `rhoai_demo`.
--  Idempotent: every CREATE uses IF NOT EXISTS.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS pd_cctv;

-- All schema objects below live in pd_cctv.* unless explicitly qualified.
SET search_path = pd_cctv, public;
