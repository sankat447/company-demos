"""Offline fakes for the tool providers.

A deterministic in-memory SQLite stand-in for the `workforce` schema. Tables and
data come from scheduling.seed.ensure_seeded() driven by the single-source
generator (seed_data.py) — this module only provides the SQLite connection (with
PG→SQLite DDL translation) and rules-based model/workflow stand-ins. NO PHI.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import date

from .base import (  # noqa: F401  (re-exported for callers)
    AuroraProvider, ChangeProposal, ForecastPoint, ModelProvider, QueryResult,
    ReadOnlySQLError, RiskScore, WorkflowProvider, risk_band,
)
from ...scheduling import seed_data as G

_DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _pg_to_sqlite_ddl(sql: str) -> str:
    sql = re.sub(r"serial\s+PRIMARY\s+KEY", "INTEGER PRIMARY KEY AUTOINCREMENT", sql, flags=re.I)
    sql = re.sub(r"\bboolean\b", "integer", sql, flags=re.I)
    return sql


class FakeAurora(AuroraProvider):
    """In-memory SQLite mirroring the workforce schema (seeded by ensure_seeded)."""

    def __init__(self) -> None:
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)

    def execute(self, sql: str, params: tuple = ()) -> int:
        if sql.lstrip().lower().startswith("create"):
            sql = _pg_to_sqlite_ddl(sql)
        cur = self.conn.execute(sql, params)
        self.conn.commit()
        return cur.rowcount

    def query(self, sql: str) -> QueryResult:
        stripped = sql.strip().rstrip(";").lstrip("(")
        low = stripped.lower()
        if not low.startswith(("select", "with")):
            raise ReadOnlySQLError("Only read-only SELECT/WITH queries are permitted.")
        for kw in (" insert ", " update ", " delete ", " drop ", " alter ", " create ", "attach "):
            if kw in f" {low} ":
                raise ReadOnlySQLError(f"Disallowed keyword in query: {kw.strip()}")
        cur = self.conn.execute(stripped)
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = [list(r) for r in cur.fetchall()]
        return QueryResult(columns=cols, rows=rows, sql=stripped)


def score_noshow(aurora, appt_ids: list[str]) -> list[RiskScore]:
    """Rules-based no-show scoring over the live schedule, using the brief's
    multipliers (the deterministic fallback when the KServe model is unreachable).
    Shared by the fake provider AND the live provider's fallback path."""
    if not appt_ids:
        return []
    ids = ",".join("'" + str(a).replace("'", "") + "'" for a in appt_ids)
    res = aurora.query(
        "SELECT a.id, a.appt_date, a.appt_time, a.type, pr.provider_type, "
        "pt.prior_noshows, pt.has_contact, pt.visit_count "
        "FROM sched_appointments a JOIN sched_providers pr ON pr.id = a.provider_id "
        f"JOIN sched_patients pt ON pt.id = a.patient_id WHERE a.id IN ({ids})")
    out = []
    for (aid, d, t, atype, ptype, prior, contact, _vc) in res.rows:
        try:
            dname = _DOW[date.fromisoformat(d).weekday()]
        except Exception:
            dname = "Monday"
        tod = "AM" if int((t or "09:00").split(":")[0]) < 12 else "PM"
        base = G.APPT_TYPES.get(atype, {"base": 0.15})["base"]
        mult = G.DAY_TIME_MULT.get((dname, tod), 1.0)
        if (prior or 0) >= 3:
            mult *= 1.60
        elif (prior or 0) >= 1:
            mult *= 1.20
        if not contact:
            mult *= 1.30
        p = min(0.92, base * mult)
        drivers = []
        if (prior or 0) >= 1:
            drivers.append(f"{prior} prior no-show(s)")
        if not contact:
            drivers.append("no contact on file")
        if (dname, tod) in (("Tuesday", "PM"), ("Friday", "PM")):
            drivers.append(f"{dname} {tod} high-cancel slot")
        out.append(RiskScore(appt_id=aid, score=round(p, 3), band=risk_band(p),
                             drivers=drivers or [f"{atype} baseline"], source="fallback"))
    return out


class FakeModels(ModelProvider):
    """Deterministic rules stand-in for the No-Show KServe model."""

    def __init__(self, aurora: FakeAurora) -> None:
        self.aurora = aurora

    def no_show_scores(self, appt_ids: list[str]) -> list[RiskScore]:
        return score_noshow(self.aurora, appt_ids)

    def coverage_forecast(self, dept_id: int, horizon_days: int) -> list[ForecastPoint]:
        # UC2 coverage planning is handled by scheduling.service.coverage_plan; this
        # legacy hook is retained for the MCP/data-API shims and returns no points.
        return []

    def demand_forecast(self) -> dict[str, float]:
        # Deterministic stand-in for the forecast KServe model: the weekday demand
        # profile the regressor is trained on (so offline == live behaviour).
        return dict(G.WEEKDAY_DEMAND_MIN)


class FakeWorkflow(WorkflowProvider):
    """Logs proposals instead of calling n8n. Always returns pending_approval."""

    def __init__(self) -> None:
        self.log: list[ChangeProposal] = []
        self._n = 0

    def propose_schedule_change(self, summary: str, payload: dict) -> ChangeProposal:
        self._n += 1
        prop = ChangeProposal(proposal_id=f"PROP-{self._n:04d}", summary=summary)
        self.log.append(prop)
        return prop
