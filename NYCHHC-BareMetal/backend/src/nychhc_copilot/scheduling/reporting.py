"""3-Month Bird's-Eye department reporting (Leadership view).

Composes a single executive dashboard payload that mirrors the client's
OBGYN_Scheduling_3Month_BirdsEye workbook: a KPI scorecard (targets + RAG + trend),
the minute-weighted capacity model, a 13-week staffing grid, cancellations, walk-ins,
PTO & coverage floors, cycle-time by stage, plus visit-type and roster reference tables.

Live analytics drive every figure that already exists in the demo (capacity, cancellations,
walk-ins, cycle time, coverage); the 3-month KPI series and the 13-week grid are
deterministic synthetic trends anchored to those live values. FOR DEMONSTRATION — SYNTHETIC.
"""

from __future__ import annotations

from datetime import date, timedelta

from . import service as S
from .seed_data import APPT_MINUTES, DOW, TODAY

_WD = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
_MIN_FLOOR = 3  # providers/day floor for the staffing grid


def _rag(quarter: float, target: float, better_low: bool) -> str:
    """Red/amber/green vs target. better_low: lower is better (rates, cycle time)."""
    if better_low:
        if quarter <= target:
            return "ON TARGET"
        if quarter <= target * 1.25:
            return "WATCH"
        return "ACTION"
    # higher is better (utilization)
    if quarter >= target * 0.985:
        return "ON TARGET"
    if quarter >= target * 0.92:
        return "WATCH"
    return "ACTION"


def _trend(m1: float, m3: float, better_low: bool) -> str:
    if abs(m3 - m1) < 1e-9:
        return "flat"
    improving = (m3 < m1) if better_low else (m3 > m1)
    return "down" if m3 < m1 else "up"  # arrow direction; goodness conveyed by status


def _kpi(name, unit, target, m1, m2, m3, better_low, fmt="num"):
    quarter = round((m1 + m2 + m3) / 3, 3)
    return {"kpi": name, "unit": unit, "target": target, "m1": m1, "m2": m2, "m3": m3,
            "quarter": quarter, "trend": _trend(m1, m3, better_low),
            "status": "INFO" if target is None else _rag(quarter, target, better_low),
            "fmt": fmt, "better_low": better_low}


def _kpi_scorecard(aurora, models=None) -> list[dict]:
    cyc = S.cycle_time(aurora)
    lb = S.load_balance(aurora, models)
    cb = S.cancellation_breakdown(aurora)
    wk = S.walkin_volume(aurora)
    cov = S.coverage_plan(aurora)

    slots = cb.get("by_slot", [])
    noshow = round(sum(s["noshow_pct"] for s in slots) / len(slots) / 100, 3) if slots else 0.07
    cancel = round(cb.get("clinic_avg_cancel_pct", 11) / 100, 3)
    util = round(lb.get("avg_utilization_pct", 85) / 100, 3)
    cyc_now = cyc["cycle_days_recent"]
    walkins_wk = round(sum(d["avg_total"] for d in wk.get("by_day", [])))
    # coverage-breach days across the quarter (anchored to the live 90-day gap count)
    breach_q = cov.get("gap_count", 3)

    return [
        _kpi("Avg cycle time", "days", 5, round(cyc_now + 0.5, 1), round(cyc_now + 0.2, 1), cyc_now, True, "days"),
        _kpi("No-show rate", "%", 0.08, round(noshow + 0.006, 3), round(noshow + 0.003, 3), noshow, True, "pct"),
        _kpi("Cancellation rate", "%", 0.10, round(cancel + 0.007, 3), round(cancel + 0.001, 3), round(cancel - 0.006, 3), True, "pct"),
        _kpi("Provider utilization", "%", 0.86, round(util - 0.035, 3), round(util - 0.01, 3), round(util + 0.03, 3), False, "pct"),
        _kpi("Overtime hours", "hrs", 40, 62, 54, 41, True, "num"),
        _kpi("Coverage breaches", "days", 0, max(breach_q - 1, 0) + 2, max(breach_q - 2, 0) + 1, max(breach_q - 3, 1), True, "num"),
        _kpi("Scheduling backlog", "open", 30, 41, 36, 29, True, "num"),
        _kpi("Walk-ins / week", "/wk", None, walkins_wk + 1, walkins_wk + 5, walkins_wk - 4, True, "num"),
    ]


def _capacity(aurora, models=None) -> dict:
    lb = S.load_balance(aurora, models)
    rows = []
    tot_d = tot_s = tot_p = 0
    for d in lb.get("by_day", []):
        rows.append({"weekday": d["day"], "providers": d["providers_per_day"],
                     "demand_min": d["demand_min"], "supply_min": d["supply_min"],
                     "utilization": round(d["utilization_pct"] / 100, 3), "flag": d["flag"]})
        tot_d += d["demand_min"]; tot_s += d["supply_min"]; tot_p += d["providers_per_day"]
    weekly = {"weekday": "Weekly", "providers": round(tot_p, 1), "demand_min": tot_d,
              "supply_min": tot_s, "utilization": round(tot_d / tot_s, 3) if tot_s else 0,
              "flag": "total"}
    return {"rows": rows, "weekly": weekly, "demand_source": lb.get("demand_source", "history"),
            "rebalance": lb.get("rebalance")}


def _grid13(aurora, models=None) -> list[dict]:
    """13-week staffing grid (providers/weekday). Deterministic; two scripted dip weeks
    so the below-floor flag is demonstrable. Anchored to the live per-weekday staffing."""
    lb = {d["day"]: round(d["providers_per_day"]) for d in S.load_balance(aurora, models).get("by_day", [])}
    base = {w: max(_MIN_FLOOR, lb.get(w, 4)) for w in _WD}
    # find the first Monday on/after TODAY
    start = date.fromisoformat(TODAY)
    while start.weekday() != 0:
        start += timedelta(days=1)
    dips = {5: ("Friday", "Tuesday"), 9: ("Wednesday", None)}  # week-idx → days to drop by 1
    out = []
    for i in range(13):
        wk = dict(base)
        for d in dips.get(i, ()):
            if d:
                wk[d] = wk[d] - 1
        below = sum(1 for w in _WD if wk[w] < _MIN_FLOOR)
        total = sum(wk.values())
        out.append({"week_of": (start + timedelta(weeks=i)).isoformat(),
                    **{w[:3]: wk[w] for w in _WD},
                    "total": total, "below_floor": below,
                    "util": round(total / 26, 3)})
    return out


def _cancellations(aurora) -> list[dict]:
    cb = S.cancellation_breakdown(aurora)
    out = []
    for s in cb.get("by_slot", []):
        ns, adv = s["noshow_pct"], s["advance_pct"]
        signal = ("Double-block" if ns >= 9 else "Tighten waitlist" if adv >= 12 else "Hold")
        out.append({"slot": f"{s['day'][:3]} {s['shift']}", "booked": s.get("n", 0),
                    "cancel_pct": round(s["cancel_pct"] / 100, 3),
                    "advance_pct": round(adv / 100, 3), "noshow_pct": round(ns / 100, 3),
                    "signal": signal})
    out.sort(key=lambda r: r["cancel_pct"], reverse=True)
    return out


def _walkins(aurora) -> list[dict]:
    out = []
    for d in S.walkin_volume(aurora).get("by_day", []):
        total = d["avg_total"] or 1
        pm_share = round((d["avg_pm"] or 0) / total, 3)
        idle = "HIGH" if pm_share < 0.30 else "LOW"
        signal = "Half-day (AM only)" if pm_share < 0.30 else "Full-day"
        out.append({"weekday": d["day"], "am": round(d["avg_am"]), "pm": round(d["avg_pm"]),
                    "total": round(total), "pm_share": pm_share, "idle": idle, "signal": signal})
    return out


def _pto_coverage(aurora) -> dict:
    cov = S.coverage_plan(aurora)
    floors = [{"service": "General OB", "floor": 3}, {"service": "High-risk / MFM", "floor": 2},
              {"service": "Ultrasound", "floor": 2}, {"service": "Check-in / clerical", "floor": 2}]
    reqs = []
    for g in cov.get("gaps", [])[:8]:
        reqs.append({"week_of": g["date"], "service": g["service_line"],
                     "on_floor": g.get("required", 0), "if_approved": g.get("available", 0),
                     "result": "BREACH" if g.get("available", 0) < g.get("required", 0) else "OK",
                     "providers_out": ", ".join(g.get("providers_out", [])) or "PTO",
                     "action": "Stagger / backfill per-diem"})
    return {"floors": floors, "requests": reqs, "gap_count": cov.get("gap_count", 0),
            "horizon_days": cov.get("horizon_days", 90)}


def _cycle(aurora) -> dict:
    ct = S.cycle_time(aurora)
    sr, sp = ct["stages_recent"], ct["stages_prior"]
    total = ct["cycle_days_recent"] or 1
    stage = lambda k, label: {  # noqa: E731
        "stage": label, "this_q": sr[k], "last_q": sp[k], "change": round(sr[k] - sp[k], 1),
        "pct": round(sr[k] / total, 3),
        "flag": "Worsening" if sr[k] - sp[k] >= 0.3 else "Improving" if sr[k] - sp[k] <= -0.3 else "Stable"}
    return {"stages": [stage("clerical", "Referral → logged (Clerical)"),
                       stage("scheduling", "Logged → scheduled (Scheduler)"),
                       stage("provider", "Scheduled → seen (Provider avail.)")],
            "total_this_q": ct["cycle_days_recent"], "total_last_q": ct["cycle_days_prior"],
            "bottleneck_label": ct["bottleneck_label"]}


def _visit_types() -> list[dict]:
    buffers = {"New OB": 5, "High Risk": 10, "GYN Consult": 0, "Follow-up": 0, "Walk-in": 0}
    notes = {"New OB": "Longest routine visit; intake + counseling",
             "High Risk": "Credentialed providers only", "GYN Consult": "Non-pregnancy",
             "Follow-up": "Established follow-up", "Walk-in": "Variable; AM-weighted"}
    out = []
    for t, dur in APPT_MINUTES.items():
        buf = buffers.get(t, 0)
        out.append({"type": t, "duration": dur, "buffer": buf, "total": dur + buf,
                    "notes": notes.get(t, "")})
    return out


def _roster(aurora) -> list[dict]:
    try:
        rows = aurora.query(
            "SELECT pr.name, pr.specialty, pr.provider_type, pr.work_start, pr.work_end, pr.slot_min "
            "FROM sched_providers pr ORDER BY pr.id").rows
    except Exception:
        return []
    out = []
    for name, spec, ptype, ws, we, slot in rows:
        sessions = 8 if ptype in ("MD", "Midwife") else 6
        weekly_cap = sessions * 210  # ~3.5h session blocks in minutes
        out.append({"provider": name, "panel": spec, "type": ptype,
                    "high_risk": "Yes" if spec and "Fetal" in spec else "No",
                    "sessions": sessions, "weekly_cap_min": weekly_cap})
    return out


def birdseye(aurora, models=None) -> dict:
    """The full 3-month bird's-eye payload for the Leadership reporting dashboard."""
    return {
        "period": "Jul–Sep 2026",
        "kpis": _kpi_scorecard(aurora, models),
        "capacity": _capacity(aurora, models),
        "grid13": _grid13(aurora, models),
        "cancellations": _cancellations(aurora),
        "walkins": _walkins(aurora),
        "pto": _pto_coverage(aurora),
        "cycle": _cycle(aurora),
        "visit_types": _visit_types(),
        "roster": _roster(aurora),
        "floor": _MIN_FLOOR,
    }
