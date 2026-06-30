"""Data API tests (echo mode → fakes). Powers the dashboard + planning panes."""

from __future__ import annotations

from fastapi.testclient import TestClient

from nychhc_copilot.disclaimer import DISCLAIMER
from nychhc_copilot.main import create_app


def _client() -> TestClient:
    return TestClient(create_app())


def test_roster_and_disclaimer():
    with _client() as c:
        body = c.get("/api/data/roster").json()
    assert body["disclaimer"] == DISCLAIMER
    assert any("Chen" in r["name"] for r in body["data"])  # 12 named providers


def test_risk_list_daniel_brooks_first():
    with _client() as c:
        rows = c.get("/api/data/risk-list").json()["data"]
    assert rows[0]["patient_name"] == "Daniel Brooks" and rows[0]["risk_pct"] == 87


def test_coverage_plan_flags_high_risk_panel_gap():
    with _client() as c:
        plan = c.get("/api/data/coverage").json()["data"]
    assert plan["gap_count"] >= 1
    assert "High-Risk Panel" in plan["by_service_line"]


def test_load_balance_and_template():
    with _client() as c:
        lb = c.get("/api/data/load-balance").json()["data"]
        tpl = c.get("/api/data/template").json()["data"]
    assert {d["day"] for d in lb["by_day"]} >= {"Monday", "Tuesday", "Friday"}
    tue_pm = [r for r in tpl["recommendations"] if r["day"] == "Tuesday" and r["shift"] == "PM"]
    assert tue_pm and "NOT double-block" in tue_pm[0]["booking"]


def test_model_status_reports_source():
    with _client() as c:
        out = c.get("/api/data/model-status").json()["data"]
    assert "degraded" in out and out["source"] in ("model", "rules")
