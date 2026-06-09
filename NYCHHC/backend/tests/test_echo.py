"""Echo-mode end-to-end tests — no cluster dependencies.

Verifies the scaffold boots, the disclaimer is everywhere (L10), and the SSE
streaming path works.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from nychhc_copilot.disclaimer import DISCLAIMER, DISCLAIMER_ASCII
from nychhc_copilot.main import create_app


def _client() -> TestClient:
    # TestClient runs lifespan, building the EchoCopilot.
    return TestClient(create_app())


def _parse_sse(raw: str) -> tuple[str, list[dict]]:
    """Return (reconstructed answer text, list of meta dicts) from an SSE stream."""
    text_parts: list[str] = []
    metas: list[dict] = []
    event = None
    for line in raw.splitlines():
        if line.startswith("event: "):
            event = line[len("event: "):]
        elif line.startswith("data: "):
            payload = json.loads(line[len("data: "):])
            if event == "token":
                text_parts.append(payload["text"])
            elif event == "meta":
                metas.append(payload)
    return "".join(text_parts), metas


def test_health_ok_and_disclaimer():
    with _client() as c:
        r = c.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["disclaimer"] == DISCLAIMER
        assert body["data"]["status"] == "ok"
        assert body["data"]["mode"] == "echo"


def test_capabilities_lists_all_12_drs():
    with _client() as c:
        r = c.get("/api/capabilities")
        assert r.status_code == 200
        caps = r.json()["data"]
        ids = {cap["id"] for cap in caps}
        assert {f"DR-{n:02d}" for n in range(1, 13)} == ids


def test_chat_streams_tokens_then_meta_with_disclaimer():
    with _client() as c:
        with c.stream("POST", "/api/chat", json={"message": "why is Tuesday understaffed?", "role": "Scheduler"}) as r:
            assert r.status_code == 200
            assert r.headers["X-Demo-Disclaimer"] == DISCLAIMER_ASCII
            raw = "".join(chunk for chunk in r.iter_text())

    text, metas = _parse_sse(raw)
    assert text  # got token content
    assert len(metas) == 1  # exactly one meta event
    assert metas[0]["disclaimer"] == DISCLAIMER  # L10: disclaimer in the envelope
    assert metas[0]["role"] == "Scheduler"


def test_chat_is_role_aware():
    with _client() as c:
        with c.stream("POST", "/api/chat", json={"message": "hi", "role": "HR/Ops"}) as r:
            text, _ = _parse_sse("".join(r.iter_text()))
    assert "HR & operations" in text
