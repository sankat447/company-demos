"""Data API tests (echo mode → fakes). Powers the dashboard without the LLM."""

from __future__ import annotations

from fastapi.testclient import TestClient

from nychhc_copilot.disclaimer import DISCLAIMER
from nychhc_copilot.main import create_app


def _client() -> TestClient:
    return TestClient(create_app())


def test_departments():
    with _client() as c:
        body = c.get("/api/data/departments").json()
    assert body["disclaimer"] == DISCLAIMER
    assert any(d["name"] == "Emergency" for d in body["data"])


def test_schedule_has_upcoming_shifts():
    with _client() as c:
        rows = c.get("/api/data/schedule", params={"dept_id": 1, "days": 14}).json()["data"]
    assert rows and {"shift_date", "dept", "provider", "block", "status"} <= set(rows[0])


def test_coverage_flags_tuesday_gap():
    with _client() as c:
        rows = c.get("/api/data/coverage/1", params={"days": 14}).json()["data"]
    assert any(r["understaffed"] for r in rows)


def test_appointment_risk_has_bands():
    with _client() as c:
        rows = c.get("/api/data/appointments/risk", params={"dept_id": 1, "limit": 10}).json()["data"]
    assert rows and rows[0]["risk_band"] in ("red", "amber", "green")


def test_pto_pending_and_decision_returns_impact_and_proposal():
    with _client() as c:
        pending = c.get("/api/data/pto", params={"status": "pending"}).json()["data"]
        assert pending
        pid = pending[0]["pto_id"]
        out = c.post(f"/api/data/pto/{pid}/decision", params={"decision": "approve"}).json()["data"]
    assert out["proposal_id"].startswith("PROP-")
    assert out["status"] == "pending_approval"
    assert "coverage_impact" in out
