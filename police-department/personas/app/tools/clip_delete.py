# =============================================================================
#  clip_delete.py — irreversibly delete a clip and every downstream artefact.
#
#  The delete-clip button in the persona UI calls DELETE /api/clip/{clip_id}
#  which lands here. This is the demo-time equivalent of a police "shred
#  evidence" operation — used when a clip was accidentally ingested, was a
#  duplicate, or should never have been indexed. In production, this should
#  be gated by an admin role (out of scope for the demo).
#
#  What we purge, in dependency order:
#    1. S3 clip file  (`clips/police-department/<basename>.mp4`)
#    2. S3 processed bundle  (`processed/police-department/<clip_id>/*`)
#    3. Aurora rows across all pd_cctv tables that reference this clip_id:
#         operator_corrections, faces, plates, events, relationships (FK on
#         evidence_clip), entities (first_seen_clip), narrations, custody_log
#       (custody_log's append-only trigger is disabled for this transaction
#        so admin purges leave no orphan audit rows.)
#    4. The pd_cctv.clips row itself (the parent).
#    5. In-memory chat history for this clip (best-effort — history is
#       per-pod-process anyway).
#
#  Two hard safety guards:
#    - The sentinel clip (00000000-0000-0000-0000-000000000001) can NEVER be
#      deleted. Empty-state UI depends on its presence.
#    - S3 deletes are scoped to prefixes owned by the demo; we never call
#      DeleteObject against a URI outside `s3://<bucket>/{clips,processed}/
#      police-department/`.
# =============================================================================
from __future__ import annotations

import logging
import os
import uuid
from typing import Any

import boto3
import psycopg

from app.tools import chat_history
from app.tools.clip_context import _dsn  # reuse the connection string helper

log = logging.getLogger(__name__)

_BUCKET = os.environ.get("PD_S3_BUCKET", "ai-demo-data-lake")
_REGION = os.environ.get("AWS_REGION", "us-east-1")

_SENTINEL_CLIP_ID = "00000000-0000-0000-0000-000000000001"
_ALLOWED_S3_PREFIXES = (
    "clips/police-department/",
    "processed/police-department/",
)


class ClipNotFound(Exception):
    """Raised when the clip_id is not in pd_cctv.clips."""


class ProtectedClip(Exception):
    """Raised when someone tries to delete the sentinel or another protected clip."""


def _s3():
    return boto3.client(
        "s3",
        region_name=_REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("AWS_SESSION_TOKEN") or None,
    )


def _validate_clip_id(clip_id: str) -> None:
    """Reject anything that isn't a real UUID + block the sentinel."""
    try:
        uuid.UUID(clip_id)
    except (ValueError, TypeError):
        raise ClipNotFound(f"invalid clip_id: {clip_id!r}")
    if clip_id == _SENTINEL_CLIP_ID:
        raise ProtectedClip(
            "sentinel clip cannot be deleted (the empty-state UI depends on it)"
        )


def _parse_s3_uri(uri: str) -> tuple[str, str] | None:
    """`s3://bucket/key/path` → `(bucket, key)`; None for anything else."""
    if not uri or not uri.startswith("s3://"):
        return None
    rest = uri[5:]
    slash = rest.find("/")
    if slash < 0:
        return None
    return rest[:slash], rest[slash + 1:]


def _delete_s3_artefacts(s3, clip_id: str, clip_s3_uri: str | None) -> dict[str, int]:
    """Delete the original clip file + the processed bundle prefix. Returns counts."""
    deleted = {"clip_file": 0, "processed_bundle": 0}

    # 1. The original clip file
    if clip_s3_uri:
        parsed = _parse_s3_uri(clip_s3_uri)
        if parsed and parsed[0] == _BUCKET:
            key = parsed[1]
            if any(key.startswith(p) for p in _ALLOWED_S3_PREFIXES):
                try:
                    s3.delete_object(Bucket=_BUCKET, Key=key)
                    deleted["clip_file"] = 1
                    log.info("deleted s3://%s/%s", _BUCKET, key)
                except Exception as e:
                    log.warning("clip file delete failed for %s: %s", key, e)
            else:
                log.warning("refusing to delete out-of-scope S3 key: %s", key)

    # 2. Processed bundle (everything under processed/police-department/<clip_id>/)
    bundle_prefix = f"processed/police-department/{clip_id}/"
    try:
        paginator = s3.get_paginator("list_objects_v2")
        keys: list[dict[str, str]] = []
        for page in paginator.paginate(Bucket=_BUCKET, Prefix=bundle_prefix):
            for obj in page.get("Contents", []):
                keys.append({"Key": obj["Key"]})
        # delete_objects takes up to 1000 keys per call; batch if needed.
        while keys:
            batch, keys = keys[:1000], keys[1000:]
            s3.delete_objects(Bucket=_BUCKET, Delete={"Objects": batch})
            deleted["processed_bundle"] += len(batch)
    except Exception as e:
        log.warning("processed bundle delete failed for %s: %s", bundle_prefix, e)

    return deleted


def _delete_aurora_rows(clip_id: str) -> dict[str, int]:
    """Cascade-delete all pd_cctv rows referencing this clip. Custody-log
    append-only trigger is disabled for the transaction."""
    counts: dict[str, int] = {}
    with psycopg.connect(_dsn(), connect_timeout=5, autocommit=False) as conn:
        with conn.cursor() as cur:
            # (1) look up + surface the s3_uri BEFORE deleting so the caller
            #     can hand it to S3 cleanup. Also confirms the row exists.
            cur.execute(
                "SELECT s3_uri FROM pd_cctv.clips WHERE clip_id = %s",
                (clip_id,),
            )
            row = cur.fetchone()
            if not row:
                raise ClipNotFound(f"no clip with id {clip_id}")
            s3_uri = row[0]

            cur.execute("ALTER TABLE pd_cctv.custody_log DISABLE TRIGGER ALL")

            # Order matters — child rows first (FK constraints)
            for table in (
                "operator_corrections",
                "faces",
                "plates",
                "events",
                "relationships_by_evidence",  # sentinel, see below
                "entities",
                "narrations",
                "custody_log",
            ):
                if table == "relationships_by_evidence":
                    cur.execute(
                        "DELETE FROM pd_cctv.relationships WHERE evidence_clip = %s",
                        (clip_id,),
                    )
                    counts["relationships"] = cur.rowcount
                elif table == "entities":
                    cur.execute(
                        "DELETE FROM pd_cctv.entities WHERE first_seen_clip = %s",
                        (clip_id,),
                    )
                    counts["entities"] = cur.rowcount
                else:
                    cur.execute(
                        f"DELETE FROM pd_cctv.{table} WHERE clip_id = %s",
                        (clip_id,),
                    )
                    counts[table] = cur.rowcount

            # (2) finally the clips row itself
            cur.execute("DELETE FROM pd_cctv.clips WHERE clip_id = %s", (clip_id,))
            counts["clips"] = cur.rowcount

            cur.execute("ALTER TABLE pd_cctv.custody_log ENABLE TRIGGER ALL")
        conn.commit()

    # Attach the s3_uri so the S3 cleanup step knows which key to remove.
    counts["_s3_uri"] = s3_uri  # type: ignore[assignment]
    return counts


def delete_clip(clip_id: str) -> dict[str, Any]:
    """Hard-delete a clip and all its downstream artefacts.

    Raises:
      ClipNotFound   — no such clip_id, or malformed UUID
      ProtectedClip  — sentinel or otherwise protected

    Returns a dict of what was actually removed (row counts per table +
    S3 object counts) for the UI toast.
    """
    _validate_clip_id(clip_id)

    aurora_counts = _delete_aurora_rows(clip_id)  # raises ClipNotFound if absent
    s3_uri = aurora_counts.pop("_s3_uri", None)
    s3_counts = _delete_s3_artefacts(_s3(), clip_id, s3_uri)

    try:
        chat_history.clear(clip_id)
    except Exception as e:
        log.debug("chat_history.clear failed for %s: %s", clip_id, e)

    log.info(
        "deleted clip %s · aurora=%s · s3=%s",
        clip_id, aurora_counts, s3_counts,
    )
    return {
        "clip_id": clip_id,
        "s3_uri": s3_uri,
        "aurora": aurora_counts,
        "s3": s3_counts,
    }
