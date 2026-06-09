"""Offline fakes for the tool providers.

A tiny, deterministic SQLite stand-in for the Aurora `workforce` schema plus canned
model/workflow providers. Enough rows to drive the 5-beat demo flow (a Tuesday
coverage gap + a computable no-show rate) with **zero cluster dependencies**.

This is NOT the full synthetic seed (that's ingestion/seed_workforce.py, thousands
of rows). It's the minimum to make tools/agent runnable and testable locally.
"""

from __future__ import annotations

import math
import sqlite3
from datetime import date, timedelta

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

_DEPTS = [
    (1, "Emergency", 6.0, 40),
    (2, "Med-Surg 4W", 4.0, 28),
    (3, "Pediatrics", 3.0, 18),
]
_PROVIDERS = [
    (1, "Alice Nguyen", "MD", 1),
    (2, "Ben Carter", "MD", 1),
    (3, "Carla Diaz", "APP", 2),
    (4, "David Okafor", "RN", 2),
    (5, "Emma Schmidt", "MD", 3),
    (6, "Frank Russo", "RN", 3),
    (7, "Grace Lee", "APP", 1),
    (8, "Hassan Ali", "RN", 1),
]


def _next_weekday(start: date, weekday: int) -> date:
    """Next date on/after `start` falling on `weekday` (Mon=0 .. Sun=6)."""
    delta = (weekday - start.weekday()) % 7
    return start + timedelta(days=delta or 7)


class FakeAurora(AuroraProvider):
    """In-memory SQLite mirroring a slice of the `workforce` schema."""

    def __init__(self) -> None:
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
        self._build()
        self._seed()

    def _build(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE departments (dept_id INTEGER PRIMARY KEY, name TEXT,
                min_staff_ratio REAL, baseline_census INTEGER);
            CREATE TABLE providers (provider_id INTEGER PRIMARY KEY, name TEXT,
                role TEXT, dept_id INTEGER);
            CREATE TABLE shifts (shift_id INTEGER PRIMARY KEY, provider_id INTEGER,
                dept_id INTEGER, shift_date TEXT, block TEXT, status TEXT);
            CREATE TABLE pto_requests (pto_id INTEGER PRIMARY KEY, provider_id INTEGER,
                start_date TEXT, end_date TEXT, status TEXT);
            CREATE TABLE appointments (appt_id INTEGER PRIMARY KEY, patient_ref TEXT,
                dept_id INTEGER, provider_id INTEGER, appt_date TEXT,
                lead_time_days INTEGER, prior_noshows INTEGER, age_band TEXT, outcome TEXT);
            """
        )

    def _seed(self) -> None:
        c = self.conn
        c.executemany("INSERT INTO departments VALUES (?,?,?,?)", _DEPTS)
        c.executemany("INSERT INTO providers VALUES (?,?,?,?)", _PROVIDERS)

        today = date.today()
        gap_tue = _next_weekday(today, 1)  # next Tuesday — our engineered coverage gap

        # Shifts for the next 14 days, day block. Emergency on the gap Tuesday is
        # left understaffed (2 of its providers are 'open').
        shift_id = 1
        rows = []
        for d in range(14):
            day = today + timedelta(days=d)
            for (pid, _name, _role, dept) in _PROVIDERS:
                status = "scheduled"
                if day == gap_tue and dept == 1 and pid in (1, 7):
                    status = "open"  # the gap
                rows.append((shift_id, pid, dept, day.isoformat(), "day", status))
                shift_id += 1
        c.executemany("INSERT INTO shifts VALUES (?,?,?,?,?,?)", rows)

        # PTO: one pending request that worsens the gap Tuesday.
        c.execute(
            "INSERT INTO pto_requests VALUES (?,?,?,?,?)",
            (1, 2, gap_tue.isoformat(), (gap_tue + timedelta(days=1)).isoformat(), "pending"),
        )

        # Appointments over the last ~35 days with outcomes → computable no-show rate.
        appt_id = 1
        appts = []
        for d in range(35):
            day = today - timedelta(days=d + 1)
            for (pid, _n, _r, dept) in _PROVIDERS[:6]:
                prior = (pid + d) % 4
                lead = 3 + (d % 21)
                # higher prior_noshows / longer lead → more likely no_show (deterministic)
                no_show = (prior >= 2 and lead > 10 and (appt_id % 3 == 0))
                appts.append((
                    appt_id, f"SYN-{appt_id:05d}", dept, pid, day.isoformat(),
                    lead, prior, "40-64", "no_show" if no_show else "attended",
                ))
                appt_id += 1
        c.executemany("INSERT INTO appointments VALUES (?,?,?,?,?,?,?,?,?)", appts)
        c.commit()

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


class FakeModels(ModelProvider):
    """Deterministic stand-ins for the No-Show and Coverage-Forecast KServe models."""

    def __init__(self, aurora: FakeAurora) -> None:
        self.aurora = aurora

    def no_show_scores(self, appt_ids: list[int]) -> list[RiskScore]:
        if not appt_ids:
            return []
        q = "SELECT appt_id, lead_time_days, prior_noshows FROM appointments WHERE appt_id IN (%s)" % (
            ",".join(str(int(a)) for a in appt_ids)
        )
        res = self.aurora.query(q)
        out: list[RiskScore] = []
        for appt_id, lead, prior in res.rows:
            # logistic on the same features the real XGBoost will use
            z = -2.0 + 0.9 * (prior or 0) + 0.06 * (lead or 0)
            p = 1 / (1 + math.exp(-z))
            band = "red" if p >= 0.6 else "amber" if p >= 0.3 else "green"
            drivers = []
            if (prior or 0) >= 2:
                drivers.append(f"{prior} prior no-shows")
            if (lead or 0) > 10:
                drivers.append(f"{lead}-day lead time")
            out.append(RiskScore(appt_id=appt_id, score=round(p, 3), band=band,
                                 drivers=drivers or ["baseline"], source="fallback"))
        return out

    def coverage_forecast(self, dept_id: int, horizon_days: int) -> list[ForecastPoint]:
        roster = self.aurora.query(
            f"SELECT COUNT(*) FROM providers WHERE dept_id={int(dept_id)}"
        ).rows
        if not roster or not roster[0][0]:
            return []
        # Required = the department's normal full roster, so a fully-scheduled day is
        # adequate and only an engineered gap (open shifts) dips below.
        required = int(roster[0][0])
        today = date.today()
        pts: list[ForecastPoint] = []
        for d in range(horizon_days):
            day = (today + timedelta(days=d)).isoformat()
            scheduled = self.aurora.query(
                f"SELECT COUNT(*) FROM shifts WHERE dept_id={int(dept_id)} "
                f"AND shift_date='{day}' AND block='day' AND status='scheduled'"
            ).rows[0][0]
            pts.append(ForecastPoint(dept_id=dept_id, date=day, block="day",
                                     required=float(required), projected=float(scheduled)))
        return pts


class FakeWorkflow(WorkflowProvider):
    """Logs proposals instead of calling n8n. Always returns pending_approval (D7)."""

    def __init__(self) -> None:
        self.log: list[ChangeProposal] = []
        self._n = 0

    def propose_schedule_change(self, summary: str, payload: dict) -> ChangeProposal:
        self._n += 1
        prop = ChangeProposal(proposal_id=f"PROP-{self._n:04d}", summary=summary)
        self.log.append(prop)
        return prop
