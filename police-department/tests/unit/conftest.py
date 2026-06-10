"""Shared pytest fixtures for the persona service unit tests.

These tests do NOT touch the cluster, Aurora, or Portkey. The persona
package's external boundaries (LLM, pgvector, redis) are stubbed.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make `app.*` importable from the police-department/personas tree.
PERSONAS_ROOT = Path(__file__).resolve().parents[2] / "personas"
sys.path.insert(0, str(PERSONAS_ROOT))


@pytest.fixture(autouse=True)
def _stub_external(monkeypatch):
    """Replace external IO with deterministic fakes for every test."""
    from app.tools import portkey_llm, pgvector_query, redis_park, custody_log

    def fake_chat_json(system, user, **_kw):
        return {
            "prose": "test prose grounded in CONTEXT",
            "claims": [{"text": "stub claim", "confidence": 0.9,
                        "frame_refs": ["clip:11111111"]}],
        }

    def fake_search(q, k=8):
        return [{
            "narration_id": "n-aaaa",
            "clip_id": "11111111-1111-1111-1111-111111111111",
            "prose": "stub narration",
            "score": 0.87,
            "s3_uri": "s3://bucket/clip.mp4",
            "uploaded_at": "2026-05-04T00:00:00+00:00",
        }]

    def fake_expand(clip_id):
        return {"clip_id": clip_id,
                "entities": [{"entity_id": "e1", "kind": "person", "label": None}],
                "events":   [{"event_id": "v1", "action": "walking",
                              "t_start": 0, "t_end": 3, "confidence": 0.7}]}

    parked: dict[str, dict] = {}

    def fake_park(persona, payload):
        pid = "pid-" + persona[:4]
        parked[pid] = {"persona": persona, "payload": payload}
        return pid

    def fake_consume(pid):
        return parked.pop(pid, None)

    def fake_fetch(pid):
        return parked.get(pid)

    def fake_list_pending(limit=50):
        return [{**v, "pending_approval_id": k} for k, v in parked.items()]

    def fake_log_pending(*a, **kw): return 1
    def fake_log_decision(*a, **kw): return 2

    monkeypatch.setattr(portkey_llm,    "chat_json",     fake_chat_json)
    monkeypatch.setattr(pgvector_query, "search",        fake_search)
    monkeypatch.setattr(pgvector_query, "expand",        fake_expand)
    monkeypatch.setattr(redis_park,     "park",          fake_park)
    monkeypatch.setattr(redis_park,     "consume",       fake_consume)
    monkeypatch.setattr(redis_park,     "fetch",         fake_fetch)
    monkeypatch.setattr(redis_park,     "list_pending",  fake_list_pending)
    monkeypatch.setattr(custody_log,    "log_pending_hitl",  fake_log_pending)
    monkeypatch.setattr(custody_log,    "log_hitl_decision", fake_log_decision)
    yield
