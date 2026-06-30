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
    risk_band,
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

    def execute(self, sql: str, params: tuple = ()) -> int:
        import psycopg  # lazy

        # Service layer writes use `?` placeholders (sqlite style); translate for psycopg.
        pg_sql = sql.replace("?", "%s")
        with psycopg.connect(self.dsn, autocommit=False) as conn:
            with conn.cursor() as cur:
                cur.execute("SET search_path TO workforce, public")
                cur.execute(pg_sql, params)
                rc = cur.rowcount
            conn.commit()
        return rc


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

    def no_show_scores(self, appt_ids: list[str]) -> list[RiskScore]:
        """Fetch the brief's features for each appointment, encode them (the shared
        training/serving contract), POST to the KServe predictor, and map to R/A/G.
        Falls back to the deterministic rules scorer on any error (UC1 degraded)."""
        if not appt_ids:
            return []
        try:
            from datetime import date as _date

            from ...scheduling.seed_data import DOW, encode_features

            ids = ",".join("'" + str(a).replace("'", "") + "'" for a in appt_ids)
            res = self.aurora.query(
                "SELECT a.id, a.appt_date, a.appt_time, a.type, pr.provider_type, "
                "pt.prior_noshows, pt.has_contact, pt.visit_count "
                "FROM sched_appointments a JOIN sched_providers pr ON pr.id = a.provider_id "
                f"JOIN sched_patients pt ON pt.id = a.patient_id WHERE a.id IN ({ids})")
            instances, meta = [], []
            for (aid, d, t, atype, ptype, prior, contact, vc) in res.rows:
                try:
                    dname = DOW[_date.fromisoformat(d).weekday()]
                except Exception:
                    dname = "Monday"
                tod = "AM" if int((t or "09:00").split(":")[0]) < 12 else "PM"
                instances.append(encode_features(atype, dname, tod, prior or 0,
                                                 contact or 0, ptype, vc or 0))
                meta.append((aid, atype, prior, contact, dname, tod))
            preds = self._predict(self.noshow_url, instances)
            out = []
            for (aid, atype, prior, contact, dname, tod), p in zip(meta, preds):
                p = max(0.0, min(1.0, p))
                drivers = []
                if (prior or 0) >= 1:
                    drivers.append(f"{prior} prior no-show(s)")
                if not contact:
                    drivers.append("no contact on file")
                if (dname, tod) in (("Tuesday", "PM"), ("Friday", "PM")):
                    drivers.append(f"{dname} {tod} high-cancel slot")
                out.append(RiskScore(appt_id=aid, score=round(p, 3), band=risk_band(p),
                                     drivers=drivers or [f"{atype} baseline"], source="model"))
            return out
        except Exception:
            if self.fallback is not None:
                return self.fallback.no_show_scores(appt_ids)
            raise

    def coverage_forecast(self, dept_id: int, horizon_days: int) -> list[ForecastPoint]:
        # UC2 coverage planning is handled by scheduling.service.coverage_plan; this
        # legacy KServe hook is retained for the data-API/MCP shims and returns none.
        return []


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
