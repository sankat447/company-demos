"""In-memory per-clip chat history.

Demo-grade: lives in the persona pod's process. A pod restart loses
history. For multi-replica + persistent history, swap to Redis (the
platform already has redis.ai-demo.svc:6379) — TTL'd LIST per
clip_id with JSON-encoded entries.
"""
from __future__ import annotations

from collections import defaultdict, deque
from threading import Lock
from typing import Any

_MAX_PER_CLIP = 100
_lock = Lock()
_store: dict[str, deque] = defaultdict(lambda: deque(maxlen=_MAX_PER_CLIP))


def append(clip_id: str, entry: dict[str, Any]) -> None:
    if not clip_id:
        return
    with _lock:
        _store[clip_id].append(entry)


def history(clip_id: str) -> list[dict[str, Any]]:
    with _lock:
        return list(_store.get(clip_id, ()))


def clear(clip_id: str) -> None:
    with _lock:
        _store.pop(clip_id, None)
