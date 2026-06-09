"""Live providers — Aurora (psycopg), KServe models (httpx), n8n (httpx).

Heavy deps (psycopg/httpx) are imported lazily so the package loads in echo mode
without the `data`/`agent` extras. Not exercised by offline tests; the factory in
``tools/__init__.py`` only builds these when the relevant config is present.
"""

from __future__ import annotations

from .base import (
    AuroraProvider,
    ChangeProposal,
    ForecastPoint,
    ModelProvider,
    QueryResult,
    ReadOnlySQLError,
    RiskScore,
    WorkflowProvider,
)

_DISALLOWED = (" insert ", " update ", " delete ", " drop ", " alter ", " create ", " grant ")


def _guard_readonly(sql: str) -> str:
    stripped = sql.strip().rstrip(";")
    low = f" {stripped.lower()} "
    if not stripped.lower().lstrip("(").startswith(("select", "with")):
        raise ReadOnlySQLError("Only read-only SELECT/WITH queries are permitted.")
    for kw in _DISALLOWED:
        if kw in low:
            raise ReadOnlySQLError(f"Disallowed keyword in query: {kw.strip()}")
    return stripped


class LiveAurora(AuroraProvider):
    def __init__(self, dsn: str, statement_timeout_ms: int = 8000) -> None:
        self.dsn = dsn
        self.statement_timeout_ms = statement_timeout_ms

    def query(self, sql: str) -> QueryResult:
        import psycopg  # lazy

        stripped = _guard_readonly(sql)
        # Read-only transaction + statement timeout — defense in depth for text-to-SQL.
        with psycopg.connect(self.dsn, autocommit=False) as conn:
            with conn.cursor() as cur:
                cur.execute(f"SET statement_timeout = {int(self.statement_timeout_ms)}")
                cur.execute("SET TRANSACTION READ ONLY")
                # Demo tables live in the `workforce` schema; resolve unqualified
                # names there so the LLM's SCHEMA_DOC SQL works without prefixes.
                cur.execute("SET search_path TO workforce, public")
                cur.execute(stripped)
                cols = [d.name for d in cur.description] if cur.description else []
                rows = [list(r) for r in cur.fetchall()]
            conn.rollback()
        return QueryResult(columns=cols, rows=rows, sql=stripped)


# Age-band → ordinal must match models/common.AGE_BANDS (the training contract).
_AGE_ORD = {"0-17": 0, "18-39": 1, "40-64": 2, "65+": 3}


class LiveModels(ModelProvider):
    """Calls the two KServe endpoints (protocol v1: {"instances"}→{"predictions"}).

    A KServe model can't resolve appt_id→features, so we fetch features from Aurora
    here and POST vectors. Falls back to `fallback` on any error (D5).
    """

    def __init__(self, noshow_url: str, forecast_url: str, aurora: AuroraProvider,
                 fallback: ModelProvider | None = None, timeout_s: float = 10.0) -> None:
        self.noshow_url = noshow_url
        self.forecast_url = forecast_url
        self.aurora = aurora
        self.fallback = fallback
        self.timeout_s = timeout_s

    def _predict(self, url: str, instances: list[list[float]]) -> list[float]:
        import httpx  # lazy

        with httpx.Client(timeout=self.timeout_s) as client:
            r = client.post(url, json={"instances": instances})
            r.raise_for_status()
            return [float(p) for p in r.json().get("predictions", [])]

    def no_show_scores(self, appt_ids: list[int]) -> list[RiskScore]:
        if not appt_ids:
            return []
        try:
            ids = ",".join(str(int(a)) for a in appt_ids)
            res = self.aurora.query(
                "SELECT appt_id, lead_time_days, prior_noshows, age_band, dept_id "
                f"FROM workforce.appointments WHERE appt_id IN ({ids})"
            )
            # Feature order MUST match models/common.NOSHOW_FEATURES.
            instances, ordered_ids, feats = [], [], []
            for appt_id, lead, prior, age_band, dept in res.rows:
                instances.append([float(lead or 0), float(prior or 0),
                                  float(_AGE_ORD.get(age_band, 2)), float(dept)])
                ordered_ids.append(appt_id)
                feats.append((prior, lead))
            preds = self._predict(self.noshow_url, instances)
            out = []
            for appt_id, p, (prior, lead) in zip(ordered_ids, preds, feats):
                p = max(0.0, min(1.0, p))
                band = "red" if p >= 0.6 else "amber" if p >= 0.3 else "green"
                drivers = []
                if (prior or 0) >= 2:
                    drivers.append(f"{prior} prior no-shows")
                if (lead or 0) > 10:
                    drivers.append(f"{lead}-day lead time")
                out.append(RiskScore(appt_id=appt_id, score=round(p, 3), band=band,
                                     drivers=drivers or ["baseline"], source="model"))
            return out
        except Exception:
            if self.fallback is not None:
                return self.fallback.no_show_scores(appt_ids)
            raise

    def coverage_forecast(self, dept_id: int, horizon_days: int) -> list[ForecastPoint]:
        from datetime import date, timedelta

        try:
            today = date.today()
            days = [today + timedelta(days=d) for d in range(horizon_days)]
            # Model predicts required staff from [dept_id, day_of_week].
            required = self._predict(self.forecast_url, [[float(dept_id), float(d.weekday())] for d in days])
            pts = []
            for day, req in zip(days, required):
                scheduled = self.aurora.query(
                    f"SELECT COUNT(*) FROM workforce.shifts WHERE dept_id={int(dept_id)} "
                    f"AND shift_date='{day.isoformat()}' AND block='day' AND status='scheduled'"
                ).rows[0][0]
                pts.append(ForecastPoint(dept_id=dept_id, date=day.isoformat(), block="day",
                                         required=round(float(req)), projected=float(scheduled)))
            return pts
        except Exception:
            if self.fallback is not None:
                return self.fallback.coverage_forecast(dept_id, horizon_days)
            raise


class LiveWorkflow(WorkflowProvider):
    def __init__(self, n8n_webhook_url: str, timeout_s: float = 10.0) -> None:
        self.n8n_webhook_url = n8n_webhook_url
        self.timeout_s = timeout_s
        self._n = 0

    def propose_schedule_change(self, summary: str, payload: dict) -> ChangeProposal:
        import httpx  # lazy

        self._n += 1
        proposal_id = f"PROP-{self._n:04d}"
        # n8n receives the draft and drives human-in-the-loop approval (D7).
        with httpx.Client(timeout=self.timeout_s) as client:
            client.post(self.n8n_webhook_url,
                        json={"proposal_id": proposal_id, "summary": summary, "payload": payload})
        return ChangeProposal(proposal_id=proposal_id, summary=summary)
