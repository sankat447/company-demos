"""API routes.

Every response carries the disclaimer (L10) — JSON via `envelope()`, and the
streaming endpoint emits a final `meta` event containing it.
"""

from __future__ import annotations

import json
from typing import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..agent.base import Copilot, Turn
from ..config import Settings
from ..disclaimer import DISCLAIMER, DISCLAIMER_ASCII, envelope
from .schemas import ChatRequest

router = APIRouter()

# DR catalog (mirrors docs/FUNCTIONAL_SPEC.md). Drives the frontend's capability list.
CAPABILITIES: list[dict] = [
    {"id": "DR-01", "name": "Role context (Scheduler/HR-Ops/Provider)", "ai_role": "— (tailors answers)", "req": "4.1"},
    {"id": "DR-02", "name": "View provider schedules", "ai_role": "—", "req": "4.2"},
    {"id": "DR-03", "name": "Create / modify appointment or shift", "ai_role": "— (rule validation)", "req": "4.2"},
    {"id": "DR-04", "name": "Suggest optimal slot", "ai_role": "Smart Scheduling Agent", "req": "4.2"},
    {"id": "DR-05", "name": "Submit PTO + coverage impact", "ai_role": "PTO Impact Agent (n8n HITL)", "req": "4.2"},
    {"id": "DR-06", "name": "No-show risk score", "ai_role": "No-Show model (KServe)", "req": "4.3"},
    {"id": "DR-07", "name": "Act on no-show risk", "ai_role": "No-Show Mitigation Agent (n8n)", "req": "4.3"},
    {"id": "DR-08", "name": "Coverage risk forecast", "ai_role": "Forecast model (KServe) + agent", "req": "4.3"},
    {"id": "DR-09", "name": "Proactive coverage alert", "ai_role": "Coverage Risk Agent → n8n", "req": "4.3"},
    {"id": "DR-10", "name": "Operational dashboards", "ai_role": "— (Grafana)", "req": "4.4"},
    {"id": "DR-11", "name": "Ask a natural-language question", "ai_role": "Conversational Copilot (RAG)", "req": "4.4"},
    {"id": "DR-12", "name": "NL → data answer / mini-report", "ai_role": "Insights Agent (text-to-SQL via MCP)", "req": "4.4"},
]


def _copilot(request: Request) -> Copilot:
    return request.app.state.copilot


def _settings(request: Request) -> Settings:
    return request.app.state.settings


@router.get("/health")
async def health(request: Request):
    s = _settings(request)
    return envelope({"status": "ok", "mode": s.mode.value}, service=s.service_name)


@router.get("/api/capabilities")
async def capabilities():
    return envelope(CAPABILITIES)


@router.post("/api/chat")
async def chat(req: ChatRequest, request: Request):
    """Stream the copilot answer as Server-Sent Events.

    Events:
      event: token  data: {"text": "..."}      (many)
      event: meta   data: {"disclaimer": ..., "role": ..., "citations": [...]}  (one, last)
    """
    copilot = _copilot(request)
    turn = Turn(message=req.message, role=req.role, session_id=req.session_id)

    async def event_stream() -> AsyncIterator[bytes]:
        async for chunk in copilot.stream(turn):
            yield _sse("token", {"text": chunk})
        # Final meta event always carries the disclaimer (L10).
        yield _sse("meta", {"disclaimer": DISCLAIMER, "role": turn.role, "citations": turn.citations})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Demo-Disclaimer": DISCLAIMER_ASCII},
    )


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()
