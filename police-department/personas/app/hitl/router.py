"""HITL router — operator queue, approve, reject, edit-and-approve.

Mounted at `/hitl` from `app.main`. Renders an HTMX page that polls
`/hitl/queue.partial` every 5 s. Approve/reject endpoints atomically
consume the parked Redis entry and append a custody-log row.

The frontend is intentionally tiny — an HTMX page with no build step. We
do not want to drag a JS build pipeline into a demo.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from app.tools import custody_log, redis_park

router = APIRouter()

_TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
_templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


@router.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "module": "hitl"}


@router.get("/queue", response_class=HTMLResponse)
def queue_page(request: Request) -> HTMLResponse:
    return _templates.TemplateResponse(
        request, "queue.html",
        {"pending": redis_park.list_pending()},
    )


@router.get("/queue.partial", response_class=HTMLResponse)
def queue_partial(request: Request) -> HTMLResponse:
    """HTMX-poll target — returns just the rows table."""
    return _templates.TemplateResponse(
        request, "queue_rows.html",
        {"pending": redis_park.list_pending()},
    )


@router.post("/approve/{pending_id}")
def approve(pending_id: str,
            operator: str = Form("operator"),
            edit: str | None = Form(None)) -> JSONResponse:
    parked = redis_park.consume(pending_id)
    if parked is None:
        raise HTTPException(404, f"pending_approval_id not found: {pending_id}")
    payload = parked["payload"]
    persona = parked["persona"]
    edit_diff = None
    if edit:
        edit_diff = f"prose-replaced(len={len(edit)})"
        payload["prose"] = edit
        payload["raw"] = (payload.get("raw") or {}) | {"operator_edit": True}
    custody_log.log_hitl_decision(
        persona, pending_id, "approved",
        operator=operator,
        clip_id=payload.get("evidence_clip_id"),
        edit_diff=edit_diff,
    )
    return JSONResponse({
        "pending_approval_id": pending_id,
        "status": "approved",
        "operator": operator,
        "edited": bool(edit),
        "released_payload": payload,
    })


@router.post("/reject/{pending_id}")
def reject(pending_id: str,
           operator: str = Form("operator"),
           reason: str = Form("")) -> JSONResponse:
    parked = redis_park.consume(pending_id)
    if parked is None:
        raise HTTPException(404, f"pending_approval_id not found: {pending_id}")
    custody_log.log_hitl_decision(
        parked["persona"], pending_id, "rejected",
        operator=operator,
        clip_id=parked["payload"].get("evidence_clip_id"),
        edit_diff=f"reject_reason: {reason[:200]}" if reason else None,
    )
    return JSONResponse({
        "pending_approval_id": pending_id,
        "status": "rejected",
        "operator": operator,
        "reason": reason,
    })


@router.get("/inspect/{pending_id}")
def inspect(pending_id: str) -> JSONResponse:
    parked = redis_park.fetch(pending_id)
    if parked is None:
        raise HTTPException(404, f"pending_approval_id not found: {pending_id}")
    return JSONResponse({
        "pending_approval_id": pending_id,
        "persona": parked["persona"],
        "payload": parked["payload"],
    })
