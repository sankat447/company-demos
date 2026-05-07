"""Operator-submitted corrections to a clip's auto-extracted intelligence.

Append-only table; persona /chat treats the entries as authoritative,
overriding noisy OCR / face-track output. Same Aurora pgvector
database as the rest of the demo (pd_cctv schema).

Schema:
  pd_cctv.operator_corrections (
    id BIGSERIAL PRIMARY KEY,
    clip_id UUID FK,
    kind TEXT NOT NULL,         -- plate | people | vehicle | event | suspect | note
    text TEXT NOT NULL,
    ts_sec NUMERIC(8,3) NULL,   -- optional timestamp anchor
    operator TEXT DEFAULT 'ui',
    created_at TIMESTAMPTZ DEFAULT now()
  )
"""
from __future__ import annotations

import logging
import os
from typing import Any

import psycopg

log = logging.getLogger(__name__)

VALID_KINDS = ("plate", "people", "vehicle", "event", "suspect", "note")


def _dsn() -> str:
    return (
        f"host={os.environ.get('PGHOST', '')} "
        f"dbname={os.environ.get('PGDATABASE', 'rhoai_demo')} "
        f"user={os.environ.get('PGUSER', 'rhoai_admin')} "
        f"password={os.environ.get('PGPASSWORD', '')}"
    )


def add(clip_id: str, kind: str, text: str,
        ts_sec: float | None = None,
        operator: str = "ui") -> dict[str, Any]:
    """Insert one correction. Returns the inserted row."""
    if kind not in VALID_KINDS:
        raise ValueError(f"invalid correction kind {kind!r}; valid: {VALID_KINDS}")
    if not text or not text.strip():
        raise ValueError("text is required")
    with psycopg.connect(_dsn(), connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO pd_cctv.operator_corrections "
                "(clip_id, kind, text, ts_sec, operator) "
                "VALUES (%s, %s, %s, %s, %s) "
                "RETURNING id, clip_id::text, kind, text, ts_sec, operator, created_at::text",
                (clip_id, kind, text.strip(), ts_sec, operator),
            )
            row = cur.fetchone()
        conn.commit()
    return {
        "id": row[0], "clip_id": row[1], "kind": row[2],
        "text": row[3], "ts_sec": float(row[4]) if row[4] is not None else None,
        "operator": row[5], "created_at": row[6],
    }


def list_for_clip(clip_id: str) -> list[dict[str, Any]]:
    with psycopg.connect(_dsn(), connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, kind, text, ts_sec, operator, created_at::text "
                "FROM pd_cctv.operator_corrections "
                "WHERE clip_id::text = %s OR clip_id::text LIKE %s "
                "ORDER BY created_at DESC",
                (clip_id, f"{clip_id}%"),
            )
            rows = cur.fetchall()
    return [
        {"id": r[0], "kind": r[1], "text": r[2],
         "ts_sec": float(r[3]) if r[3] is not None else None,
         "operator": r[4], "created_at": r[5]}
        for r in rows
    ]


def delete_last(clip_id: str) -> dict[str, Any] | None:
    """Pop the most recent correction. Returns the deleted row or None."""
    with psycopg.connect(_dsn(), connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM pd_cctv.operator_corrections "
                "WHERE id = (SELECT id FROM pd_cctv.operator_corrections "
                "            WHERE clip_id::text = %s OR clip_id::text LIKE %s "
                "            ORDER BY created_at DESC LIMIT 1) "
                "RETURNING id, kind, text, ts_sec, created_at::text",
                (clip_id, f"{clip_id}%"),
            )
            row = cur.fetchone()
        conn.commit()
    if not row:
        return None
    return {"id": row[0], "kind": row[1], "text": row[2],
            "ts_sec": float(row[3]) if row[3] is not None else None,
            "created_at": row[4]}
