"""UC8 — Epic MCP adapter: FHIR-shaped tools + typed errors + REST surface."""

from __future__ import annotations

from fastapi.testclient import TestClient

from nychhc_copilot.config import Settings
from nychhc_copilot.main import create_app
from nychhc_copilot.mcp import EPIC_TOOLS, EpicAdapter, EpicError
from nychhc_copilot.scheduling import ensure_seeded
from nychhc_copilot.tools.providers import build_providers


def _adapter() -> EpicAdapter:
    p = build_providers(Settings())
    ensure_seeded(p.aurora)
    return EpicAdapter(p)


def test_get_provider_schedule_is_fhir_appointment_shaped():
    appts = _adapter().get_provider_schedule("p1", "2026-06-09")  # Okonkwo, booked today
    assert appts, "expected booked appointments"
    a = appts[0]
    assert a["resourceType"] == "Appointment"
    assert a["status"] in ("booked", "cancelled", "free")
    assert "start" in a and "T" in a["start"]                 # FHIR datetime
    refs = [p["actor"]["reference"] for p in a["participant"]]
    assert any(r.startswith("Patient/") for r in refs)
    assert any(r.startswith("Practitioner/") for r in refs)


def test_check_slot_availability_returns_free_slots():
    slots = _adapter().check_slot_availability("p3", "2026-06-09")  # Nair, has open slots
    assert slots and all(s["resourceType"] == "Slot" and s["status"] == "free" for s in slots)


def test_typed_error_on_unknown_provider():
    try:
        _adapter().get_provider_schedule("nope", "2026-06-09")
        assert False, "expected EpicError"
    except EpicError as e:
        assert e.code == "not_found"


def test_unknown_tool_is_typed_error():
    try:
        _adapter().call("delete_everything")
        assert False, "expected EpicError"
    except EpicError as e:
        assert e.code == "unknown_tool"


def test_rest_lists_tools_and_calls_one():
    with TestClient(create_app()) as c:
        tools = c.get("/api/mcp/tools").json()["data"]
        assert {t["name"] for t in tools} == set(EPIC_TOOLS)
        out = c.post("/api/mcp/call", json={"tool": "get_risk_scores", "args": {}}).json()["data"]
        assert out["degraded"] is False and isinstance(out["result"], list)
        # Unknown tool → typed error + degraded flag (no fabrication).
        bad = c.post("/api/mcp/call", json={"tool": "bogus", "args": {}}).json()["data"]
        assert bad["degraded"] is True and bad["error"]["code"] == "unknown_tool"
