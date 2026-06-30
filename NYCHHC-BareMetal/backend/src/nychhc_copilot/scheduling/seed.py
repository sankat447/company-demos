"""Create + seed the sched_* tables (idempotent). Works on the SQLite fake and on
live Aurora (writes go through AuroraProvider.execute; `?` placeholders translate)."""

from __future__ import annotations

from .data import APPOINTMENTS, PATIENTS, PROVIDERS, PTO_BLOCKS

_DDL = [
    """CREATE TABLE IF NOT EXISTS sched_providers (
        id text PRIMARY KEY, name text, credential text, specialty text, phone text,
        room text, work_start text, work_end text, slot_min int, weekly_hours real, ot_hours real)""",
    """CREATE TABLE IF NOT EXISTS sched_patients (
        id text PRIMARY KEY, name text, mrn text, phone text, dob text, risk_tier text)""",
    """CREATE TABLE IF NOT EXISTS sched_appointments (
        id text PRIMARY KEY, patient_id text, provider_id text, appt_date text, appt_time text,
        duration_min int, type text, reason text, status text)""",
    """CREATE TABLE IF NOT EXISTS sched_pto (
        id text PRIMARY KEY, provider_id text, start_date text, end_date text, type text, status text)""",
    # UC6 HITL audit log (portable; live schema.sql defines the same shape).
    """CREATE TABLE IF NOT EXISTS audit_log (
        id text PRIMARY KEY, action text, summary text, rationale text, actor_role text,
        actor_user text, decision text, outcome text, ts text)""",
]


def ensure_seeded(aurora) -> None:
    for ddl in _DDL:
        aurora.execute(ddl)
    if aurora.query("SELECT COUNT(*) FROM sched_providers").rows[0][0]:
        return  # already seeded
    for r in PROVIDERS:
        aurora.execute("INSERT INTO sched_providers VALUES (?,?,?,?,?,?,?,?,?,?,?)", r)
    for r in PATIENTS:
        aurora.execute("INSERT INTO sched_patients VALUES (?,?,?,?,?,?)", r)
    for r in APPOINTMENTS:
        aurora.execute("INSERT INTO sched_appointments VALUES (?,?,?,?,?,?,?,?,?)", r)
    for r in PTO_BLOCKS:
        aurora.execute("INSERT INTO sched_pto VALUES (?,?,?,?,?,?)", r)
