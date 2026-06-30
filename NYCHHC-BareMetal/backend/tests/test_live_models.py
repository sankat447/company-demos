"""LiveModels — feature fetch + KServe v1 contract + graceful fallback (no HTTP/DB)."""

from __future__ import annotations

from nychhc_copilot.scheduling import ensure_seeded
from nychhc_copilot.tools.providers.base import QueryResult
from nychhc_copilot.tools.providers.fake import FakeAurora, FakeModels
from nychhc_copilot.tools.providers.live import LiveModels


class StubAurora:
    def query(self, sql: str) -> QueryResult:
        if "from sched_appointments" in sql.lower():
            # id, appt_date, appt_time, type, provider_type, prior_noshows, has_contact, visit_count
            return QueryResult(
                ["id", "appt_date", "appt_time", "type", "provider_type",
                 "prior_noshows", "has_contact", "visit_count"],
                [["a1", "2026-06-09", "14:00", "New OB", "MD", 5, 0, 3],
                 ["a2", "2026-06-15", "09:00", "Follow-up", "MD", 0, 1, 8]], sql)
        return QueryResult([], [], sql)


class _Predictable(LiveModels):
    def __init__(self, preds, **kw):
        super().__init__("http://noshow/v1", "http://forecast/v1", **kw)
        self._preds = preds

    def _predict(self, url, instances):
        if self._preds == "raise":
            raise RuntimeError("endpoint down")
        return self._preds(instances)


def test_no_show_maps_probabilities_to_bands():
    lm = _Predictable(lambda inst: [0.80, 0.10], aurora=StubAurora())
    by_id = {s.appt_id: s for s in lm.no_show_scores(["a1", "a2"])}
    assert by_id["a1"].band == "red" and by_id["a1"].source == "model"
    assert any("prior" in d for d in by_id["a1"].drivers)
    assert any("no contact" in d for d in by_id["a1"].drivers)
    assert by_id["a2"].band == "green"


def test_coverage_forecast_is_legacy_noop():
    lm = _Predictable(lambda inst: [], aurora=StubAurora())
    assert lm.coverage_forecast(1, 14) == []   # UC2 uses service.coverage_plan now


def test_falls_back_to_rules_on_endpoint_error():
    fa = FakeAurora(); ensure_seeded(fa)
    lm = _Predictable("raise", aurora=StubAurora(), fallback=FakeModels(fa))
    scores = lm.no_show_scores(["a1"])
    assert scores and all(s.source == "fallback" for s in scores)
