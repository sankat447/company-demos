"""Data API — provider-backed REST for the dashboard (NOT via the LLM).

Powers the Streamlit role UIs: schedule grid (DR-02), no-show badges (DR-06),
coverage forecast/alert (DR-08/09), PTO + impact (DR-05), dashboard metrics (DR-10).
Uses UNQUALIFIED table names so the same SQL works against the SQLite fake and the
live `workforce` schema (LiveAurora sets search_path).
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..disclaimer import envelope
from ..tools.providers import Providers

router = APIRouter(prefix="/api/data")


def _p(request: Request) -> Providers:
    return request.app.state.providers


def _rows(request: Request, sql: str) -> list[dict]:
    """Query → list[dict]; tolerant of the SQLite fake lacking Phase-2 tables."""
    try:
        res = _p(request).aurora.query(sql)
        return [dict(zip(res.columns, r)) for r in res.rows]
    except Exception:
        return []


# ── Phase 2: rich Med-Surg 4W unit data (wireframe shape, seeded in Aurora) ───
@router.get("/roster")
async def roster(request: Request):
    return envelope(_rows(request,
        "SELECT ini, color, name, role, license, phone, shift, weekly_hours, status, "
        "pto_balance_pct, pto_balance_hours FROM roster ORDER BY id"))


@router.get("/risk-list")
async def risk_list(request: Request, tier: str | None = None):
    where = f"WHERE tier = '{_safe(tier).upper()}'" if tier and tier.lower() != "all" else ""
    return envelope(_rows(request,
        "SELECT tier, patient_name, syn_id, mrn, phone, appt_time, provider, risk_pct, "
        f"factors, action FROM risk_today {where} ORDER BY risk_pct DESC"))


@router.get("/pto-queue")
async def pto_queue(request: Request):
    return envelope(_rows(request,
        "SELECT ini, color, provider_name, type, dates, coverage_gap, status FROM pto_queue ORDER BY id"))


@router.get("/balances")
async def balances(request: Request):
    return envelope(_rows(request,
        "SELECT name, pto_balance_pct AS pct, pto_balance_hours AS hours FROM roster "
        "WHERE pto_balance_pct IS NOT NULL ORDER BY pto_balance_pct DESC"))


@router.get("/kpis")
async def kpis(request: Request):
    """Dashboard tiles. No-show mix + pending PTO computed from seeded data; the
    operational tiles (coverage/OT/occupancy/admits) are the unit's demo snapshot."""
    risk = _rows(request, "SELECT tier FROM risk_today")
    mix = {"RED": 0, "AMBER": 0, "GREEN": 0}
    for r in risk:
        mix[r["tier"]] = mix.get(r["tier"], 0) + 1
    pending = len(_rows(request, "SELECT id FROM pto_queue WHERE status='pend'"))
    total_appts = len(risk) + 16  # 12 listed + rest of the 28-appt day
    return envelope({
        "coverage_pct": 92, "open_shifts_7d": 6,
        "predicted_no_shows": mix["RED"] + 1, "appts_today": 28,
        "overtime_h": 38.5, "overtime_target": 32.5,
        "bed_occupancy_pct": 88, "beds_used": 31, "beds_total": 35,
        "predicted_admits_4h": 5, "pending_pto": pending,
        "risk_mix": mix,
    })


@router.get("/departments")
async def departments(request: Request):
    res = _p(request).aurora.query(
        "SELECT dept_id, name, min_staff_ratio, baseline_census FROM departments ORDER BY dept_id"
    )
    return envelope([dict(zip(res.columns, r)) for r in res.rows])


@router.get("/schedule")
async def schedule(request: Request, dept_id: int | None = None, days: int = 14):
    where = f"AND s.dept_id = {int(dept_id)}" if dept_id else ""
    res = _p(request).aurora.query(
        "SELECT s.shift_date, d.name AS dept, p.name AS provider, s.block, s.status "
        "FROM shifts s JOIN providers p ON p.provider_id = s.provider_id "
        "JOIN departments d ON d.dept_id = s.dept_id "
        f"WHERE s.shift_date >= date('now') {where} "
        "ORDER BY s.shift_date, d.name LIMIT 500"
    ) if _is_sqlite(request) else _p(request).aurora.query(
        "SELECT s.shift_date, d.name AS dept, p.name AS provider, s.block, s.status "
        "FROM shifts s JOIN providers p ON p.provider_id = s.provider_id "
        "JOIN departments d ON d.dept_id = s.dept_id "
        f"WHERE s.shift_date >= CURRENT_DATE {where} "
        "ORDER BY s.shift_date, d.name LIMIT 500"
    )
    return envelope([dict(zip(res.columns, r)) for r in res.rows])


@router.get("/coverage/{dept_id}")
async def coverage(request: Request, dept_id: int, days: int = 14):
    pts = _p(request).models.coverage_forecast(dept_id, days)
    return envelope([
        {"date": p.date, "block": p.block, "required": p.required,
         "projected": p.projected, "understaffed": p.understaffed}
        for p in pts
    ])


@router.get("/appointments/risk")
async def appointment_risk(request: Request, dept_id: int | None = None, limit: int = 20):
    where = f"WHERE dept_id = {int(dept_id)}" if dept_id else ""
    res = _p(request).aurora.query(
        f"SELECT appt_id, patient_ref, dept_id, appt_date FROM appointments {where} "
        f"ORDER BY appt_date DESC LIMIT {int(limit)}"
    )
    appts = [dict(zip(res.columns, r)) for r in res.rows]
    scores = {s.appt_id: s for s in _p(request).models.no_show_scores([a["appt_id"] for a in appts])}
    for a in appts:
        s = scores.get(a["appt_id"])
        a["risk_band"] = s.band if s else "green"
        a["risk_score"] = s.score if s else 0.0
        a["drivers"] = s.drivers if s else []
    return envelope(appts)


@router.get("/pto")
async def pto(request: Request, status: str = "pending"):
    res = _p(request).aurora.query(
        "SELECT t.pto_id, p.name AS provider, t.start_date, t.end_date, t.status, p.dept_id "
        "FROM pto_requests t JOIN providers p ON p.provider_id = t.provider_id "
        f"WHERE t.status = '{_safe(status)}' ORDER BY t.start_date"
    )
    return envelope([dict(zip(res.columns, r)) for r in res.rows])


@router.post("/pto/{pto_id}/decision")
async def pto_decision(request: Request, pto_id: int, decision: str = "approve"):
    """DR-05: show AI-computed coverage impact + a backfill proposal (approval-gated)."""
    p = _p(request)
    row = p.aurora.query(
        "SELECT t.pto_id, p.name AS provider, p.dept_id, t.start_date "
        f"FROM pto_requests t JOIN providers p ON p.provider_id = t.provider_id WHERE t.pto_id = {int(pto_id)}"
    )
    if not row.rows:
        return envelope({"error": "pto not found"}, status="not_found")
    rec = dict(zip(row.columns, row.rows[0]))
    impacted = [fp for fp in p.models.coverage_forecast(int(rec["dept_id"]), 14) if fp.understaffed]
    proposal = p.workflow.propose_schedule_change(
        f"{decision.upper()} PTO {pto_id} for {rec['provider']} (dept {rec['dept_id']}); "
        f"backfill {len(impacted)} understaffed day-block(s)",
        {"pto_id": pto_id, "decision": decision},
    )
    return envelope({
        "decision": decision,
        "coverage_impact": [{"date": fp.date, "required": fp.required, "projected": fp.projected} for fp in impacted],
        "proposal_id": proposal.proposal_id,
        "status": proposal.status,
        "note": "No write applied — human approval required (D7).",
    })


# ── helpers ───────────────────────────────────────────────────────────────────
def _is_sqlite(request: Request) -> bool:
    # FakeAurora is SQLite (date('now')); LiveAurora is Postgres (CURRENT_DATE).
    return request.app.state.providers.using_fakes


def _safe(s: str) -> str:
    return "".join(c for c in s if c.isalnum() or c in "-_")
