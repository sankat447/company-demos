"""Create + seed ALL demo tables from the deterministic generator (seed_data.py).

Single source of truth: runs identically on the SQLite fake and live Postgres
(portable DDL, params via AuroraProvider.execute, `?`→`%s` translated for psycopg).
Idempotent — re-runs are a no-op once seeded. Populates the live operational
schedule (sched_*), the dashboard tables (roster/risk_today/pto_queue), the model/
analytics corpus (appt_history), and the UC6 audit_log (table only).
"""

from __future__ import annotations

from . import seed_data as G

_DDL = [
    """CREATE TABLE IF NOT EXISTS sched_providers (
        id text PRIMARY KEY, name text, credential text, specialty text, phone text,
        room text, work_start text, work_end text, slot_min int, weekly_hours real,
        ot_hours real, provider_type text)""",
    """CREATE TABLE IF NOT EXISTS sched_patients (
        id text PRIMARY KEY, name text, mrn text, phone text, dob text, risk_tier text,
        prior_noshows int, has_contact int, visit_count int, contact_pref text)""",
    """CREATE TABLE IF NOT EXISTS sched_appointments (
        id text PRIMARY KEY, patient_id text, provider_id text, appt_date text, appt_time text,
        duration_min int, type text, reason text, status text)""",
    """CREATE TABLE IF NOT EXISTS sched_pto (
        id text PRIMARY KEY, provider_id text, start_date text, end_date text, type text, status text)""",
    """CREATE TABLE IF NOT EXISTS roster (
        id serial PRIMARY KEY, ini text, color text, name text, role text, license text,
        phone text, shift text, weekly_hours real, status text,
        pto_balance_pct int, pto_balance_hours int)""",
    """CREATE TABLE IF NOT EXISTS risk_today (
        id serial PRIMARY KEY, tier text, patient_name text, syn_id text, mrn text,
        phone text, appt_time text, provider text, risk_pct int, factors text, action text)""",
    """CREATE TABLE IF NOT EXISTS pto_queue (
        id serial PRIMARY KEY, ini text, color text, provider_name text, type text,
        dates text, coverage_gap boolean, status text)""",
    """CREATE TABLE IF NOT EXISTS appt_history (
        id text PRIMARY KEY, appt_date text, day_of_week text, time_of_day text, appt_type text,
        duration_min int, provider_id text, provider_type text, patient_id text, prior_noshows int,
        has_contact int, contact_pref text, visit_count int, noshow_prob real, risk_tier text,
        actual_noshow int, status text)""",
    """CREATE TABLE IF NOT EXISTS audit_log (
        id text PRIMARY KEY, action text, summary text, rationale text, actor_role text,
        actor_user text, decision text, outcome text, ts text)""",
]

# serial PRIMARY KEY isn't valid on SQLite; the fake provider rewrites it.


def ensure_seeded(aurora) -> None:
    for ddl in _DDL:
        aurora.execute(ddl)
    if aurora.query("SELECT COUNT(*) FROM sched_providers").rows[0][0]:
        return  # already seeded

    for r in G.providers():
        aurora.execute("INSERT INTO sched_providers VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", tuple(r))
    for r in G.patients():
        aurora.execute("INSERT INTO sched_patients VALUES (?,?,?,?,?,?,?,?,?,?)", tuple(r))
    for r in G.appointments():
        aurora.execute("INSERT INTO sched_appointments VALUES (?,?,?,?,?,?,?,?,?)", tuple(r))
    for r in G.pto_blocks():
        aurora.execute("INSERT INTO sched_pto VALUES (?,?,?,?,?,?)", tuple(r))
    for r in G.roster():
        aurora.execute("INSERT INTO roster (ini,color,name,role,license,phone,shift,weekly_hours,"
                       "status,pto_balance_pct,pto_balance_hours) VALUES (?,?,?,?,?,?,?,?,?,?,?)", tuple(r))
    for r in G.risk_panel():
        aurora.execute("INSERT INTO risk_today (tier,patient_name,syn_id,mrn,phone,appt_time,"
                       "provider,risk_pct,factors,action) VALUES (?,?,?,?,?,?,?,?,?,?)", tuple(r))
    for r in G.pto_queue():
        aurora.execute("INSERT INTO pto_queue (ini,color,provider_name,type,dates,coverage_gap,status) "
                       "VALUES (?,?,?,?,?,?,?)", tuple(r))
    for i, h in enumerate(G.history(), 1):
        aurora.execute(
            "INSERT INTO appt_history (id,appt_date,day_of_week,time_of_day,appt_type,duration_min,"
            "provider_id,provider_type,patient_id,prior_noshows,has_contact,contact_pref,visit_count,"
            "noshow_prob,risk_tier,actual_noshow,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (f"h{i}", h["date"], h["day_of_week"], h["time_of_day"], h["appt_type"], h["duration_min"],
             h["provider_id"], h["provider_type"], h["patient_id"], h["prior_noshows"], h["has_contact"],
             h["contact_pref"], h["visit_count"], h["noshow_prob"], h["risk_tier"], h["actual_noshow"],
             "Completed"))
