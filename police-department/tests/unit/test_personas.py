"""Tests for the persona FastAPI app — uses TestClient against a stubbed app."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


def test_healthz_ok(client):
    assert client.get("/healthz").json() == {"status": "ok"}


@pytest.mark.parametrize("persona", ["detective", "patrol", "evidence_clerk"])
def test_chat_returns_pending(client, persona):
    r = client.post(f"/chat/{persona}", json={"q": "what happened"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["persona"] == persona
    assert body["pending_approval_id"]
    assert body["claims"], "stub fixture should produce >=1 claim"
    assert body["provenance"]["narration_ids"]


def test_unknown_persona_404(client):
    r = client.post("/chat/captain", json={"q": "hi"})
    assert r.status_code == 404


def test_hitl_approve_then_inspect_returns_404(client):
    r = client.post("/chat/detective", json={"q": "what happened"})
    pid = r.json()["pending_approval_id"]
    a = client.post(f"/hitl/approve/{pid}", data={"operator": "tester"})
    assert a.status_code == 200
    assert a.json()["status"] == "approved"
    # After consume, inspect should 404.
    follow = client.get(f"/hitl/inspect/{pid}")
    assert follow.status_code == 404


def test_hitl_reject_records_reason(client):
    r = client.post("/chat/patrol", json={"q": "anything"})
    pid = r.json()["pending_approval_id"]
    a = client.post(f"/hitl/reject/{pid}",
                    data={"operator": "tester", "reason": "low confidence"})
    assert a.status_code == 200
    body = a.json()
    assert body["status"] == "rejected"
    assert body["reason"] == "low confidence"


def test_hitl_queue_partial_renders(client):
    # Park two responses so the queue has rows
    client.post("/chat/detective", json={"q": "who"})
    client.post("/chat/patrol", json={"q": "what"})
    r = client.get("/hitl/queue.partial")
    assert r.status_code == 200
    assert "pid-" in r.text  # our stub IDs leak into the rendered html
