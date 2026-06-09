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
                cur.execute(stripped)
                cols = [d.name for d in cur.description] if cur.description else []
                rows = [list(r) for r in cur.fetchall()]
            conn.rollback()
        return QueryResult(columns=cols, rows=rows, sql=stripped)


class LiveModels(ModelProvider):
    """Calls the two KServe endpoints. Falls back to `fallback` on any error (D5)."""

    def __init__(self, noshow_url: str, forecast_url: str,
                 fallback: ModelProvider | None = None, timeout_s: float = 10.0) -> None:
        self.noshow_url = noshow_url
        self.forecast_url = forecast_url
        self.fallback = fallback
        self.timeout_s = timeout_s

    def _post(self, url: str, payload: dict) -> dict:
        import httpx  # lazy

        with httpx.Client(timeout=self.timeout_s) as client:
            r = client.post(url, json=payload)
            r.raise_for_status()
            return r.json()

    def no_show_scores(self, appt_ids: list[int]) -> list[RiskScore]:
        try:
            # KServe v1: {"instances": [[appt_id], ...]} → server joins features itself.
            data = self._post(self.noshow_url, {"instances": [[int(a)] for a in appt_ids]})
            out = []
            for appt_id, pred in zip(appt_ids, data.get("predictions", [])):
                p = float(pred if not isinstance(pred, dict) else pred.get("score", 0.0))
                band = "red" if p >= 0.6 else "amber" if p >= 0.3 else "green"
                out.append(RiskScore(appt_id=appt_id, score=round(p, 3), band=band, source="model"))
            return out
        except Exception:
            if self.fallback is not None:
                return self.fallback.no_show_scores(appt_ids)
            raise

    def coverage_forecast(self, dept_id: int, horizon_days: int) -> list[ForecastPoint]:
        try:
            data = self._post(self.forecast_url, {"instances": [[int(dept_id), int(horizon_days)]]})
            return [
                ForecastPoint(dept_id=dept_id, date=p["date"], block=p.get("block", "day"),
                              required=float(p["required"]), projected=float(p["projected"]))
                for p in data.get("predictions", [])
            ]
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
