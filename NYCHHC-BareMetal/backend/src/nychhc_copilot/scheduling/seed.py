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
        actual_noshow int, outcome text, status text)""",
    """CREATE TABLE IF NOT EXISTS walkin_daily (
        id serial PRIMARY KEY, wdate text, day_of_week text, am int, pm int)""",
    """CREATE TABLE IF NOT EXISTS cycle_log (
        id text PRIMARY KEY, referral_date text, clerical_days real, scheduling_days real,
        provider_days real, cohort text)""",
    """CREATE TABLE IF NOT EXISTS audit_log (
        id text PRIMARY KEY, action text, summary text, rationale text, actor_role text,
        actor_user text, decision text, outcome text, ts text)""",
]

# serial PRIMARY KEY isn't valid on SQLite; the fake provider rewrites it.


def _empty(aurora, table: str) -> bool:
    try:
        return not aurora.query(f"SELECT COUNT(*) FROM {table}").rows[0][0]
    except Exception:
        return True


def ensure_seeded(aurora) -> None:
    """Create + seed every demo table. PER-TABLE idempotent: each table is seeded only
    when empty, so a partially-seeded database self-heals on the next start (e.g. if one
    INSERT previously failed and aborted the run). Each block is isolated — a failure in
    one table is logged and never blocks the others."""
    for ddl in _DDL:
        aurora.execute(ddl)

    def _seed(table: str, fn) -> None:
        if not _empty(aurora, table):
            return
        try:
            fn()
        except Exception as e:  # noqa: BLE001 — one bad table must not empty the rest
            print(f"[scheduling] seed {table} failed: {e}")

    def _providers():
        for r in G.providers():
            aurora.execute("INSERT INTO sched_providers VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", tuple(r))

    def _patients():
        for r in G.patients():
            aurora.execute("INSERT INTO sched_patients VALUES (?,?,?,?,?,?,?,?,?,?)", tuple(r))

    def _appointments():
        for r in G.appointments():
            aurora.execute("INSERT INTO sched_appointments VALUES (?,?,?,?,?,?,?,?,?)", tuple(r))

    def _pto():
        for r in G.pto_blocks():
            aurora.execute("INSERT INTO sched_pto VALUES (?,?,?,?,?,?)", tuple(r))

    def _roster():
        for r in G.roster():
            aurora.execute("INSERT INTO roster (ini,color,name,role,license,phone,shift,weekly_hours,"
                           "status,pto_balance_pct,pto_balance_hours) VALUES (?,?,?,?,?,?,?,?,?,?,?)", tuple(r))

    def _risk():
        for r in G.risk_panel():
            aurora.execute("INSERT INTO risk_today (tier,patient_name,syn_id,mrn,phone,appt_time,"
                           "provider,risk_pct,factors,action) VALUES (?,?,?,?,?,?,?,?,?,?)", tuple(r))

    def _pto_queue():
        for r in G.pto_queue():
            aurora.execute("INSERT INTO pto_queue (ini,color,provider_name,type,dates,coverage_gap,status) "
                           "VALUES (?,?,?,?,?,?,?)", tuple(r))

    def _history():
        for i, h in enumerate(G.history(), 1):
            aurora.execute(
                "INSERT INTO appt_history (id,appt_date,day_of_week,time_of_day,appt_type,duration_min,"
                "provider_id,provider_type,patient_id,prior_noshows,has_contact,contact_pref,visit_count,"
                "noshow_prob,risk_tier,actual_noshow,outcome,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (f"h{i}", h["date"], h["day_of_week"], h["time_of_day"], h["appt_type"], h["duration_min"],
                 h["provider_id"], h["provider_type"], h["patient_id"], h["prior_noshows"], h["has_contact"],
                 h["contact_pref"], h["visit_count"], h["noshow_prob"], h["risk_tier"], h["actual_noshow"],
                 h["outcome"], "Completed"))

    def _walkin():
        for w in G.walkin_daily():
            aurora.execute("INSERT INTO walkin_daily (wdate,day_of_week,am,pm) VALUES (?,?,?,?)",
                           (w["date"], w["day_of_week"], w["am"], w["pm"]))

    def _cycle():
        for i, c in enumerate(G.cycle_log(), 1):
            aurora.execute("INSERT INTO cycle_log (id,referral_date,clerical_days,scheduling_days,"
                           "provider_days,cohort) VALUES (?,?,?,?,?,?)",
                           (f"c{i}", c["referral_date"], c["clerical_days"], c["scheduling_days"],
                            c["provider_days"], c["cohort"]))

    for table, fn in (("sched_providers", _providers), ("sched_patients", _patients),
                      ("sched_appointments", _appointments), ("sched_pto", _pto),
                      ("roster", _roster), ("risk_today", _risk), ("pto_queue", _pto_queue),
                      ("appt_history", _history), ("walkin_daily", _walkin), ("cycle_log", _cycle)):
        _seed(table, fn)
