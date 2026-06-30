"""UC4 — PTO overlap-conflict + service-line coverage minimum (BR-4/6)."""

from __future__ import annotations

import pytest

from nychhc_copilot.scheduling import ensure_seeded, service as S
from nychhc_copilot.tools.providers.fake import FakeAurora


@pytest.fixture()
def aurora():
    a = FakeAurora()
    ensure_seeded(a)
    return a


def test_overlap_conflict_surfaces_uncovered_window(aurora):
    # Stein (p2) already has Approved OB leave Jun 17-19 (seeded). Okonkwo (p1) requests
    # Jun 16-20 → both Inpatient OB out Jun 17-19, below the 2-provider minimum.
    S.request_pto(aurora, "p1", "2026-06-16", "2026-06-20", "Vacation")
    conf = S.coverage_conflict(aurora, "p1", "2026-06-16", "2026-06-20")
    assert conf["service_line"] == "Inpatient OB" and conf["minimum"] == 2
    assert conf["breach"] is True
    # The uncovered window is the overlap with Stein's leave.
    assert {"2026-06-17", "2026-06-18", "2026-06-19"} <= set(conf["uncovered_dates"])
    assert any("Stein" in o["provider"] for o in conf["overlapping_leave"])
    assert conf["mitigation"]


def test_no_conflict_for_isolated_leave(aurora):
    # A Gynecology provider (minimum 1, team of 3) taking leave alone → no breach.
    conf = S.coverage_conflict(aurora, "p3", "2026-07-01", "2026-07-03")
    assert conf["breach"] is False and conf["uncovered_dates"] == []


def test_impact_includes_conflict_block(aurora):
    S.request_pto(aurora, "p1", "2026-06-16", "2026-06-20", "Vacation")
    imp = S.compute_pto_impact(aurora, "p1", "2026-06-16", "2026-06-20")
    assert imp["conflict"]["breach"] is True
