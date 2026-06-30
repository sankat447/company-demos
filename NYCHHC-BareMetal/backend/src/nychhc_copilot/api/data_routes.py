"""Data API — provider-backed REST for the dashboard (NOT via the LLM).

Powers the role panes: roster, no-show risk panel (UC1), 90-day coverage (UC2),
template optimization (UC3), provider load balancing (VC-A), PTO queue, KPIs.
Uses UNQUALIFIED table names so the same SQL works against the SQLite fake and the
live `workforce` schema (LiveAurora sets search_path).
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..disclaimer import envelope
from ..scheduling import service as S
from ..scheduling.seed_data import TODAY
from ..tools.providers import Providers

router = APIRouter(prefix="/api/data")


def _p(request: Request) -> Providers:
    return request.app.state.providers


def _rows(request: Request, sql: str) -> list[dict]:
    try:
        res = _p(request).aurora.query(sql)
        return [dict(zip(res.columns, r)) for r in res.rows]
    except Exception:
        return []


def _safe(s: str) -> str:
    return "".join(c for c in s if c.isalnum() or c in "-_")


# ── dashboard tables (seeded) ────────────────────────────────────────────────
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
    risk = _rows(request, "SELECT tier FROM risk_today")
    mix = {"RED": 0, "AMBER": 0, "GREEN": 0}
    for r in risk:
        mix[r["tier"]] = mix.get(r["tier"], 0) + 1
    pending = len(_rows(request, "SELECT id FROM pto_queue WHERE status='pend'"))
    appts_today = len(_rows(request, f"SELECT id FROM sched_appointments WHERE appt_date='{TODAY}'"))
    return envelope({
        "coverage_pct": 92, "open_shifts_7d": 6,
        "predicted_no_shows": mix["RED"], "appts_today": appts_today,
        "overtime_h": 38.5, "overtime_target": 32.5,
        "pending_pto": pending, "risk_mix": mix,
    })


# ── UC1 — model-driven risk over the upcoming schedule ───────────────────────
@router.get("/appointments/risk")
async def appointment_risk(request: Request, limit: int = 20):
    appts = _rows(request,
        "SELECT a.id, a.appt_date, a.appt_time, a.type, pt.name AS patient_name, pr.name AS provider_name "
        "FROM sched_appointments a JOIN sched_patients pt ON pt.id = a.patient_id "
        f"JOIN sched_providers pr ON pr.id = a.provider_id WHERE a.appt_date >= '{TODAY}' "
        f"ORDER BY a.appt_date, a.appt_time LIMIT {int(limit)}")
    scored = _p(request).models.no_show_scores([a["id"] for a in appts])
    by_id = {s.appt_id: s for s in scored}
    for a in appts:
        s = by_id.get(a["id"])
        a["risk_band"] = s.band if s else "green"
        a["risk_score"] = s.score if s else 0.0
        a["drivers"] = s.drivers if s else []
    degraded = any(getattr(s, "source", "model") == "fallback" for s in scored)
    return envelope(appts, degraded=degraded, source="rules" if degraded else "model")


@router.get("/model-status")
async def model_status(request: Request):
    """UC1: are the KServe models reachable? Probes a real appt id; source='fallback'
    ⇒ degraded (rules)."""
    try:
        probe = _p(request).models.no_show_scores(["a1"])
        degraded = (not probe) or any(getattr(s, "source", "model") == "fallback" for s in probe)
    except Exception:
        degraded = True
    return envelope({"degraded": degraded, "source": "rules" if degraded else "model"})


# ── UC2 — 90-day coverage planning ───────────────────────────────────────────
@router.get("/coverage")
async def coverage(request: Request, horizon_days: int = 90):
    return envelope(S.coverage_plan(_p(request).aurora, horizon_days))


@router.get("/coverage/{dept_id}")
async def coverage_legacy(request: Request, dept_id: int, horizon_days: int = 90):
    # back-compat path used by the SPA; dept_id ignored (coverage is service-line wide).
    return envelope(S.coverage_plan(_p(request).aurora, horizon_days))


# ── VC-A — provider load balancing ───────────────────────────────────────────
@router.get("/load-balance")
async def load_balance(request: Request):
    return envelope(S.load_balance(_p(request).aurora))


# ── UC3 — template optimization ──────────────────────────────────────────────
@router.get("/template")
async def template(request: Request):
    return envelope(S.template_reco(_p(request).aurora))
