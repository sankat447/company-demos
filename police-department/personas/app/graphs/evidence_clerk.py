"""Evidence-Clerk persona — assembles evidence-packet manifests with hashes."""
from __future__ import annotations

from app.graphs._common import call_llm_as_persona
from app.schemas import ChatRequest, PersonaResponse


def run(req: ChatRequest) -> PersonaResponse:
    return call_llm_as_persona("evidence_clerk", req)
