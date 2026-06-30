"""UC6 — HITL approval gate: nothing auto-executes; attributable audit; BR-6 block."""

from __future__ import annotations

from fastapi.testclient import TestClient

from nychhc_copilot.main import create_app

HDR = {"x-nychhc-roles": "Approver", "x-nychhc-user": "selamawit"}


def test_propose_then_approve_executes_and_audits():
    with TestClient(create_app()) as c:
        # Propose a reassignment (no execution yet — BR-1).
        prop = c.post("/api/actions/propose", json={
            "action": "pto_reassign", "summary": "Reassign 1 appt off Okonkwo",
            "rationale": "PTO Jun 16", "payload": {"plan": []}}).json()["data"]
        assert prop["status"] == "pending"
        assert c.get("/api/actions/pending").json()["data"], "should be pending"
        # Approve → executes + writes an attributable audit row.
        out = c.post(f"/api/actions/{prop['id']}/decision",
                     headers=HDR, json={"decision": "approve"}).json()["data"]
        assert out["audit"]["actor_user"] == "selamawit"
        assert out["audit"]["decision"] == "approved" and out["audit"]["ts"]
        audit = c.get("/api/actions/audit").json()["data"]
        assert any(a["actor_user"] == "selamawit" for a in audit)


def test_reject_records_no_execution():
    with TestClient(create_app()) as c:
        prop = c.post("/api/actions/propose", json={
            "action": "schedule_change", "summary": "x", "payload": {}}).json()["data"]
        out = c.post(f"/api/actions/{prop['id']}/decision",
                     headers=HDR, json={"decision": "reject"}).json()["data"]
        assert out["executed"] is False and out["audit"]["decision"] == "rejected"


def test_pto_approve_blocks_on_uncovered_window():
    with TestClient(create_app()) as c:
        # Brooks (p9) CME Jul 14-18 overlaps Wu's pending PTO → High-Risk Panel uncovered.
        prop = c.post("/api/actions/propose", json={
            "action": "pto_approve", "summary": "Approve Brooks CME",
            "payload": {"provider_id": "p9", "start": "2026-07-14", "end": "2026-07-18",
                        "pto_id": "pto2"}}).json()["data"]
        out = c.post(f"/api/actions/{prop['id']}/decision",
                     headers=HDR, json={"decision": "approve"}).json()["data"]
        # BR-6: not silently approved — blocked with the conflict surfaced.
        assert out["ok"] is False and out["blocked"] is True
        assert out["conflict"]["breach"] is True
        assert out["audit"]["outcome"] == "blocked"
