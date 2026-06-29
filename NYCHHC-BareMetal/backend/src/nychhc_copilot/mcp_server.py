"""MCP server — the `+add` tool surface from the reference diagram.

Exposes the SAME workforce tools the in-process agent uses, over the Model Context
Protocol, so external consumers (Open WebUI, other agents, Claude Desktop) get one
auditable tool surface: query Aurora · call KServe models · trigger n8n.

Design note: the in-process ReAct agent binds these tools directly (latency +
demo-day reliability — no extra server to babysit). This MCP server is the SAME
logic re-exposed for external callers; both go through the one `Providers` bundle.

Run:  python -m nychhc_copilot.mcp_server          # stdio transport
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from .config import get_settings
from .disclaimer import DISCLAIMER
from .mcp import EpicAdapter, EpicError
from .tools import SCHEMA_DOC
from .tools.providers import ReadOnlySQLError, build_providers

mcp = FastMCP("nychhc-workforce-copilot")

_providers = build_providers(get_settings())
_epic = EpicAdapter(_providers)  # UC8 — FHIR-shaped Epic data seam


@mcp.tool(
    description="Run a READ-ONLY (SELECT/WITH) SQL query against the workforce database "
    "and return a markdown table.\n\n" + SCHEMA_DOC
)
def query_workforce_db(sql: str) -> str:
    """Run a READ-ONLY (SELECT/WITH) SQL query against the workforce database."""
    try:
        res = _providers.aurora.query(sql)
    except ReadOnlySQLError as e:
        return f"Query rejected: {e}"
    except Exception as e:
        return f"Query error: {type(e).__name__}: {e}"
    return res.as_markdown() if res.rows else "No rows."


@mcp.tool()
def no_show_risk(appt_ids: list[int]) -> str:
    """No-show risk (red/amber/green) for appointment ids — No-Show KServe model."""
    scores = _providers.models.no_show_scores(appt_ids)
    if not scores:
        return "No scores."
    return "\n".join(
        f"- appt {s.appt_id}: {s.band.upper()} ({s.score:.0%}) — {', '.join(s.drivers)} [{s.source}]"
        for s in scores
    )


@mcp.tool()
def coverage_forecast(dept_id: int, horizon_days: int = 14) -> str:
    """Forecast staffing coverage; flag understaffed day-blocks — Coverage KServe model."""
    pts = _providers.models.coverage_forecast(dept_id, horizon_days)
    flagged = [p for p in pts if p.understaffed]
    if not pts:
        return "No forecast (unknown dept_id?)."
    if not flagged:
        return f"No understaffed day-blocks in the next {horizon_days} days for dept {dept_id}."
    return "Understaffed day-blocks:\n" + "\n".join(
        f"- {p.date} {p.block}: need {p.required:.0f}, have {p.projected:.0f}" for p in flagged
    )


@mcp.tool()
def propose_schedule_change(summary: str) -> str:
    """Propose a schedule change — routed to a human approver via n8n. Never applied directly."""
    prop = _providers.workflow.propose_schedule_change(summary, {"summary": summary})
    return f"Proposal {prop.proposal_id} — STATUS: {prop.status} (via {prop.routed_via}). Human approval required."


# ── UC8: Epic FHIR-shaped tools (the AI's only data path; BR-12/BR-14) ────────
@mcp.tool()
def get_patient_appointments(patient_id: str) -> list[dict]:
    """FHIR Appointments for a patient (Epic via the MCP adapter — never Epic directly)."""
    try:
        return _epic.get_patient_appointments(patient_id)
    except EpicError as e:
        return [e.as_dict()]


@mcp.tool()
def get_provider_schedule(provider_id: str, date: str) -> list[dict]:
    """A provider's booked FHIR Appointments for a date (via the MCP adapter)."""
    try:
        return _epic.get_provider_schedule(provider_id, date)
    except EpicError as e:
        return [e.as_dict()]


@mcp.tool()
def check_slot_availability(provider_id: str, date: str) -> list[dict]:
    """Open FHIR Slots for a provider on a date (via the MCP adapter)."""
    try:
        return _epic.check_slot_availability(provider_id, date)
    except EpicError as e:
        return [e.as_dict()]


@mcp.resource("disclaimer://demo")
def disclaimer() -> str:
    """The mandatory demo disclaimer (L10)."""
    return DISCLAIMER


if __name__ == "__main__":
    mcp.run()  # stdio transport
