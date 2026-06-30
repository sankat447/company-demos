"""ASK 1-6 (Design Brief 'Ask list') — analytics + chat flows."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from nychhc_copilot.agent.react import route
from nychhc_copilot.config import Settings
from nychhc_copilot.main import create_app
from nychhc_copilot.scheduling import ensure_seeded, service as S
from nychhc_copilot.tools.providers import build_providers


@pytest.fixture()
def p():
    pr = build_providers(Settings())
    ensure_seeded(pr.aurora)
    return pr


# ── ASK 1 — cancellations (advance vs true no-show) + double-block flip ──────
def test_cancellation_split_tue_pm_advance_mon_am_noshow(p):
    cb = S.cancellation_breakdown(p.aurora)
    slot = {(s["day"], s["shift"]): s for s in cb["by_slot"]}
    assert slot[("Tuesday", "PM")]["advance_pct"] > slot[("Tuesday", "PM")]["noshow_pct"]  # advance-heavy
    assert slot[("Monday", "AM")]["noshow_pct"] >= 9                                        # true no-show heavy


def test_template_doubleblock_logic(p):
    recs = {(r["day"], r["shift"]): r for r in S.template_reco(p.aurora)["recommendations"]}
    assert "Do NOT double-block" in recs[("Tuesday", "PM")]["booking"]
    assert "Double-block" in recs[("Monday", "AM")]["booking"]


def test_walkin_scenario_friday(p):
    sc = S.walkin_scenario(p.aurora, "Friday")
    assert sc["weeks"] >= 8 and sc["turned_away"] == 0 and sc["provider_hours_saved"] > 0


# ── ASK 2 — approve-ahead PTO decision support ──────────────────────────────
def test_can_approve_pto_blocks_and_offers_options(p):
    r = S.can_approve_pto(p.aurora, "p9", "2026-07-14", "2026-07-18")  # Brooks vs Wu
    assert r["approvable"] is False and r["options"]


# ── ASK 3 — cycle time + handoff attribution ────────────────────────────────
def test_cycle_time_bottleneck_is_clerical(p):
    ct = S.cycle_time(p.aurora)
    assert ct["cycle_days_recent"] > ct["cycle_days_prior"]
    assert ct["bottleneck"] == "clerical"


# ── ASK 4 — minute-weighted capacity + rebalance ────────────────────────────
def test_load_balance_minute_weighted_rebalance(p):
    lb = S.load_balance(p.aurora)
    by = {d["day"]: d for d in lb["by_day"]}
    assert by["Tuesday"]["utilization_pct"] > by["Monday"]["utilization_pct"]
    assert lb["rebalance"] and "Tuesday" in lb["rebalance"]


def test_load_balance_demand_comes_from_kserve_forecast_model(p):
    # When a model provider is passed, the demand side is the forecast model (served by
    # KServe live; the deterministic stand-in offline). Tuesday must lead by the model's
    # weekday demand profile.
    lb = S.load_balance(p.aurora, p.models)
    assert lb["demand_source"] == "model"
    by = {d["day"]: d for d in lb["by_day"]}
    assert by["Tuesday"]["utilization_pct"] > by["Friday"]["utilization_pct"]
    # the model provider can answer the demand query directly
    md = p.models.demand_forecast()
    assert md["Tuesday"] > md["Friday"] > 0


# ── chat flows ──────────────────────────────────────────────────────────────
def test_router_flows(p):
    def r(q, role="Scheduler"):
        return route(q, p, role=role) or ""
    assert "double-block" in r("Should we double-block Tuesday afternoons?").lower()
    assert "advance" in r("How do cancellations break down by day?").lower()
    assert "provider-hours" in r("Do we need a full-day walk-in provider on Fridays?").lower() or "AM-only" in r("model a half-day Friday walk-in template")
    assert "options" in r("Can I approve PTO for Dr. Wu Jul 14 to Jul 18?").lower()
    assert "cycle time" in r("How is the department performing as a whole?").lower()
    assert "epic" in r("Post a coverage alert to the Epic chat").lower()
    assert "epic" in r("Which specific patients are affected on Sept 9?").lower()
    assert "department" in r("Help me make the case for the chair").lower()


def test_provider_role_cannot_post_to_epic(p):
    out = route("Post a coverage alert to the Epic chat", p, role="Provider")
    assert out and "scheduler" in out.lower()


# ── seed integrity (live-Postgres type contracts; sqlite is typeless) ────────
def test_pto_queue_coverage_gap_is_boolean():
    # coverage_gap is a BOOLEAN column — an int aborts the seed on Postgres and
    # silently empties the analytics tables (appt_history/walkin/cycle). Pin the type.
    from nychhc_copilot.scheduling import seed_data as G
    assert all(isinstance(r[5], bool) for r in G.pto_queue())


def test_all_analytics_tables_seeded(p):
    # the per-table idempotent seed must populate the ASK1/3/4 corpora, not just sched_*
    for t in ("appt_history", "walkin_daily", "cycle_log", "pto_queue"):
        assert p.aurora.query(f"SELECT COUNT(*) FROM {t}").rows[0][0] > 0, t


# ── proactive insights endpoint ─────────────────────────────────────────────
def test_insights_endpoint_surfaces_patterns():
    with TestClient(create_app()) as c:
        items = c.get("/api/data/insights").json()["data"]
    kinds = {i["kind"] for i in items}
    assert {"coverage", "cycle"} & kinds and all("ask" in i for i in items)
