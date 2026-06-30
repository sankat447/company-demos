"""Offline tests for the scheduling engine (FakeAurora) on the OBGYN dataset."""

from __future__ import annotations

import pytest

from nychhc_copilot.scheduling import ensure_seeded, service as S
from nychhc_copilot.scheduling.seed_data import TODAY
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
    assert len(obs) == 4  # Chen, Santos, Nair, Okafor
    assert all("next_available" in d for d in obs)


def test_calendar_open_booked_blocked(aurora):
    cal = S.get_calendar(aurora, "p1", TODAY)  # Dr. Chen — booked appts today
    statuses = {s["status"] for s in cal["slots"]}
    assert "Open" in statuses and "Booked" in statuses
    # p2 (Dr. Patel) has Approved PTO Jun 26 – Jul 10 → all Blocked on Jun 26.
    blocked = S.get_calendar(aurora, "p2", "2026-06-26")
    assert all(s["status"] == "Blocked" for s in blocked["slots"])


def test_book_then_modify_then_cancel(aurora):
    b = S.book_appointment(aurora, "PT0021", "p2", TODAY, "16:00", type="GYN Consult")
    assert b["ok"] and b["provider"] == "Dr. Raj Patel"
    assert not S.book_appointment(aurora, "PT0088", "p2", TODAY, "16:00")["ok"]  # double-book
    m = S.modify_appointment(aurora, b["appt_id"], time="16:30")
    assert m["ok"] and m["after"]["time"] == "16:30"
    assert S._slot_free(aurora, "p2", TODAY, "16:00")  # old freed
    c = S.cancel_appointment(aurora, b["appt_id"], reason="patient request")
    assert c["ok"] and c["freed"]["time"] == "16:30"


def test_pto_impact_and_apply(aurora):
    # Book two OB appts for Dr. Chen (p1) in the PTO window so impact is deterministic.
    S.book_appointment(aurora, "PT0088", "p1", "2026-06-17", "10:00", type="Follow-up")
    S.book_appointment(aurora, "PT0134", "p1", "2026-06-17", "11:00", type="Follow-up")
    S.request_pto(aurora, "p1", "2026-06-16", "2026-06-20", "Vacation")
    impact = S.compute_pto_impact(aurora, "p1", "2026-06-16", "2026-06-20")
    assert impact["impacted_count"] >= 2
    assert impact["auto_resolvable_count"] >= 1  # peer OB provider free at the same time
    plan = [{"appt_id": a["id"], "provider_id": a["reassign_options"][0]["provider_id"],
             "date": a["appt_date"], "time": a["appt_time"]}
            for a in impact["impacted"] if a["recommendation"] == "reassign"]
    res = S.apply_reassignments(aurora, plan)
    assert res["ok"] and res["applied"] == len(plan)
    after = S.compute_pto_impact(aurora, "p1", "2026-06-16", "2026-06-20")
    assert after["impacted_count"] < impact["impacted_count"]
