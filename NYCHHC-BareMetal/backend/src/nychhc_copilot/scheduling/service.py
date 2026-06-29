"""Scheduling action API — single source of truth for the UI and the Copilot.

All functions take the active AuroraProvider (fake or live). Reads use query()
with controlled, escaped values; writes use execute() with params. Calendars are
computed (working hours sliced into slots; Booked from appointments; Blocked from
Approved PTO). FOR DEMONSTRATION ONLY — SYNTHETIC DATA.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from .data import COVERAGE_MINIMUMS, SERVICE_LINE, TODAY


# ── helpers ───────────────────────────────────────────────────────────────────
def _q(s: str) -> str:
    return str(s).replace("'", "''")


def _to_min(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _to_t(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _dicts(res) -> list[dict]:
    return [dict(zip(res.columns, r)) for r in res.rows]


def _provider(aurora, pid: str) -> dict | None:
    rows = _dicts(aurora.query(
        "SELECT id, name, credential, specialty, phone, room, work_start, work_end, "
        f"slot_min, weekly_hours, ot_hours FROM sched_providers WHERE id = '{_q(pid)}'"))
    return rows[0] if rows else None


def _slot_times(p: dict) -> list[str]:
    return [_to_t(m) for m in range(_to_min(p["work_start"]), _to_min(p["work_end"]), int(p["slot_min"]))]


def _blocked_on(aurora, pid: str, d: str) -> bool:
    r = aurora.query(
        "SELECT COUNT(*) FROM sched_pto WHERE provider_id = '%s' AND status='Approved' "
        "AND start_date <= '%s' AND end_date >= '%s'" % (_q(pid), _q(d), _q(d)))
    return bool(r.rows[0][0])


# ── reads ─────────────────────────────────────────────────────────────────────
def list_specialties(aurora) -> list[str]:
    return [r[0] for r in aurora.query(
        "SELECT DISTINCT specialty FROM sched_providers ORDER BY specialty").rows]


def get_calendar(aurora, provider_id: str, d: str) -> dict:
    p = _provider(aurora, provider_id)
    if not p:
        return {"error": "unknown provider"}
    blocked = _blocked_on(aurora, provider_id, d)
    booked = {row["appt_time"]: row for row in _dicts(aurora.query(
        "SELECT a.id, a.appt_time, a.type, a.reason, a.patient_id, pt.name AS patient_name, pt.mrn "
        "FROM sched_appointments a JOIN sched_patients pt ON pt.id = a.patient_id "
        f"WHERE a.provider_id = '{_q(provider_id)}' AND a.appt_date = '{_q(d)}' AND a.status='Booked'"))}
    slots = []
    for t in _slot_times(p):
        if blocked:
            slots.append({"time": t, "status": "Blocked"})
        elif t in booked:
            slots.append({"time": t, "status": "Booked", "appt": booked[t]})
        else:
            slots.append({"time": t, "status": "Open"})
    return {"provider": p, "date": d, "blocked": blocked, "slots": slots}


def next_available(aurora, provider_id: str, from_date: str = TODAY, horizon: int = 14) -> dict | None:
    start = date.fromisoformat(from_date)
    for i in range(horizon):
        d = (start + timedelta(days=i)).isoformat()
        cal = get_calendar(aurora, provider_id, d)
        for s in cal.get("slots", []):
            if s["status"] == "Open":
                return {"date": d, "time": s["time"]}
    return None


def list_doctors_by_specialty(aurora, specialty: str) -> list[dict]:
    docs = _dicts(aurora.query(
        "SELECT id, name, credential, specialty, phone, room FROM sched_providers "
        f"WHERE specialty = '{_q(specialty)}' ORDER BY name"))
    for d in docs:
        d["next_available"] = next_available(aurora, d["id"])
    docs.sort(key=lambda d: (d["next_available"] or {}).get("date", "9999") + (d["next_available"] or {}).get("time", ""))
    return docs


def find_appointments(aurora, query: str = "", provider_id: str = "", patient_id: str = "",
                      d: str = "", status: str = "Booked") -> list[dict]:
    where = [f"a.status = '{_q(status)}'"] if status else []
    if provider_id:
        where.append(f"a.provider_id = '{_q(provider_id)}'")
    if patient_id:
        where.append(f"a.patient_id = '{_q(patient_id)}'")
    if d:
        where.append(f"a.appt_date = '{_q(d)}'")
    if query:
        ql = _q(query.lower())
        where.append(f"(lower(pt.name) LIKE '%{ql}%' OR lower(pt.mrn) LIKE '%{ql}%' "
                     f"OR lower(pr.name) LIKE '%{ql}%' OR lower(a.id) LIKE '%{ql}%')")
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return _dicts(aurora.query(
        "SELECT a.id, a.appt_date, a.appt_time, a.type, a.reason, a.status, "
        "pt.id AS patient_id, pt.name AS patient_name, pt.mrn, pt.risk_tier, "
        "pr.id AS provider_id, pr.name AS provider_name, pr.specialty "
        "FROM sched_appointments a JOIN sched_patients pt ON pt.id = a.patient_id "
        f"JOIN sched_providers pr ON pr.id = a.provider_id{clause} ORDER BY a.appt_date, a.appt_time"))


# ── writes ────────────────────────────────────────────────────────────────────
def _slot_free(aurora, provider_id: str, d: str, t: str) -> bool:
    cal = get_calendar(aurora, provider_id, d)
    return any(s["time"] == t and s["status"] == "Open" for s in cal.get("slots", []))


def book_appointment(aurora, patient_id, provider_id, d, time, duration_min=30,
                     type="Follow-up", reason="") -> dict:
    if not _provider(aurora, provider_id):
        return {"ok": False, "error": "unknown provider"}
    if not _slot_free(aurora, provider_id, d, time):
        return {"ok": False, "error": f"slot {d} {time} is not open"}
    appt_id = "a-" + uuid.uuid4().hex[:8]
    aurora.execute(
        "INSERT INTO sched_appointments VALUES (?,?,?,?,?,?,?,?,?)",
        (appt_id, patient_id, provider_id, d, time, duration_min, type, reason, "Booked"))
    pat = _dicts(aurora.query(f"SELECT name, mrn FROM sched_patients WHERE id='{_q(patient_id)}'"))
    prov = _provider(aurora, provider_id)
    return {"ok": True, "appt_id": appt_id, "patient": (pat or [{}])[0].get("name", patient_id),
            "provider": prov["name"], "specialty": prov["specialty"], "date": d, "time": time, "type": type}


def modify_appointment(aurora, appt_id, provider_id=None, d=None, time=None) -> dict:
    cur = _dicts(aurora.query(
        "SELECT id, patient_id, provider_id, appt_date, appt_time, duration_min, type, reason "
        f"FROM sched_appointments WHERE id='{_q(appt_id)}' AND status='Booked'"))
    if not cur:
        return {"ok": False, "error": "appointment not found"}
    c = cur[0]
    new_prov, new_d, new_t = provider_id or c["provider_id"], d or c["appt_date"], time or c["appt_time"]
    before = {"provider_id": c["provider_id"], "date": c["appt_date"], "time": c["appt_time"]}
    if not _slot_free(aurora, new_prov, new_d, new_t):
        return {"ok": False, "error": f"target slot {new_d} {new_t} is not open"}
    aurora.execute(
        "UPDATE sched_appointments SET provider_id=?, appt_date=?, appt_time=? WHERE id=?",
        (new_prov, new_d, new_t, appt_id))  # frees old slot implicitly (it's computed)
    return {"ok": True, "appt_id": appt_id, "before": before,
            "after": {"provider_id": new_prov, "date": new_d, "time": new_t},
            "provider": _provider(aurora, new_prov)["name"]}


def cancel_appointment(aurora, appt_id, reason="") -> dict:
    cur = find_appointments(aurora, status="Booked")
    match = [a for a in cur if a["id"] == appt_id]
    if not match:
        return {"ok": False, "error": "appointment not found"}
    a = match[0]
    aurora.execute("UPDATE sched_appointments SET status='Cancelled' WHERE id=?", (appt_id,))
    # Offer the freed slot to a qualified, higher-risk patient (same specialty, no appt that day).
    reoffer = _reoffer_candidates(aurora, a["specialty"], a["appt_date"])
    return {"ok": True, "appt_id": appt_id, "freed": {"provider_id": a["provider_id"],
            "provider": a["provider_name"], "date": a["appt_date"], "time": a["appt_time"]},
            "reoffer_candidates": reoffer}


def _reoffer_candidates(aurora, specialty: str, d: str, limit: int = 3) -> list[dict]:
    # Highest-risk patients without a booked appt on that date — candidates for the freed slot.
    booked_ids = {a["patient_id"] for a in find_appointments(aurora, d=d)}
    order = {"RED": 0, "AMBER": 1, "GREEN": 2}
    pats = _dicts(aurora.query("SELECT id, name, mrn, phone, risk_tier FROM sched_patients"))
    cands = [p for p in pats if p["id"] not in booked_ids]
    cands.sort(key=lambda p: order.get(p["risk_tier"], 3))
    return cands[:limit]


# ── PTO + impact engine ───────────────────────────────────────────────────────
def request_pto(aurora, provider_id, start, end, type="Vacation", status="Pending") -> dict:
    if not _provider(aurora, provider_id):
        return {"ok": False, "error": "unknown provider"}
    pid = "pto-" + uuid.uuid4().hex[:8]
    aurora.execute("INSERT INTO sched_pto VALUES (?,?,?,?,?,?)",
                   (pid, provider_id, start, end, type, status))
    return {"ok": True, "pto_id": pid, "provider": _provider(aurora, provider_id)["name"],
            "start": start, "end": end, "type": type, "status": status}


def approve_pto(aurora, pto_id) -> dict:
    aurora.execute("UPDATE sched_pto SET status='Approved' WHERE id=?", (pto_id,))
    return {"ok": True, "pto_id": pto_id, "status": "Approved"}


def _dates_in(start: str, end: str) -> list[str]:
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    return [(s + timedelta(days=i)).isoformat() for i in range((e - s).days + 1)]


def _service_line_providers(aurora, service_line: str) -> list[dict]:
    """Providers whose specialty staffs the given service line (UC4 coverage math)."""
    rows = _dicts(aurora.query("SELECT id, name, specialty FROM sched_providers"))
    return [p for p in rows if SERVICE_LINE.get(p["specialty"]) == service_line]


def _on_leave(aurora, provider_id: str, d: str) -> bool:
    """True if the provider has Approved OR Pending PTO covering date d (UC4 — a
    pending request still threatens coverage, so it counts toward the conflict)."""
    r = aurora.query(
        "SELECT COUNT(*) FROM sched_pto WHERE provider_id = '%s' "
        "AND status IN ('Approved','Pending') AND start_date <= '%s' AND end_date >= '%s'"
        % (_q(provider_id), _q(d), _q(d)))
    return bool(r.rows[0][0])


def coverage_conflict(aurora, provider_id, start, end) -> dict:
    """UC4 — does this leave drop the provider's SERVICE LINE below its minimum on any
    day (BR-4/6)? Detects concurrent same-service leave (the overlap conflict) and the
    uncovered dates. The requesting provider counts as on-leave for the window."""
    prov = _provider(aurora, provider_id)
    if not prov:
        return {"breach": False}
    line = SERVICE_LINE.get(prov["specialty"])
    minimum = COVERAGE_MINIMUMS.get(line, 1)
    team = _service_line_providers(aurora, line)
    total = len(team)
    uncovered, overlap = [], {}
    for d in _dates_in(start, end):
        on_leave = 0
        for p in team:
            # the requester is on leave for the whole window; peers per their PTO rows
            out = (p["id"] == provider_id) or _on_leave(aurora, p["id"], d)
            if out:
                on_leave += 1
                if p["id"] != provider_id:
                    overlap.setdefault(p["id"], {"provider": p["name"], "dates": []})["dates"].append(d)
        if (total - on_leave) < minimum:
            uncovered.append(d)
    overlapping = list(overlap.values())
    breach = bool(uncovered)
    mitigation = ""
    if breach:
        who = ", ".join(o["provider"] for o in overlapping) or "another provider"
        mitigation = (f"{line} needs {minimum} on service but falls short on "
                      f"{len(uncovered)} day(s) — overlaps with {who}'s leave. "
                      "Stagger the leave, pull a float/peer onto service, or deny one request.")
    return {"service_line": line, "minimum": minimum, "team_size": total,
            "uncovered_dates": uncovered, "overlapping_leave": overlapping,
            "breach": breach, "mitigation": mitigation}


def compute_pto_impact(aurora, provider_id, start, end) -> dict:
    prov = _provider(aurora, provider_id)
    if not prov:
        return {"error": "unknown provider"}
    days = _dates_in(start, end)
    impacted = [a for a in find_appointments(aurora, provider_id=provider_id) if a["appt_date"] in days]
    peers = [d for d in list_doctors_by_specialty(aurora, prov["specialty"]) if d["id"] != provider_id]

    rows, auto, manual, gaps = [], 0, 0, []
    for a in impacted:
        reassign = []
        for peer in peers:
            if _slot_free(aurora, peer["id"], a["appt_date"], a["appt_time"]):
                reassign.append({"provider_id": peer["id"], "provider": peer["name"],
                                 "time": a["appt_time"], "same_specialty": True, "ot_added": 0})
        reschedule = []
        if not reassign:
            na = next_available(aurora, provider_id, from_date=(date.fromisoformat(end) + timedelta(days=1)).isoformat())
            if na:
                reschedule.append({"provider_id": provider_id, "provider": prov["name"], **na})
            for peer in peers:
                np = next_available(aurora, peer["id"], from_date=a["appt_date"])
                if np:
                    reschedule.append({"provider_id": peer["id"], "provider": peer["name"], **np})
                    break
        rec = "reassign" if reassign else "reschedule" if reschedule else "manual"
        if rec == "reassign":
            auto += 1
        elif rec == "manual":
            manual += 1
            gaps.append({"date": a["appt_date"], "time": a["appt_time"], "specialty": prov["specialty"]})
        rows.append({**a, "reassign_options": reassign, "reschedule_options": reschedule, "recommendation": rec})

    conflict = coverage_conflict(aurora, provider_id, start, end)
    return {"provider": prov["name"], "provider_id": provider_id, "range": [start, end],
            "impacted_count": len(impacted), "auto_resolvable_count": auto,
            "needs_manual_count": manual, "coverage_gaps": gaps, "impacted": rows,
            "conflict": conflict}


# ── UC6 audit log (HITL gate) ───────────────────────────────────────────────
def record_audit(aurora, action, summary, actor_role, actor_user, decision,
                 outcome="recorded", rationale="") -> dict:
    """Append an attributable audit row (BR-10: named user + timestamp). Best-effort —
    never blocks the action it records."""
    aid = "aud-" + uuid.uuid4().hex[:10]
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        aurora.execute(
            "INSERT INTO audit_log (id,action,summary,rationale,actor_role,actor_user,decision,outcome,ts) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (aid, action, summary, rationale, actor_role, actor_user, decision, outcome, ts))
    except Exception:
        pass
    return {"id": aid, "action": action, "summary": summary, "rationale": rationale,
            "actor_role": actor_role, "actor_user": actor_user, "decision": decision,
            "outcome": outcome, "ts": ts}


def recent_audit(aurora, limit: int = 25) -> list[dict]:
    try:
        return _dicts(aurora.query(
            "SELECT ts, action, summary, actor_role, actor_user, decision, outcome "
            f"FROM audit_log ORDER BY ts DESC LIMIT {int(limit)}"))
    except Exception:
        return []


def apply_reassignments(aurora, plan: list[dict]) -> dict:
    """plan: [{appt_id, action:'reassign'|'reschedule', provider_id, date?, time?}]."""
    applied, failed = [], []
    for item in plan:
        res = modify_appointment(aurora, item["appt_id"], provider_id=item.get("provider_id"),
                                 d=item.get("date"), time=item.get("time"))
        (applied if res.get("ok") else failed).append({**item, "result": res})
    return {"ok": not failed, "applied": len(applied), "failed": len(failed),
            "applied_items": applied, "failed_items": failed}
