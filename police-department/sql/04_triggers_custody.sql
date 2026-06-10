-- =============================================================================
--  Police-Department demo — custody-log enforcement
--
--  custody_log is APPEND-ONLY. UPDATE and DELETE are blocked at trigger level
--  so a tampering attempt fails loud with a SQL error rather than silently
--  succeeding. INSERT is the only allowed mutation.
--
--  Every write to clips/narrations/entities/events/relationships emits a
--  matching custody_log row automatically — this gives us the chain-of-
--  custody trail for free without trusting application code.
-- =============================================================================

-- ── 1. Append-only enforcement on custody_log ────────────────────────────────
CREATE OR REPLACE FUNCTION pd_cctv.fn_block_custody_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pd_cctv.custody_log is append-only; % blocked', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_custody_no_update ON pd_cctv.custody_log;
CREATE TRIGGER trg_custody_no_update
  BEFORE UPDATE ON pd_cctv.custody_log
  FOR EACH ROW EXECUTE FUNCTION pd_cctv.fn_block_custody_mutation();

DROP TRIGGER IF EXISTS trg_custody_no_delete ON pd_cctv.custody_log;
CREATE TRIGGER trg_custody_no_delete
  BEFORE DELETE ON pd_cctv.custody_log
  FOR EACH ROW EXECUTE FUNCTION pd_cctv.fn_block_custody_mutation();

-- ── 2. Auto-log writes on the other tables ───────────────────────────────────
CREATE OR REPLACE FUNCTION pd_cctv.fn_log_custody()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_clip_id UUID;
  v_actor   TEXT;
BEGIN
  -- Best-effort extraction of clip_id from the row
  BEGIN
    v_clip_id := COALESCE(
      NEW.clip_id,
      CASE TG_TABLE_NAME WHEN 'clips' THEN NEW.clip_id ELSE NULL END
    );
  EXCEPTION WHEN undefined_column THEN
    v_clip_id := NULL;
  END;

  v_actor := COALESCE(current_setting('pd_cctv.actor', TRUE), session_user);

  INSERT INTO pd_cctv.custody_log (clip_id, actor, action, context)
  VALUES (
    v_clip_id,
    v_actor,
    TG_OP || ':' || TG_TABLE_NAME,
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'op',    TG_OP,
      'time',  now()
    )
  );
  RETURN NEW;
END;
$$;

-- Attach the auto-logger to every pd_cctv table EXCEPT custody_log itself.
DO $do$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['clips','narrations','entities','events','relationships'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_log ON pd_cctv.%I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_log
         AFTER INSERT OR UPDATE ON pd_cctv.%I
         FOR EACH ROW EXECUTE FUNCTION pd_cctv.fn_log_custody();',
      t, t
    );
  END LOOP;
END;
$do$;
