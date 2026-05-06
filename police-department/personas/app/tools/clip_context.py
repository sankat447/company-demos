"""Per-clip context loader for the chat UI.

Pulls everything Aurora knows about a single clip (narration, entities,
events, custody log count, transcript) and packs it into a dict the
mock LLM and the LLM-prompt builders both consume. Single SQL round
trip with multiple result sets — keeps chat latency in check.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import psycopg

log = logging.getLogger(__name__)


def _dsn() -> str:
    return (
        f"host={os.environ.get('PGHOST', '')} "
        f"dbname={os.environ.get('PGDATABASE', 'rhoai_demo')} "
        f"user={os.environ.get('PGUSER', 'rhoai_admin')} "
        f"password={os.environ.get('PGPASSWORD', '')}"
    )


def load(clip_id: str) -> dict[str, Any] | None:
    """Return everything we know about a clip, or None if unknown."""
    try:
        with psycopg.connect(_dsn(), connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT clip_id::text, s3_uri, sha256, uploaded_by,
                           uploaded_at::text, source_label
                    FROM pd_cctv.clips
                    WHERE clip_id::text = %s OR clip_id::text LIKE %s
                    """,
                    (clip_id, f"{clip_id}%"),
                )
                clip_row = cur.fetchone()
                if not clip_row:
                    return None
                cid, s3_uri, sha256, uploaded_by, uploaded_at, source_label = clip_row

                cur.execute(
                    "SELECT prose, json_payload FROM pd_cctv.narrations "
                    "WHERE clip_id = %s ORDER BY created_at DESC LIMIT 1",
                    (cid,),
                )
                nrow = cur.fetchone()
                prose = nrow[0] if nrow else None
                json_payload = nrow[1] if nrow else None

                cur.execute(
                    "SELECT kind, label FROM pd_cctv.entities "
                    "WHERE first_seen_clip = %s ORDER BY kind, label",
                    (cid,),
                )
                entities = [{"kind": k, "label": l} for (k, l) in cur.fetchall()]

                cur.execute(
                    """
                    SELECT action,
                           EXTRACT(EPOCH FROM t_start)::float,
                           EXTRACT(EPOCH FROM t_end)::float,
                           confidence
                    FROM pd_cctv.events
                    WHERE clip_id = %s
                    ORDER BY t_start
                    """,
                    (cid,),
                )
                events = [
                    {"action": a, "t_start_sec": s, "t_end_sec": e, "confidence": c}
                    for (a, s, e, c) in cur.fetchall()
                ]

                cur.execute(
                    "SELECT count(*) FROM pd_cctv.custody_log WHERE clip_id = %s",
                    (cid,),
                )
                custody_count = cur.fetchone()[0]

                # Plates: aggregate per OCR text — most plates appear in
                # multiple frames, the persona only cares about distinct
                # readings ranked by max confidence.
                cur.execute(
                    """
                    SELECT text,
                           count(*)::int       AS sightings,
                           min(ts_sec)::float  AS first_ts,
                           max(ts_sec)::float  AS last_ts,
                           max(confidence)::float AS best_conf
                    FROM pd_cctv.plates
                    WHERE clip_id = %s
                    GROUP BY text
                    ORDER BY best_conf DESC, sightings DESC
                    LIMIT 8
                    """,
                    (cid,),
                )
                plates_top = [
                    {"text": t, "sightings": s, "first_ts": fs, "last_ts": ls,
                     "confidence": bc}
                    for (t, s, fs, ls, bc) in cur.fetchall()
                ]

                # Faces: just a count + the rough first/last appearance.
                cur.execute(
                    """
                    SELECT count(*)::int,
                           min(ts_sec)::float,
                           max(ts_sec)::float
                    FROM pd_cctv.faces
                    WHERE clip_id = %s
                    """,
                    (cid,),
                )
                fcount, ffirst, flast = cur.fetchone() or (0, None, None)
                faces_summary = {
                    "count": fcount or 0,
                    "first_seen_sec": ffirst,
                    "last_seen_sec":  flast,
                }

                # Transcript (if present in json_payload)
                transcript_segs = []
                if json_payload and isinstance(json_payload, dict):
                    transcript_segs = (
                        json_payload.get("transcript", {}).get("segments", [])[:8]
                    )

        return {
            "clip_id_full": cid,
            "clip_id_short": cid[:8],
            "s3_uri": s3_uri,
            "sha256": sha256,
            "uploaded_by": uploaded_by,
            "uploaded_at": uploaded_at,
            "source_label": source_label,
            "prose": prose,
            "entities": entities,
            "events": events,
            "plates": plates_top,
            "faces":  faces_summary,
            "custody_log_count": custody_count,
            "transcript_segments": transcript_segs,
        }
    except Exception as e:
        log.warning("clip_context.load(%s) failed: %s", clip_id, e)
        return None


def list_recent(limit: int = 20) -> list[dict[str, Any]]:
    """Recent clips for the UI's clip picker."""
    try:
        with psycopg.connect(_dsn(), connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT c.clip_id::text, c.s3_uri, c.uploaded_at::text,
                           COALESCE(n.prose, '') AS prose,
                           COALESCE(pc.plate_count, 0)::int AS plate_count,
                           COALESCE(fc.face_count, 0)::int  AS face_count
                    FROM pd_cctv.clips c
                    LEFT JOIN LATERAL (
                        SELECT prose FROM pd_cctv.narrations n
                        WHERE n.clip_id = c.clip_id
                        ORDER BY n.created_at DESC LIMIT 1
                    ) n ON true
                    LEFT JOIN LATERAL (
                        SELECT count(DISTINCT text) AS plate_count
                        FROM pd_cctv.plates p WHERE p.clip_id = c.clip_id
                    ) pc ON true
                    LEFT JOIN LATERAL (
                        SELECT count(*) AS face_count
                        FROM pd_cctv.faces f WHERE f.clip_id = c.clip_id
                    ) fc ON true
                    ORDER BY c.uploaded_at DESC NULLS LAST
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cur.fetchall()
        return [
            {
                "clip_id": r[0],
                "clip_id_short": r[0][:8],
                "s3_uri": r[1],
                "uploaded_at": r[2],
                "prose_preview": (r[3] or "")[:160],
                "plate_count": r[4],
                "face_count":  r[5],
            }
            for r in rows
        ]
    except Exception as e:
        log.warning("clip_context.list_recent() failed: %s", e)
        return []
