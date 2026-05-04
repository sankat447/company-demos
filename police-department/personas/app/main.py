"""FastAPI entrypoint for the police-department persona service.

Routes:
  /chat/{persona}      -- one of detective | patrol | evidence_clerk
  /hitl/queue          -- HTMX page listing pending HITL approvals
  /hitl/approve/{id}   -- approve a parked response, return final payload
  /hitl/reject/{id}    -- reject a parked response, log to custody_log
  /healthz             -- liveness
  /readyz              -- readiness (verifies redis + postgres reachable)
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from app.graphs import detective, evidence_clerk, patrol
from app.hitl.router import router as hitl_router
from app.schemas import ChatRequest, PersonaResponse
from app.tools import custody_log, redis_park

log = logging.getLogger("pd.personas")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

app = FastAPI(title="pd-personas", version="0.1.0")
app.include_router(hitl_router, prefix="/hitl", tags=["hitl"])

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
    response = runner(req)
    # Park for HITL — the response is not final until an operator approves.
    pending_id = redis_park.park(persona=persona, payload=response.model_dump())
    custody_log.log_pending_hitl(persona, pending_id, req.q,
                                 clip_id=response.evidence_clip_id)
    return response.with_pending_id(pending_id)
