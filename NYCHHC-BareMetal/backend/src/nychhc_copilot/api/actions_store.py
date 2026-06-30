"""Shared in-process pending-proposal store for the UC6 HITL gate.

The approver queue (`GET /api/actions/pending`) and EVERY path that drafts a proposal —
the REST `POST /api/actions/propose`, the chat `propose_schedule_change` tool, and the
deterministic router — must read/write the SAME store, or a chat-drafted proposal never
appears in the approver queue. Single-replica demo; swap for a Postgres-backed table if
the backend is scaled out.
"""

from __future__ import annotations

import uuid

# Keyed by proposal id. Each value: {action, summary, rationale, payload, source}.
_PENDING: dict[str, dict] = {}


def add_pending(action: str, summary: str, rationale: str = "",
                payload: dict | None = None, source: str = "chat") -> str:
    """Stage a proposal for human review and return its id. Never executes (BR-1)."""
    pid = "prop-" + uuid.uuid4().hex[:10]
    _PENDING[pid] = {"action": action, "summary": summary, "rationale": rationale,
                     "payload": payload or {}, "source": source}
    return pid


def list_pending() -> list[dict]:
    return [{"id": k, **v} for k, v in _PENDING.items()]


def get_pending(pid: str) -> dict | None:
    return _PENDING.get(pid)


def pop_pending(pid: str) -> dict | None:
    return _PENDING.pop(pid, None)
