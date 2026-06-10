"""Custody-log writer.

INSERTs to pd_cctv.custody_log. UPDATE/DELETE are blocked at the trigger
level (see sql/04_triggers_custody.sql) so this module exposes only inserts.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import psycopg

log = logging.getLogger(__name__)

_DSN = (
    f"host={os.environ.get('PGHOST', '')} "
    f"dbname={os.environ.get('PGDATABASE', 'rhoai_demo')} "
    f"user={os.environ.get('PGUSER', 'rhoai_admin')} "
    f"password={os.environ.get('PGPASSWORD', '')}"
)


def insert(actor: str, action: str, *, clip_id: str | None = None,
           context: dict[str, Any] | None = None) -> int:
    try:
        with psycopg.connect(_DSN, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO pd_cctv.custody_log (clip_id, actor, action, context) "
                    "VALUES (%s, %s, %s, %s) RETURNING id",
                    (clip_id, actor, action, json.dumps(context or {})),
                )
                new_id: int = cur.fetchone()[0]
            conn.commit()
        return new_id
    except Exception as e:
        log.warning("custody_log insert failed (%s) — actor=%s action=%s", e, actor, action)
        return -1


def log_pending_hitl(persona: str, pending_id: str, q: str,
                     *, clip_id: str | None = None) -> int:
    return insert(
        actor=f"persona:{persona}",
        action=f"hitl:pending:{pending_id}",
        clip_id=clip_id,
        context={"persona": persona, "question": q[:500]},
    )


def log_hitl_decision(persona: str, pending_id: str, decision: str,
                      *, operator: str = "operator",
                      clip_id: str | None = None,
                      edit_diff: str | None = None) -> int:
    return insert(
        actor=f"operator:{operator}",
        action=f"hitl:{decision}:{pending_id}",
        clip_id=clip_id,
        context={"persona": persona, "decision": decision, "edit_diff": edit_diff},
    )
