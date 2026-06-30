"""Lightweight per-session conversation memory for the chat assistant.

Keeps a bounded transcript per session_id so the LLM path sees prior turns, plus a
small per-session context bag the deterministic router uses for follow-ups (e.g.
remembering the last PTO-impact so "apply all auto" works). In-process (single
replica demo); not durable across restarts. No PHI is stored — synthetic only.
"""

from __future__ import annotations


class SessionMemory:
    def __init__(self, max_msgs: int = 16, max_sessions: int = 500) -> None:
        self._max_msgs = max_msgs
        self._max_sessions = max_sessions
        self._sessions: dict[str, dict] = {}

    def _s(self, sid: str) -> dict:
        s = self._sessions.get(sid)
        if s is None:
            if len(self._sessions) >= self._max_sessions:
                self._sessions.pop(next(iter(self._sessions)))  # evict oldest (FIFO)
            s = self._sessions[sid] = {"history": [], "context": {}}
        return s

    def append(self, sid: str, role: str, content: str) -> None:
        if not content:
            return
        h = self._s(sid)["history"]
        h.append({"role": role, "content": content})
        if len(h) > self._max_msgs:
            del h[: len(h) - self._max_msgs]

    def history(self, sid: str, limit: int | None = None) -> list[dict]:
        h = self._s(sid)["history"]
        return list(h if limit is None else h[-limit:])

    def set_context(self, sid: str, key: str, value) -> None:
        self._s(sid)["context"][key] = value

    def get_context(self, sid: str, key: str, default=None):
        return self._s(sid)["context"].get(key, default)

    def clear_context(self, sid: str, key: str) -> None:
        self._s(sid)["context"].pop(key, None)

    def reset(self, sid: str) -> None:
        self._sessions.pop(sid, None)
