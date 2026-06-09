"""Agent tool surface.

The same four tool functions are (a) wrapped as LangChain tools for the in-process
ReAct agent here, and (b) re-exported by ``mcp_server.py`` as an MCP server for
external consumers (Open WebUI / other agents) — the diagram's `+add` MCP component.
Both bind to the `Providers` bundle, so fake↔live is one factory decision.
"""

from __future__ import annotations

from langchain_core.tools import StructuredTool

from .providers import Providers, ReadOnlySQLError, build_providers

# The schema the LLM needs to write correct text-to-SQL (DR-12). Kept terse.
SCHEMA_DOC = """\
Read-only Postgres-like schema `workforce`:
- departments(dept_id, name, min_staff_ratio, baseline_census)
- providers(provider_id, name, role['MD'|'APP'|'RN'], dept_id)
- shifts(shift_id, provider_id, dept_id, shift_date, block['day'|'evening'|'night'], status['scheduled'|'open'|'swapped'|'cancelled'])
- pto_requests(pto_id, provider_id, start_date, end_date, status['pending'|'approved'|'denied'])
- appointments(appt_id, patient_ref, dept_id, provider_id, appt_date, lead_time_days, prior_noshows, age_band, outcome['attended'|'no_show'|'cancelled'])
Only SELECT/WITH allowed. Dates are ISO strings."""


def build_tools(providers: Providers) -> list[StructuredTool]:
    """LangChain tools bound to the given providers."""

    def query_workforce_db(sql: str) -> str:
        """Run a READ-ONLY SQL query against the workforce database (SELECT/WITH only)."""
        try:
            res = providers.aurora.query(sql)
        except ReadOnlySQLError as e:
            return f"Query rejected: {e}"
        except Exception as e:  # surface DB errors to the agent so it can retry
            return f"Query error: {type(e).__name__}: {e}"
        if not res.rows:
            return "No rows."
        return res.as_markdown()

    def no_show_risk(appt_ids: list[int]) -> str:
        """Get no-show risk scores (red/amber/green) for the given appointment ids.
        Backed by the No-Show KServe model (falls back to a rules model if down)."""
        scores = providers.models.no_show_scores(appt_ids)
        if not scores:
            return "No scores."
        lines = [f"- appt {s.appt_id}: {s.band.upper()} ({s.score:.0%}) — {', '.join(s.drivers)} [{s.source}]"
                 for s in scores]
        return "\n".join(lines)

    def coverage_forecast(dept_id: int, horizon_days: int = 14) -> str:
        """Forecast staffing coverage for a department over the next N days.
        Flags days where projected staff < required. Backed by the Coverage
        Forecast KServe model (rules fallback if down)."""
        pts = providers.models.coverage_forecast(dept_id, horizon_days)
        if not pts:
            return "No forecast (unknown dept_id?)."
        flagged = [p for p in pts if p.understaffed]
        if not flagged:
            return f"No understaffed day-blocks in the next {horizon_days} days for dept {dept_id}."
        return "Understaffed day-blocks:\n" + "\n".join(
            f"- {p.date} {p.block}: need {p.required:.0f}, have {p.projected:.0f}" for p in flagged
        )

    def propose_schedule_change(summary: str) -> str:
        """Propose a schedule change (backfill/swap/overbook). Does NOT apply it —
        returns a draft routed to a human approver via n8n (approval required)."""
        prop = providers.workflow.propose_schedule_change(summary, {"summary": summary})
        return (f"Proposal {prop.proposal_id} created — STATUS: {prop.status} "
                f"(routed via {prop.routed_via}). A human must approve before any write.")

    query_desc = (
        "Run a READ-ONLY SQL query against the workforce database and return a markdown "
        "table. Use for any operational data question (schedules, appointments, PTO, "
        "no-show rates). SELECT/WITH only.\n\n" + SCHEMA_DOC
    )
    return [
        StructuredTool.from_function(query_workforce_db, description=query_desc),
        StructuredTool.from_function(no_show_risk),
        StructuredTool.from_function(coverage_forecast),
        StructuredTool.from_function(propose_schedule_change),
    ]


__all__ = ["build_tools", "build_providers", "Providers", "SCHEMA_DOC"]
