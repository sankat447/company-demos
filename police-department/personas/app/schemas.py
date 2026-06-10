"""Pydantic schemas shared across persona graphs and the HITL router."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    q: str = Field(..., description="Operator question (natural language)")
    clip_id: str | None = Field(None, description="Optional clip context")
    k: int = Field(8, ge=1, le=32)


class Claim(BaseModel):
    text: str
    confidence: float | None = None
    frame_refs: list[str] = Field(default_factory=list)


class Provenance(BaseModel):
    clip_ids: list[str] = Field(default_factory=list)
    narration_ids: list[str] = Field(default_factory=list)
    custody_log_ids: list[int] = Field(default_factory=list)


class PersonaResponse(BaseModel):
    persona: str
    prose: str
    claims: list[Claim] = Field(default_factory=list)
    provenance: Provenance = Field(default_factory=Provenance)
    pending_approval_id: str | None = None
    evidence_clip_id: str | None = None
    raw: dict[str, Any] | None = None

    def with_pending_id(self, pid: str) -> "PersonaResponse":
        clone = self.model_copy()
        clone.pending_approval_id = pid
        return clone
