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
    assert "Obstetrics" in specs and "Gynecology" in specs
    obs = S.list_doctors_by_specialty(aurora, "Obstetrics")
    assert len(obs) == 3  # Okonkwo, Stein, Rahman
    assert all("next_available" in d for d in obs)  # sorted by soonest


def test_calendar_open_booked_blocked(aurora):
    cal = S.get_calendar(aurora, "p1", TODAY)  # Okonkwo, has booked appts today
    statuses = {s["status"] for s in cal["slots"]}
    assert "Open" in statuses and "Booked" in statuses
    # p2 (Dr. Stein) has an Approved CME block Jun 17-19 → all Blocked on Jun 17.
    blocked = S.get_calendar(aurora, "p2", "2026-06-17")
    assert all(s["status"] == "Blocked" for s in blocked["slots"])


def test_book_then_modify_then_cancel(aurora):
    # Book a new gynecology slot (Dr. Priya Nair) — 15:00 is free today.
    b = S.book_appointment(aurora, "SYN-00003", "p3", TODAY, "15:00", type="GYN F/U")
    assert b["ok"] and b["provider"] == "Dr. Priya Nair"
    # Double-book same slot fails.
    assert not S.book_appointment(aurora, "SYN-00004", "p3", TODAY, "15:00")["ok"]
    # Modify to a new open time; old slot frees.
    m = S.modify_appointment(aurora, b["appt_id"], time="16:00")
    assert m["ok"] and m["after"]["time"] == "16:00"
    assert S._slot_free(aurora, "p3", TODAY, "15:00")  # old freed
    # Cancel → frees + offers candidates.
    c = S.cancel_appointment(aurora, b["appt_id"], reason="patient request")
    assert c["ok"] and c["freed"]["time"] == "16:00"
    assert isinstance(c["reoffer_candidates"], list)


def test_pto_impact_and_apply(aurora):
    # Okonkwo (p1) has an OB cluster Jun 16-18 → put on PTO Jun 16-20.
    pto = S.request_pto(aurora, "p1", "2026-06-16", "2026-06-20", "Vacation")
    assert pto["ok"]
    impact = S.compute_pto_impact(aurora, "p1", "2026-06-16", "2026-06-20")
    assert impact["impacted_count"] >= 3
    # Some auto-resolvable (peer OB provider Aisha Rahman, PA, free at same time).
    assert impact["auto_resolvable_count"] >= 1
    # Apply the auto-resolvable reassignments.
    plan = [{"appt_id": a["id"], "action": "reassign",
             "provider_id": a["reassign_options"][0]["provider_id"], "time": a["appt_time"], "date": a["appt_date"]}
            for a in impact["impacted"] if a["recommendation"] == "reassign"]
    res = S.apply_reassignments(aurora, plan)
    assert res["ok"] and res["applied"] == len(plan)
    # Re-running impact now shows fewer impacted for p1 (they moved off p1).
    after = S.compute_pto_impact(aurora, "p1", "2026-06-16", "2026-06-20")
    assert after["impacted_count"] < impact["impacted_count"]
