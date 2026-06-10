"""Scheduling REST — the action layer the frontend drawer calls (and the Copilot
tools wrap the same `service`). Writes mutate the demo's own Aurora schema."""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..disclaimer import envelope
from ..scheduling import service as S

router = APIRouter(prefix="/api/sched")


def _a(request: Request):
    return request.app.state.providers.aurora


@router.get("/specialties")
async def specialties(request: Request):
    return envelope(S.list_specialties(_a(request)))


@router.get("/doctors")
async def doctors(request: Request, specialty: str):
    return envelope(S.list_doctors_by_specialty(_a(request), specialty))


@router.get("/calendar")
async def calendar(request: Request, provider_id: str, date: str):
    return envelope(S.get_calendar(_a(request), provider_id, date))


@router.get("/appointments")
async def appointments(request: Request, query: str = "", provider_id: str = "",
                       patient_id: str = "", date: str = ""):
    return envelope(S.find_appointments(_a(request), query=query, provider_id=provider_id,
                                        patient_id=patient_id, d=date))


@router.get("/patients")
async def patients(request: Request):
    res = _a(request).query("SELECT id, name, mrn, phone, risk_tier FROM sched_patients ORDER BY name")
    return envelope([dict(zip(res.columns, r)) for r in res.rows])


class BookBody(BaseModel):
    patient_id: str
    provider_id: str
    date: str
    time: str
    duration_min: int = 30
    type: str = "Follow-up"
    reason: str = ""


@router.post("/book")
async def book(request: Request, body: BookBody):
    return envelope(S.book_appointment(_a(request), body.patient_id, body.provider_id, body.date,
                                       body.time, body.duration_min, body.type, body.reason))


class ModifyBody(BaseModel):
    provider_id: str | None = None
    date: str | None = None
    time: str | None = None


@router.post("/modify/{appt_id}")
async def modify(request: Request, appt_id: str, body: ModifyBody):
    return envelope(S.modify_appointment(_a(request), appt_id, body.provider_id, body.date, body.time))


class CancelBody(BaseModel):
    reason: str = ""


@router.post("/cancel/{appt_id}")
async def cancel(request: Request, appt_id: str, body: CancelBody):
    return envelope(S.cancel_appointment(_a(request), appt_id, body.reason))


class PtoBody(BaseModel):
    provider_id: str
    start: str
    end: str
    type: str = "Vacation"


@router.post("/pto")
async def pto(request: Request, body: PtoBody):
    return envelope(S.request_pto(_a(request), body.provider_id, body.start, body.end, body.type))


@router.post("/pto/{pto_id}/approve")
async def pto_approve(request: Request, pto_id: str):
    return envelope(S.approve_pto(_a(request), pto_id))


@router.get("/pto-impact")
async def pto_impact(request: Request, provider_id: str, start: str, end: str):
    return envelope(S.compute_pto_impact(_a(request), provider_id, start, end))


class ApplyBody(BaseModel):
    plan: list[dict]


@router.post("/apply-reassignments")
async def apply(request: Request, body: ApplyBody):
    return envelope(S.apply_reassignments(_a(request), body.plan))
