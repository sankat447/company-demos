"""Request/response models for the API."""

from __future__ import annotations

from pydantic import BaseModel, Field

ROLES = ("Scheduler", "HR/Ops", "Provider")  # DR-01


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="The user's natural-language question (DR-11).")
    role: str = Field("Scheduler", description="Active role context (DR-01).")
    session_id: str = Field("demo-session", description="Conversation/session id.")


class Capability(BaseModel):
    id: str          # e.g. "DR-04"
    name: str
    ai_role: str     # where AI adds value, or "—"
    req: str         # "4.2" etc.
