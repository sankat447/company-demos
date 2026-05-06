"""FastAPI entrypoint for the police-department persona service.

Routes:
  GET  /                       -- Chat UI (upload, processing progress, chat)
  POST /chat/{persona}         -- one of detective | patrol | evidence_clerk
  /api/upload, /api/clips, /api/clip/{id}, /api/pipeline/..., /api/mode
                               -- chat-UI backend (see app.web.router)
  /hitl/queue, /hitl/approve   -- HITL approval HTMX UI (legacy)
  /healthz, /readyz            -- probes
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from app.graphs import detective, evidence_clerk, patrol
from app.hitl.router import router as hitl_router
from app.schemas import ChatRequest, PersonaResponse
from app.tools import chat_history, custody_log, redis_park
from app.web.router import router as web_router

log = logging.getLogger("pd.personas")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

app = FastAPI(title="pd-personas", version="0.2.0")
app.include_router(hitl_router, prefix="/hitl", tags=["hitl"])
app.include_router(web_router, tags=["ui"])

PERSONAS = {
    "detective":      detective.run,
    "patrol":         patrol.run,
    "evidence_clerk": evidence_clerk.run,
}


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/readyz")
def readyz() -> JSONResponse:
    issues = []
    try:
        redis_park.client().ping()
    except Exception as e:
        issues.append(f"redis: {e}")
    try:
        from app.tools import pgvector_query
        pgvector_query.healthcheck()
    except Exception as e:
        issues.append(f"postgres: {e}")
    if issues:
        return JSONResponse(status_code=503, content={"status": "degraded", "issues": issues})
    return JSONResponse(content={"status": "ok"})


@app.post("/chat/{persona}", response_model=PersonaResponse)
def chat(persona: str, req: ChatRequest) -> PersonaResponse:
    runner = PERSONAS.get(persona)
    if runner is None:
        raise HTTPException(404, f"unknown persona: {persona}; "
                                 f"valid: {sorted(PERSONAS)}")
    # Record the user question first (so even on LLM error the UI sees it).
    if req.clip_id:
        chat_history.append(req.clip_id, {
            "who": "user", "text": req.q, "claims": [],
        })
    response = runner(req)
    # Persist the assistant response keyed by clip.
    target_clip = req.clip_id or response.evidence_clip_id
    if target_clip:
        chat_history.append(target_clip, {
            "who": persona,
            "text": response.prose,
            "claims": [c.model_dump() for c in response.claims],
        })
    # Park for HITL — the response is not final until an operator approves.
    pending_id = redis_park.park(persona=persona, payload=response.model_dump())
    custody_log.log_pending_hitl(persona, pending_id, req.q,
                                 clip_id=response.evidence_clip_id)
    return response.with_pending_id(pending_id)
