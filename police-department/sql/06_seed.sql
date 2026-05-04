-- =============================================================================
--  Police-Department demo — minimal seed data (idempotent)
--  Inserts a single sentinel row that the smoke test uses to verify the
--  schema is reachable end-to-end before any pipeline runs.
-- =============================================================================

INSERT INTO pd_cctv.clips (clip_id, s3_uri, sha256, uploaded_by, source_label, duration_sec)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  's3://ai-demo-data-lake/clips/police-department/_sentinel.mp4',
  '0000000000000000000000000000000000000000000000000000000000000000',
  'pd-aurora-init',
  'sentinel',
  0
)
ON CONFLICT (sha256) DO NOTHING;
