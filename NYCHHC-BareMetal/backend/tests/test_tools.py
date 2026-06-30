"""Offline tests for the tool layer (fake providers + LangChain tools)."""

from __future__ import annotations

from nychhc_copilot.config import Settings
from nychhc_copilot.tools import build_tools
from nychhc_copilot.tools.providers import build_providers


def _providers():
    # echo mode + blank DSN → fakes
    return build_providers(Settings())


def test_factory_uses_fakes_without_config():
    p = _providers()
    assert p.using_fakes is True


def test_query_readonly_guard_blocks_writes():
    p = _providers()
    tools = {t.name: t for t in build_tools(p)}
    out = tools["query_workforce_db"].invoke({"sql": "DELETE FROM appointments"})
    assert "rejected" in out.lower()


def test_query_returns_rows_markdown():
    p = _providers()
    tools = {t.name: t for t in build_tools(p)}
    out = tools["query_workforce_db"].invoke({"sql": "SELECT name, role FROM providers LIMIT 3"})
    assert "| name | role |" in out
    assert "Dr. Amara Okonkwo" in out


def test_no_show_rate_query_is_computable():
    """The hero report DR-12: no-show rate by provider."""
    p = _providers()
    res = p.aurora.query(
        "SELECT provider_id, "
        "ROUND(100.0*SUM(CASE WHEN outcome='no_show' THEN 1 ELSE 0 END)/COUNT(*),1) AS no_show_pct "
        "FROM appointments GROUP BY provider_id ORDER BY no_show_pct DESC"
    )
    assert res.columns == ["provider_id", "no_show_pct"]
    assert len(res.rows) >= 1


def test_coverage_forecast_flags_only_the_tuesday_gap():
    """DR-08/UC2: Inpatient OB (dept 1) has ONE engineered understaffed day — next Tuesday."""
    from datetime import date, timedelta

    p = _providers()
    pts = p.models.coverage_forecast(1, 14)
    flagged = [pt for pt in pts if pt.understaffed]
    # Exactly one understaffed day-block, and it falls on a Tuesday.
    assert len(flagged) == 1
    gap = date.fromisoformat(flagged[0].date)
    assert gap.weekday() == 1  # Tuesday
    assert gap > date.today()
    # A different department with no gap is fully covered.
    assert not any(pt.understaffed for pt in p.models.coverage_forecast(3, 14))


def test_no_show_risk_bands():
    p = _providers()
    tools = {t.name: t for t in build_tools(p)}
    out = tools["no_show_risk"].invoke({"appt_ids": [1, 2, 3, 9]})
    assert any(band in out for band in ("RED", "AMBER", "GREEN"))


def test_schedule_change_requires_approval():
    p = _providers()
    tools = {t.name: t for t in build_tools(p)}
    out = tools["propose_schedule_change"].invoke({"summary": "Backfill Inpatient OB Tue day block"})
    assert "pending_approval" in out
    assert "PROP-" in out
