"""Detective persona — investigative narrative grounded in pd_cctv evidence."""
from __future__ import annotations

from app.graphs._common import call_llm_as_persona
from app.schemas import ChatRequest, PersonaResponse


def run(req: ChatRequest) -> PersonaResponse:
    return call_llm_as_persona("detective", req)
