"""Park persona responses in Redis pending HITL approval (10-min TTL)."""
from __future__ import annotations

import json
import os
import uuid
from functools import lru_cache
from typing import Any

import redis

_TTL_SEC = int(os.environ.get("PD_HITL_TTL_SEC", "600"))


@lru_cache(maxsize=1)
def client() -> redis.Redis:
    host = os.environ.get("REDIS_HOST", "redis.ai-demo.svc")
    port = int(os.environ.get("REDIS_PORT", "6379"))
    return redis.Redis(host=host, port=port, decode_responses=True)


def _key(pending_id: str) -> str:
    return f"pd:hitl:{pending_id}"


def park(persona: str, payload: dict[str, Any]) -> str:
    pending_id = str(uuid.uuid4())
    client().setex(_key(pending_id), _TTL_SEC,
                   json.dumps({"persona": persona, "payload": payload}))
    return pending_id


def fetch(pending_id: str) -> dict[str, Any] | None:
    raw = client().get(_key(pending_id))
    return json.loads(raw) if raw else None


def consume(pending_id: str) -> dict[str, Any] | None:
    """Atomically read+delete (single round-trip)."""
    pipe = client().pipeline()
    pipe.get(_key(pending_id))
    pipe.delete(_key(pending_id))
    raw, _ = pipe.execute()
    return json.loads(raw) if raw else None


def list_pending(limit: int = 50) -> list[dict[str, Any]]:
    keys = list(client().scan_iter("pd:hitl:*", count=limit))[:limit]
    if not keys:
        return []
    raws = client().mget(keys)
    out = []
    for k, raw in zip(keys, raws):
        if not raw:
            continue
        d = json.loads(raw)
        d["pending_approval_id"] = k.split(":", 2)[2]
        out.append(d)
    return out
