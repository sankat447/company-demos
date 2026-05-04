-- =============================================================================
--  Police-Department demo — convenience views for the persona service
-- =============================================================================

CREATE OR REPLACE VIEW pd_cctv.v_clip_summary AS
SELECT
  c.clip_id,
  c.s3_uri,
  c.uploaded_by,
  c.uploaded_at,
  c.duration_sec,
  c.source_label,
  COUNT(DISTINCT n.narration_id) AS narration_count,
  COUNT(DISTINCT e.event_id)     AS event_count
FROM pd_cctv.clips c
LEFT JOIN pd_cctv.narrations n ON n.clip_id = c.clip_id
LEFT JOIN pd_cctv.events     e ON e.clip_id = c.clip_id
GROUP BY c.clip_id;

CREATE OR REPLACE VIEW pd_cctv.v_pending_hitl AS
SELECT
  cl.id,
  cl.clip_id,
  cl.actor,
  cl.action,
  cl.ts,
  cl.context
FROM pd_cctv.custody_log cl
WHERE cl.action LIKE 'hitl:pending:%'
ORDER BY cl.ts DESC;
