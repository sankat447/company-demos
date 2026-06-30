"""Offline tests for the tool layer (fake providers + LangChain tools)."""

from __future__ import annotations

from nychhc_copilot.config import Settings
from nychhc_copilot.scheduling import ensure_seeded
from nychhc_copilot.tools import build_tools
from nychhc_copilot.tools.providers import build_providers


def _providers():
    p = build_providers(Settings())  # echo + blank DSN → fakes
    ensure_seeded(p.aurora)
    return p


def test_factory_uses_fakes_without_config():
    assert _providers().using_fakes is True


def test_query_readonly_guard_blocks_writes():
    tools = {t.name: t for t in build_tools(_providers())}
    out = tools["query_workforce_db"].invoke({"sql": "DELETE FROM sched_appointments"})
    assert "rejected" in out.lower()


def test_query_returns_rows_markdown():
    tools = {t.name: t for t in build_tools(_providers())}
    out = tools["query_workforce_db"].invoke({"sql": "SELECT name, credential FROM sched_providers LIMIT 3"})
    assert "| name | credential |" in out
    assert "Dr. Sarah Chen" in out


def test_no_show_rate_query_is_computable():
    """UC1/analytics: no-show rate by provider over the history corpus."""
    res = _providers().aurora.query(
        "SELECT provider_id, ROUND(100.0*SUM(actual_noshow)/COUNT(*),1) AS rate "
        "FROM appt_history GROUP BY provider_id ORDER BY rate DESC")
    assert res.columns[0] == "provider_id" and len(res.rows) >= 1


def test_coverage_plan_tool_lists_gaps():
    tools = {t.name: t for t in build_tools(_providers())}
    out = tools["coverage_plan"].invoke({"horizon_days": 90})
    assert "High-Risk Panel" in out or "below minimum" in out


def test_template_optimization_flags_tuesday_pm():
    tools = {t.name: t for t in build_tools(_providers())}
    out = tools["template_optimization"].invoke({})
    assert "Tuesday PM" in out


def test_no_show_risk_bands():
    tools = {t.name: t for t in build_tools(_providers())}
    out = tools["no_show_risk"].invoke({"appt_ids": ["a1", "a2", "a3"]})
    assert any(band in out for band in ("RED", "AMBER", "GREEN"))


def test_schedule_change_requires_approval():
    tools = {t.name: t for t in build_tools(_providers())}
    out = tools["propose_schedule_change"].invoke({"summary": "Backfill Inpatient OB Tue PM"})
    assert "pending_approval" in out and "PROP-" in out
