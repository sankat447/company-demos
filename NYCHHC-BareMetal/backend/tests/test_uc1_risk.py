"""UC1 — tunable risk thresholds (BR-3) + degraded-mode signal."""

from __future__ import annotations

from fastapi.testclient import TestClient

import nychhc_copilot.config as cfg
from nychhc_copilot.main import create_app
from nychhc_copilot.tools.providers.base import risk_band


def _reset_settings():
    cfg._settings = None  # force re-read of env-driven thresholds


def test_risk_band_uses_spec_thresholds(monkeypatch):
    _reset_settings()
    assert risk_band(0.70) == "red"     # > 65%
    assert risk_band(0.50) == "amber"   # 35-65%
    assert risk_band(0.20) == "green"   # < 35%
    # Boundaries: 0.65 is red, 0.35 is amber.
    assert risk_band(0.65) == "red" and risk_band(0.35) == "amber"


def test_thresholds_are_tunable(monkeypatch):
    monkeypatch.setenv("NYCHHC_RISK_RED", "0.80")
    _reset_settings()
    try:
        assert risk_band(0.70) == "amber"   # 0.70 < new red 0.80
        assert risk_band(0.85) == "red"
    finally:
        monkeypatch.delenv("NYCHHC_RISK_RED", raising=False)
        _reset_settings()


def test_model_status_endpoint_reports_source():
    with TestClient(create_app()) as c:
        out = c.get("/api/data/model-status").json()["data"]
    assert "degraded" in out and out["source"] in ("model", "rules")
