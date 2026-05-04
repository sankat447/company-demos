-- =============================================================================
--  Police-Department demo — core tables
--  6 tables: clips, custody_log, narrations, entities, events, relationships
-- =============================================================================

CREATE TABLE IF NOT EXISTS pd_cctv.clips (
  clip_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  s3_uri         TEXT NOT NULL,
  sha256         CHAR(64) NOT NULL UNIQUE,
  uploaded_by    TEXT NOT NULL,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_sec   NUMERIC,
  source_label   TEXT
);

CREATE TABLE IF NOT EXISTS pd_cctv.custody_log (
  id          BIGSERIAL PRIMARY KEY,
  clip_id     UUID,                                -- nullable: some custody events span multiple clips
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  context     JSONB
);

CREATE TABLE IF NOT EXISTS pd_cctv.narrations (
  narration_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clip_id        UUID REFERENCES pd_cctv.clips(clip_id) ON DELETE CASCADE,
  json_payload   JSONB NOT NULL,
  prose          TEXT NOT NULL,
  embedding      VECTOR(384),                      -- BGE-small-en-v1.5 dimensions
  model_id       TEXT,
  model_version  TEXT,
  confidence     NUMERIC,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pd_cctv.entities (
  entity_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind             TEXT NOT NULL,                  -- 'person' | 'vehicle' | 'object' | 'location'
  label            TEXT,
  appearance_emb   VECTOR(512),                    -- visual descriptor (placeholder dims)
  first_seen_clip  UUID,
  first_seen_ts    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pd_cctv.events (
  event_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clip_id      UUID REFERENCES pd_cctv.clips(clip_id) ON DELETE CASCADE,
  t_start      INTERVAL,
  t_end        INTERVAL,
  action       TEXT,
  confidence   NUMERIC
);

CREATE TABLE IF NOT EXISTS pd_cctv.relationships (
  src             UUID NOT NULL,
  dst             UUID NOT NULL,
  kind            TEXT NOT NULL,
  evidence_clip   UUID NOT NULL,
  evidence_ts     INTERVAL NOT NULL DEFAULT INTERVAL '0 seconds',
  PRIMARY KEY (src, dst, kind, evidence_clip, evidence_ts)
);
