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


def _bbox_iou(a: list[float] | None, b: list[float] | None) -> float:
    """Intersection-over-union of two [x1,y1,x2,y2] bboxes."""
    if not a or not b or len(a) < 4 or len(b) < 4:
        return 0.0
    ax1, ay1, ax2, ay2 = a[0], a[1], a[2], a[3]
    bx1, by1, bx2, by2 = b[0], b[1], b[2], b[3]
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    aa = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    bb = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = aa + bb - inter
    return (inter / union) if union > 0 else 0.0


# Track grouping params. We have no face embeddings, only bbox+ts, so
# this is a coarse heuristic — bias toward FEWER-but-more-confident
# tracks rather than splitting on every micro-movement. A 75-sec clip
# of a busy street should produce ~5–15 unique subjects, not 60+.
#
#   _TRACK_GAP_SEC    : how long a track can stay "open" without a new
#                       sighting before a fresh detection becomes a new
#                       subject. Long enough to span a wave of turn /
#                       occlusion, short enough that two unrelated
#                       people in the same area don't merge.
#   _TRACK_IOU_THRESH : IoU between the new bbox and the track's last
#                       bbox required to merge. Lower = more permissive
#                       merging (good when the camera is fixed and
#                       people stand roughly still). Higher = stricter.
#   _TRACK_DIST_REL   : fallback if IoU is 0 (boxes don't overlap) but
#                       are close in normalised pixel space — common
#                       when a person takes a step between sampled
#                       frames. Distance is between bbox centers,
#                       relative to the larger box's diagonal. <0.6 is
#                       treated as "still the same person".
#   _TRACK_MIN_SIGHTINGS : a track must accumulate at least this many
#                       detections to count. 4 drops single-frame
#                       blips and rare 2-3-frame false positives.
_TRACK_GAP_SEC = 8.0
_TRACK_IOU_THRESHOLD = 0.20
_TRACK_DIST_REL = 0.6
_TRACK_MIN_SIGHTINGS = 4


def _bbox_center_dist_rel(a: list[float] | None, b: list[float] | None) -> float:
    """Distance between centers / diagonal of the larger box. 0 = same
    point. ~1 = boxes one diagonal apart."""
    if not a or not b or len(a) < 4 or len(b) < 4:
        return 99.0
    acx, acy = (a[0] + a[2]) / 2.0, (a[1] + a[3]) / 2.0
    bcx, bcy = (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0
    dx, dy = acx - bcx, acy - bcy
    dist = (dx * dx + dy * dy) ** 0.5
    aw, ah = a[2] - a[0], a[3] - a[1]
    bw, bh = b[2] - b[0], b[3] - b[1]
    diag = max((aw * aw + ah * ah) ** 0.5, (bw * bw + bh * bh) ** 0.5, 1.0)
    return dist / diag


def _summarise_faces(rows: list) -> dict[str, object]:
    """Group raw detection rows into tracks (same physical subject).

    The CCTV camera is fixed; a person in the scene produces one face
    detection per stride-sampled frame. Detections at near-identical
    bbox coordinates within a short time window are almost certainly
    the same subject. This collapses ~300 raw rows into ~5 tracks for
    a typical clip.

    Returns:
      {count, first_seen_sec, last_seen_sec, unique_subjects,
       tracks: [{track_id, sightings, first_ts, last_ts}]}
    """
    if not rows:
        return {
            "count": 0, "first_seen_sec": None, "last_seen_sec": None,
            "unique_subjects": 0, "tracks": [],
        }

    tracks: list[dict] = []  # each: {last_bbox, last_ts, first_ts, count}
    for _id, ts, bbox, conf in rows:
        # bbox is JSONB → already a list when read with psycopg
        best_track = None
        best_score = -1.0
        for t in tracks:
            if ts - t["last_ts"] > _TRACK_GAP_SEC:
                continue
            iou = _bbox_iou(bbox, t["last_bbox"])
            if iou >= _TRACK_IOU_THRESHOLD:
                score = iou  # solid overlap — strong merge candidate
            elif iou == 0 and _bbox_center_dist_rel(bbox, t["last_bbox"]) < _TRACK_DIST_REL:
                score = 0.05  # close in pixel space; merge weakly
            else:
                continue
            if score > best_score:
                best_score, best_track = score, t
        if best_track:
            best_track["last_bbox"] = bbox
            best_track["last_ts"] = ts
            best_track["count"] += 1
        else:
            tracks.append({
                "last_bbox": bbox, "last_ts": ts, "first_ts": ts, "count": 1,
            })

    # Drop low-sighting tracks — without face embeddings these are almost
    # always false positives or one-frame YOLO hallucinations. A real
    # person on a fixed CCTV will appear in many adjacent samples.
    real_tracks = [t for t in tracks if t["count"] >= _TRACK_MIN_SIGHTINGS]

    # Sort by first appearance for stable subject ordering (subject A is
    # the one who shows up first).
    real_tracks.sort(key=lambda t: t["first_ts"])
    track_summaries = [
        {
            "track_id": chr(65 + i) if i < 26 else f"#{i}",   # A, B, C, ...
            "sightings": t["count"],
            "first_ts": round(t["first_ts"], 1),
            "last_ts": round(t["last_ts"], 1),
        }
        for i, t in enumerate(real_tracks)
    ]
    return {
        "count": len(rows),
        "first_seen_sec": round(rows[0][1], 3) if rows else None,
        "last_seen_sec":  round(rows[-1][1], 3) if rows else None,
        "unique_subjects": len(real_tracks),
        "tracks": track_summaries,
    }


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

                # Faces: pull all detections so we can group raw boxes into
                # tracks (same physical subject across frames). YOLO emits
                # one detection per face per sampled frame; on a 60-sec clip
                # at stride=30 with 5 visible people we get ~300 boxes.
                # Persona output should say "5 unique subjects" not "300
                # detections" — see _group_face_tracks below.
                cur.execute(
                    """
                    SELECT id, ts_sec::float, bbox, confidence::float
                    FROM pd_cctv.faces
                    WHERE clip_id = %s
                    ORDER BY ts_sec
                    """,
                    (cid,),
                )
                face_rows = cur.fetchall()
                faces_summary = _summarise_faces(face_rows)

                # Transcript (if present in json_payload)
                transcript_segs = []
                if json_payload and isinstance(json_payload, dict):
                    transcript_segs = (
                        json_payload.get("transcript", {}).get("segments", [])[:8]
                    )

                # Operator corrections — newest first, take all (usually <10)
                cur.execute(
                    "SELECT kind, text, ts_sec, operator, created_at::text "
                    "FROM pd_cctv.operator_corrections "
                    "WHERE clip_id = %s ORDER BY created_at DESC",
                    (cid,),
                )
                operator_corrections = [
                    {"kind": k, "text": t,
                     "ts_sec": float(ts) if ts is not None else None,
                     "operator": op, "created_at": ca}
                    for (k, t, ts, op, ca) in cur.fetchall()
                ]

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
            "operator_corrections": operator_corrections,
        }
    except Exception as e:
        log.warning("clip_context.load(%s) failed: %s", clip_id, e)
        return None


def _first_descriptive_line(prose: str) -> str:
    """Backfill summary for rows that don't have json_payload.summary.

    Skip markdown headers, 'Not visible' fillers, and structural noise;
    return the first sentence of real content."""
    if not prose:
        return ""
    skip_prefixes = ("##", "**", "- **", "Not visible", "(no", "—", "")
    for line in prose.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith(skip_prefixes):
            continue
        # Trim to ~one sentence (first .!?, or 160 chars)
        cut = len(s)
        for p in (". ", "! ", "? "):
            i = s.find(p)
            if i > 0:
                cut = min(cut, i + 1)
        return s[:cut][:200]
    return prose[:200]


def list_recent(limit: int = 20) -> list[dict[str, Any]]:
    """Recent clips for the UI's clip picker."""
    try:
        with psycopg.connect(_dsn(), connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT c.clip_id::text, c.s3_uri, c.uploaded_at::text,
                           COALESCE(n.prose, '') AS prose,
                           n.json_payload AS jp,
                           COALESCE(pc.plate_count, 0)::int AS plate_count,
                           COALESCE(fc.face_count, 0)::int  AS face_count
                    FROM pd_cctv.clips c
                    LEFT JOIN LATERAL (
                        SELECT prose, json_payload FROM pd_cctv.narrations n
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
        out = []
        for r in rows:
            prose = r[3] or ""
            jp = r[4] or {}
            # Prefer the model-emitted summary, fall back to first
            # descriptive sentence so older rows still get a useful preview.
            summary = ""
            if isinstance(jp, dict):
                summary = (jp.get("summary") or "").strip()
            if not summary:
                summary = _first_descriptive_line(prose)
            out.append({
                "clip_id": r[0],
                "clip_id_short": r[0][:8],
                "s3_uri": r[1],
                "uploaded_at": r[2],
                "prose_preview": summary[:200],
                "plate_count": r[5],
                "face_count":  r[6],
            })
        return out
    except Exception as e:
        log.warning("clip_context.list_recent() failed: %s", e)
        return []
