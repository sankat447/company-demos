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
    (1, "Inpatient OB", 2.0, 18),
    (2, "Inpatient GYN", 1.0, 12),
    (3, "Outpatient Clinic", 1.0, 30),
]
_PROVIDERS = [
    (1, "Dr. Amara Okonkwo", "MD", 1),
    (2, "Dr. Rachel Stein", "MD", 1),
    (3, "Dr. Priya Nair", "MD", 2),
    (4, "Dr. David Cohen", "MD", 2),
    (5, "Dr. Sofia Ramirez", "MD", 1),
    (6, "Naomi Bridges", "APP", 3),
    (7, "Grace Adeyemi", "APP", 3),
    (8, "Daniel Osei", "APP", 2),
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
        self._seed_dashboard()  # Phase-2 tables so the data API works offline too

    def _seed_dashboard(self) -> None:
        """roster / risk_today / pto_queue — mirrors db/schema.sql so the dashboard,
        roster and risk tabs work against the fake (local + tests), not just live."""
        c = self.conn
        c.executescript(
            """CREATE TABLE roster (id INTEGER PRIMARY KEY AUTOINCREMENT, ini TEXT, color TEXT,
                 name TEXT, role TEXT, license TEXT, phone TEXT, shift TEXT, weekly_hours REAL,
                 status TEXT, pto_balance_pct INTEGER, pto_balance_hours INTEGER);
               CREATE TABLE risk_today (id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT,
                 patient_name TEXT, syn_id TEXT, mrn TEXT, phone TEXT, appt_time TEXT,
                 provider TEXT, risk_pct INTEGER, factors TEXT, action TEXT);
               CREATE TABLE pto_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, ini TEXT, color TEXT,
                 provider_name TEXT, type TEXT, dates TEXT, coverage_gap INTEGER, status TEXT);""")
        c.executemany("INSERT INTO roster (ini,color,name,role,license,phone,shift,weekly_hours,status,pto_balance_pct,pto_balance_hours) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
            ("AO", "#cc785c", "Dr. Amara Okonkwo", "Obstetrics · MD", "NY-MD-887214", "(212) 555-0142", "Days", 40.0, "On shift", 78, 156),
            ("RS", "#b05730", "Dr. Rachel Stein", "Obstetrics · MD", "NY-MD-553090", "(212) 555-0150", "Days", 36.0, "On shift", 54, 108),
            ("PN", "#5e7c58", "Dr. Priya Nair", "Gynecology · MD", "NY-MD-310455", "(212) 555-0161", "Days", 40.0, "On shift", 66, 132),
            ("NB", "#c08a2d", "Naomi Bridges, CNM", "Midwife · CNM", "NY-CNM-771265", "(212) 555-0156", "Evening", 32.0, "On shift", 31, 62),
            ("SR", "#b24a38", "Dr. Sofia Ramirez", "MFM · MD", "NY-MD-664120", "(718) 555-0172", "Days", 32.0, "On shift", None, None),
            ("GA", "#b05730", "Grace Adeyemi, CNM", "Midwife · CNM", "NY-CNM-449871", "(646) 555-0190", "Days", 36.0, "On shift", 48, 96),
            ("DC", "#5e7c58", "Dr. David Cohen", "Gynecology · MD", "NY-MD-902331", "(646) 555-0167", "Days", 36.0, "Available", None, None),
            ("HP", "#cc785c", "Dr. Helen Park", "MFM · MD", "NY-MD-128744", "(212) 555-0180", "Days", 40.0, "On shift", None, None),
            ("DO", "#6b6862", "Daniel Osei, PA", "Gynecology · PA", "NY-PA-20418", "(347) 555-0144", "Days", 40.0, "On shift", None, None),
            ("AR", "#6b6862", "Aisha Rahman, PA", "Obstetrics · PA", "NY-PA-20655", "(212) 555-0118", "Days", 36.0, "Available", None, None),
        ])
        risk = [
            ("RED", "Daniela Marquez", "#3 · SYN-00003", "SYN-4471", "(212) 555-0103", "9:00 AM", "Dr. Okonkwo", 71, '["3 prior no-shows","No text on file","Prenatal · AM"]', "Call + standby"),
            ("RED", "Latoya Williams", "#22 · SYN-00022", "SYN-5108", "(646) 555-0122", "10:30 AM", "N. Bridges, CNM", 74, '["3 prior no-shows","Transit > 45 min","Prenatal"]', "Call + standby"),
            ("RED", "Mei Chen", "#27 · SYN-00027", "SYN-6033", "(347) 555-0127", "2:20 PM", "Dr. Okonkwo", 75, '["3 prior no-shows","New OB","No text on file"]', "Call patient"),
            ("AMBER", "Fatou Diallo", "#21 · SYN-00021", "SYN-4990", "(718) 555-0121", "11:00 AM", "N. Bridges, CNM", 54, '["2 prior no-shows","Postpartum"]', "Send text reminder"),
            ("AMBER", "Rosa Gutierrez", "#16 · SYN-00016", "SYN-4612", "(212) 555-0116", "1:00 PM", "Dr. Nair", 52, '["2 prior no-shows","Afternoon slot"]', "Send text reminder"),
            ("AMBER", "Aaliyah Johnson", "#34 · SYN-00034", "SYN-7120", "(646) 555-0134", "3:30 PM", "Dr. Cohen", 38, '["Reschedule last week","Colposcopy"]', "Send text reminder"),
            ("AMBER", "Hannah Goldberg", "#15 · SYN-00015", "SYN-4580", "(718) 555-0115", "8:00 AM", "Dr. Okonkwo", 36, '["Prenatal · AM"]', "Monitor"),
            ("GREEN", "Olivia Bennett", "#4 · SYN-00004", "SYN-4419", "(212) 555-0104", "8:00 AM", "Dr. Okonkwo", 14, '["Confirmed","Prenatal"]', "No action"),
            ("GREEN", "Priscilla Adeyemi", "#9 · SYN-00009", "SYN-4503", "(646) 555-0109", "9:40 AM", "Dr. Ramirez", 15, '["Confirmed","MFM consult"]', "No action"),
            ("GREEN", "Nadia Hussain", "#10 · SYN-00010", "SYN-4527", "(347) 555-0110", "12:00 PM", "D. Osei, PA", 30, '["GYN follow-up"]', "No action"),
            ("GREEN", "Carmen Ortiz", "#28 · SYN-00028", "SYN-6041", "(212) 555-0128", "9:20 AM", "Dr. Okonkwo", 17, '["Confirmed","Prenatal"]', "No action"),
            ("GREEN", "Sandra Okeke", "#33 · SYN-00033", "SYN-7098", "(718) 555-0133", "11:30 AM", "Dr. Nair", 18, '["GYN annual"]', "No action"),
        ]
        c.executemany("INSERT INTO risk_today (tier,patient_name,syn_id,mrn,phone,appt_time,provider,risk_pct,factors,action) VALUES (?,?,?,?,?,?,?,?,?,?)", risk)
        c.executemany("INSERT INTO pto_queue (ini,color,provider_name,type,dates,coverage_gap,status) VALUES (?,?,?,?,?,?,?)", [
            ("AO", "#cc785c", "Dr. Amara Okonkwo", "Vacation", "Jun 16–20", 1, "pend"),
            ("RS", "#b05730", "Dr. Rachel Stein", "CME / Education", "Jun 17–19", 1, "ok"),
            ("NB", "#c08a2d", "Naomi Bridges, CNM", "Personal", "Jun 24–25", 0, "pend"),
            ("DO", "#6b6862", "Daniel Osei · PA", "Vacation", "Jul 1–5", 0, "ok"),
            ("GA", "#b05730", "Grace Adeyemi, CNM", "Sick", "Jun 9 (today)", 0, "no"),
        ])
        c.commit()

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
                if day == gap_tue and dept == 1 and pid in (1, 2):
                    status = "open"  # the gap (Inpatient OB short on the next Tuesday)
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
                    lead, prior, "18-39", "no_show" if no_show else "attended",
                ))
                appt_id += 1
        c.executemany("INSERT INTO appointments VALUES (?,?,?,?,?,?,?,?,?)", appts)
        c.commit()

    def execute(self, sql: str, params: tuple = ()) -> int:
        # sqlite uses ? placeholders (matches our service layer).
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
