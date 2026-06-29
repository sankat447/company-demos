"""UC8 — REST surface over the Epic MCP adapter, so the SPA / demoer can SHOW the
tool calls ("AI → MCP tool → Epic"). Same FHIR-shaped tools the agent + the stdio
MCP server use; the adapter is the single data seam (the AI never touches Epic)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..disclaimer import envelope
from ..mcp import EPIC_TOOLS, EpicAdapter, EpicError

router = APIRouter(prefix="/api/mcp")


def _adapter(request: Request) -> EpicAdapter:
    return EpicAdapter(request.app.state.providers)


@router.get("/tools")
async def list_tools():
    """Advertise the callable FHIR tool surface (UC8)."""
    return envelope([{"name": n, "description": d} for n, d in EPIC_TOOLS.items()])


class ToolCall(BaseModel):
    tool: str
    args: dict = {}


@router.post("/call")
async def call_tool(request: Request, body: ToolCall):
    """Invoke a single Epic tool. Returns FHIR-shaped data, or a TYPED error with a
    degraded flag (callers enter degraded mode rather than fabricating — BR-12)."""
    try:
        result = _adapter(request).call(body.tool, **body.args)
        return envelope({"tool": body.tool, "result": result, "degraded": False})
    except EpicError as e:
        return envelope({"tool": body.tool, **e.as_dict(), "degraded": True})
