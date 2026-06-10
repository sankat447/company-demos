-- =============================================================================
--  Police-Department demo — indexes (pgvector + b-tree)
--  ivfflat for narration retrieval; b-tree for FK / time-range queries.
-- =============================================================================

CREATE INDEX IF NOT EXISTS narrations_embedding_ivfflat
  ON pd_cctv.narrations
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS entities_appearance_ivfflat
  ON pd_cctv.entities
  USING ivfflat (appearance_emb vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS narrations_clip_id_idx ON pd_cctv.narrations(clip_id);
CREATE INDEX IF NOT EXISTS events_clip_id_idx     ON pd_cctv.events(clip_id);
CREATE INDEX IF NOT EXISTS clips_uploaded_at_idx  ON pd_cctv.clips(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS custody_log_clip_idx   ON pd_cctv.custody_log(clip_id);
CREATE INDEX IF NOT EXISTS custody_log_ts_idx     ON pd_cctv.custody_log(ts DESC);
CREATE INDEX IF NOT EXISTS relationships_src_idx  ON pd_cctv.relationships(src);
CREATE INDEX IF NOT EXISTS relationships_dst_idx  ON pd_cctv.relationships(dst);
