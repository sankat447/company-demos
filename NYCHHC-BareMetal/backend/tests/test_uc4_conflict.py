"""UC4 — PTO overlap-conflict + service-line coverage minimum (BR-4/6).

Scripted conflict from the brief: Dr. Brooks (CME Jul 14-18) overlaps Dr. Wu
(PTO Jul 7-21); both staff the High-Risk Panel (minimum 1) → uncovered Jul 14-18.
"""

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
    conf = S.coverage_conflict(aurora, "p9", "2026-07-14", "2026-07-18")  # Brooks
    assert conf["service_line"] == "High-Risk Panel" and conf["minimum"] == 1
    assert conf["breach"] is True
    assert {"2026-07-14", "2026-07-18"} <= set(conf["uncovered_dates"])
    assert any("Wu" in o["provider"] for o in conf["overlapping_leave"])
    assert conf["mitigation"]


def test_no_conflict_for_isolated_leave(aurora):
    # A Gynecology provider alone (team of 3, min 1), no other GYN leave in the window.
    conf = S.coverage_conflict(aurora, "p4", "2026-08-01", "2026-08-03")
    assert conf["breach"] is False and conf["uncovered_dates"] == []


def test_impact_includes_conflict_block(aurora):
    imp = S.compute_pto_impact(aurora, "p9", "2026-07-14", "2026-07-18")
    assert imp["conflict"]["breach"] is True
