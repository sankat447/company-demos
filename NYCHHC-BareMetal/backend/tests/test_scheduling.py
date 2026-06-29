"""Offline tests for the scheduling engine (FakeAurora). Exercises the full
book / modify / cancel / PTO-impact flow the UI and Copilot share."""

from __future__ import annotations

import pytest

from nychhc_copilot.scheduling import ensure_seeded, service as S
from nychhc_copilot.scheduling.data import TODAY
from nychhc_copilot.tools.providers.fake import FakeAurora


@pytest.fixture()
def aurora():
    a = FakeAurora()
    ensure_seeded(a)
    return a


def test_specialties_and_doctors(aurora):
    specs = S.list_specialties(aurora)
    assert "Cardiology" in specs and "Pulmonology" in specs
    cards = S.list_doctors_by_specialty(aurora, "Cardiology")
    assert len(cards) == 2
    assert all("next_available" in d for d in cards)  # sorted by soonest


def test_calendar_open_booked_blocked(aurora):
    cal = S.get_calendar(aurora, "p1", TODAY)  # Adebayo, has booked appts today
    statuses = {s["status"] for s in cal["slots"]}
    assert "Open" in statuses and "Booked" in statuses
    # p2 (Dr. Lin) has an Approved PTO block on 2026-06-12 → all Blocked.
    blocked = S.get_calendar(aurora, "p2", "2026-06-12")
    assert all(s["status"] == "Blocked" for s in blocked["slots"])


def test_book_then_modify_then_cancel(aurora):
    # Book a new cardiology slot for Robert Castellano.
    b = S.book_appointment(aurora, "SYN-00003", "p3", TODAY, "13:00", type="Follow-up")
    assert b["ok"] and b["provider"] == "Dr. Raj Patel"
    # Double-book same slot fails.
    assert not S.book_appointment(aurora, "SYN-00004", "p3", TODAY, "13:00")["ok"]
    # Modify to a new open time; old slot frees.
    m = S.modify_appointment(aurora, b["appt_id"], time="15:00")
    assert m["ok"] and m["after"]["time"] == "15:00"
    assert S._slot_free(aurora, "p3", TODAY, "13:00")  # old freed
    # Cancel → frees + offers candidates.
    c = S.cancel_appointment(aurora, b["appt_id"], reason="patient request")
    assert c["ok"] and c["freed"]["time"] == "15:00"
    assert isinstance(c["reoffer_candidates"], list)


def test_pto_impact_and_apply(aurora):
    # Tanaka (p7) has a cluster Jun 16-18 → put on PTO Jun 16-20.
    pto = S.request_pto(aurora, "p7", "2026-06-16", "2026-06-20", "Vacation")
    assert pto["ok"]
    impact = S.compute_pto_impact(aurora, "p7", "2026-06-16", "2026-06-20")
    assert impact["impacted_count"] >= 3
    # Some should be auto-resolvable (peer pulmonologist Dr. Haddad free at same time).
    assert impact["auto_resolvable_count"] >= 1
    # Apply the auto-resolvable reassignments.
    plan = [{"appt_id": a["id"], "action": "reassign",
             "provider_id": a["reassign_options"][0]["provider_id"], "time": a["appt_time"], "date": a["appt_date"]}
            for a in impact["impacted"] if a["recommendation"] == "reassign"]
    res = S.apply_reassignments(aurora, plan)
    assert res["ok"] and res["applied"] == len(plan)
    # Re-running impact now shows fewer auto-resolvable for p7 (they moved off p7).
    after = S.compute_pto_impact(aurora, "p7", "2026-06-16", "2026-06-20")
    assert after["impacted_count"] < impact["impacted_count"]
