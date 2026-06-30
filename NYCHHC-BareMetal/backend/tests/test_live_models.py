"""Offline tests for LiveModels — feature fetch + KServe v1 contract, no HTTP/DB.

Stubs Aurora (canned rows) and the HTTP predict call, so we verify the mapping
(probabilities→bands, required vs scheduled→understaffed) and the graceful fallback.
"""

from __future__ import annotations

import pytest

from nychhc_copilot.tools.providers.base import QueryResult
from nychhc_copilot.tools.providers.fake import FakeAurora, FakeModels
from nychhc_copilot.tools.providers.live import LiveModels


class StubAurora:
    def query(self, sql: str) -> QueryResult:
        s = sql.lower()
        if "from workforce.appointments" in s:
            # appt_id, lead, prior, age_band, dept
            return QueryResult(["appt_id", "lead", "prior", "age", "dept"],
                               [[1, 15, 3, "40-64", 1], [2, 5, 0, "18-39", 2]], sql)
        if "count(*)" in s and "workforce.shifts" in s:
            return QueryResult(["count"], [[2]], sql)  # scheduled=2
        return QueryResult([], [], sql)


class _Predictable(LiveModels):
    def __init__(self, preds_by_kind, **kw):
        super().__init__("http://noshow/v1", "http://forecast/v1", **kw)
        self._preds = preds_by_kind

    def _predict(self, url, instances):
        kind = "noshow" if "noshow" in url else "forecast"
        if self._preds[kind] == "raise":
            raise RuntimeError("endpoint down")
        return self._preds[kind](instances)


def test_no_show_maps_probabilities_to_bands():
    lm = _Predictable({"noshow": lambda inst: [0.72, 0.18], "forecast": lambda inst: []},
                      aurora=StubAurora())
    scores = lm.no_show_scores([1, 2])
    by_id = {s.appt_id: s for s in scores}
    assert by_id[1].band == "red" and by_id[1].source == "model"
    assert "3 prior no-shows" in by_id[1].drivers and "15-day lead time" in by_id[1].drivers
    assert by_id[2].band == "green"


def test_coverage_forecast_flags_when_required_exceeds_scheduled():
    lm = _Predictable({"noshow": lambda inst: [], "forecast": lambda inst: [4.0] * len(inst)},
                      aurora=StubAurora())
    pts = lm.coverage_forecast(1, 3)
    assert len(pts) == 3
    assert all(p.required == 4 and p.projected == 2 for p in pts)
    assert all(p.understaffed for p in pts)  # 2 scheduled < 4 required


def test_falls_back_to_fake_on_endpoint_error():
    fallback = FakeModels(FakeAurora())
    lm = _Predictable({"noshow": "raise", "forecast": "raise"},
                      aurora=StubAurora(), fallback=fallback)
    scores = lm.no_show_scores([1, 2, 3])
    assert scores and all(s.source == "fallback" for s in scores)
