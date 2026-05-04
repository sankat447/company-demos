"""HITL router — minimal stub.

Phase 8 expands this with /queue (HTMX page), /approve/{id}, /reject/{id}.
This stub exists so app.main can import the router cleanly even before the
HITL UI ships.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "module": "hitl"}
