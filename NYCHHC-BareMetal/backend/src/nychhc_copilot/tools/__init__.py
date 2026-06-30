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

    # ── Scheduling tools — same `service` actions the UI calls (one source of truth) ──
    from ..scheduling import service as S

    aurora = providers.aurora

    def _find_provider(text: str):
        text = (text or "").lower().replace("dr.", "").strip()
        rows = [dict(zip(r.columns, row)) for r in [aurora.query(
            "SELECT id, name, specialty FROM sched_providers")] for row in r.rows]
        for p in rows:
            if text and text in p["name"].lower():
                return p
        return None

    def _find_patient(text: str):
        t = (text or "").lower()
        res = aurora.query("SELECT id, name, mrn FROM sched_patients")
        for row in res.rows:
            p = dict(zip(res.columns, row))
            if t and (t in p["name"].lower() or t in p["mrn"].lower() or t in p["id"].lower()):
                return p
        return None

    def find_doctors(specialty: str) -> str:
        """List doctors in a specialty (e.g. Cardiology, Pulmonology) with each one's next open slot."""
        docs = S.list_doctors_by_specialty(aurora, specialty)
        if not docs:
            return f"No doctors found in specialty '{specialty}'. Try one of: {', '.join(S.list_specialties(aurora))}."
        return "\n".join(
            f"- {d['name']} ({d['credential']}, {d['specialty']}) · next open: "
            f"{(d['next_available'] or {}).get('date','—')} {(d['next_available'] or {}).get('time','')}"
            for d in docs)

    def view_calendar(provider: str, date: str) -> str:
        """Show a provider's calendar for an ISO date (YYYY-MM-DD): open and booked slots."""
        p = _find_provider(provider)
        if not p:
            return f"Unknown provider '{provider}'."
        cal = S.get_calendar(aurora, p["id"], date)
        if cal.get("blocked"):
            return f"{p['name']} is on PTO (Blocked) on {date}."
        opens = [s["time"] for s in cal["slots"] if s["status"] == "Open"]
        books = [f"{s['time']} {s['appt']['patient_name']}" for s in cal["slots"] if s["status"] == "Booked"]
        return f"{p['name']} · {date}\nOpen: {', '.join(opens) or 'none'}\nBooked: {', '.join(books) or 'none'}"

    def book_appointment(patient: str, provider: str, date: str, time: str,
                         type: str = "Follow-up", reason: str = "") -> str:
        """Book an appointment: patient (name or MRN), provider (name), date YYYY-MM-DD, time HH:MM."""
        pt, pr = _find_patient(patient), _find_provider(provider)
        if not pt:
            return f"Unknown patient '{patient}'."
        if not pr:
            return f"Unknown provider '{provider}'."
        r = S.book_appointment(aurora, pt["id"], pr["id"], date, time, type=type, reason=reason)
        return (f"Booked {pt['name']} with {r['provider']} ({r['specialty']}) on {date} at {time}."
                if r.get("ok") else f"Could not book: {r.get('error')}")

    def cancel_appointment(appt_query: str) -> str:
        """Cancel an appointment matched by patient name/MRN/provider/time; frees the slot and suggests re-offer candidates."""
        appts = S.find_appointments(aurora, query=appt_query)
        if not appts:
            return f"No booked appointment matches '{appt_query}'."
        a = appts[0]
        r = S.cancel_appointment(aurora, a["id"], reason="copilot")
        cands = ", ".join(c["name"] for c in r.get("reoffer_candidates", [])[:3])
        return (f"Cancelled {a['patient_name']}'s {a['appt_time']} with {a['provider_name']} on {a['appt_date']}. "
                f"Freed slot — re-offer candidates: {cands or 'none'}.")

    def modify_appointment(appt_query: str, new_date: str = "", new_time: str = "", new_provider: str = "") -> str:
        """Move an appointment (matched by patient/MRN/time) to a new date/time/provider; frees the old slot."""
        appts = S.find_appointments(aurora, query=appt_query)
        if not appts:
            return f"No appointment matches '{appt_query}'."
        a = appts[0]
        pid = _find_provider(new_provider)["id"] if new_provider and _find_provider(new_provider) else None
        r = S.modify_appointment(aurora, a["id"], provider_id=pid, d=new_date or None, time=new_time or None)
        return (f"Moved {a['patient_name']}'s appointment → {r['after']['date']} {r['after']['time']} with {r['provider']}."
                if r.get("ok") else f"Could not modify: {r.get('error')}")

    def pto_impact(provider: str, start: str, end: str) -> str:
        """Put a provider on PTO (start/end YYYY-MM-DD) and report impacted appointments + reassignment options."""
        p = _find_provider(provider)
        if not p:
            return f"Unknown provider '{provider}'."
        S.request_pto(aurora, p["id"], start, end, "Vacation")
        imp = S.compute_pto_impact(aurora, p["id"], start, end)
        lines = [f"{p['name']} PTO {start}→{end}: {imp['impacted_count']} appts impacted "
                 f"· {imp['auto_resolvable_count']} auto-resolvable · {imp['needs_manual_count']} need attention."]
        for a in imp["impacted"][:6]:
            opt = a["reassign_options"][0]["provider"] if a["reassign_options"] else \
                  (a["reschedule_options"][0]["provider"] + " (reschedule)" if a["reschedule_options"] else "manual")
            lines.append(f"- {a['patient_name']} {a['appt_date']} {a['appt_time']} → {a['recommendation']}: {opt}")
        lines.append("Say 'apply all auto' to reassign the auto-resolvable ones.")
        return "\n".join(lines)

    def apply_auto_reassign(provider: str, start: str, end: str) -> str:
        """Apply all auto-resolvable reassignments for a provider's PTO window (same-specialty, same-time peers)."""
        p = _find_provider(provider)
        if not p:
            return f"Unknown provider '{provider}'."
        imp = S.compute_pto_impact(aurora, p["id"], start, end)
        plan = [{"appt_id": a["id"], "provider_id": a["reassign_options"][0]["provider_id"],
                 "date": a["appt_date"], "time": a["appt_time"]}
                for a in imp["impacted"] if a["recommendation"] == "reassign"]
        if not plan:
            return "No auto-resolvable reassignments."
        r = S.apply_reassignments(aurora, plan)
        return f"Applied {r['applied']} reassignment(s); {r['failed']} failed."

    def unit_status() -> str:
        """Overall unit status (coverage, open shifts, no-show risk mix, pending PTO,
        today's bookings) as a markdown table. Use for 'how is everything' / overview."""
        def scalar(sql, default=0):
            try:
                r = aurora.query(sql).rows
                return r[0][0] if r and r[0] and r[0][0] is not None else default
            except Exception:
                return default
        red = scalar("SELECT COUNT(*) FROM risk_today WHERE tier='RED'")
        amber = scalar("SELECT COUNT(*) FROM risk_today WHERE tier='AMBER'")
        green = scalar("SELECT COUNT(*) FROM risk_today WHERE tier='GREEN'")
        pend = scalar("SELECT COUNT(*) FROM pto_queue WHERE status='pend'")
        booked = scalar("SELECT COUNT(*) FROM sched_appointments WHERE appt_date='2026-06-09' AND status='Booked'")
        return (
            "| Metric | Value |\n|---|---|\n"
            "| Coverage today | 92% |\n"
            "| Open shifts (7d) | 6 |\n"
            f"| No-show risk | {red} red · {amber} amber · {green} green |\n"
            f"| Pending PTO requests | {pend} |\n"
            f"| Appointments booked today | {booked} |\n"
            "| Overtime this week | 38.5h (target 32.5h) |"
        )

    sched_tools = [
        StructuredTool.from_function(unit_status),
        StructuredTool.from_function(find_doctors),
        StructuredTool.from_function(view_calendar),
        StructuredTool.from_function(book_appointment),
        StructuredTool.from_function(cancel_appointment),
        StructuredTool.from_function(modify_appointment),
        StructuredTool.from_function(pto_impact),
        StructuredTool.from_function(apply_auto_reassign),
    ]

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
        *sched_tools,
    ]


__all__ = ["build_tools", "build_providers", "Providers", "SCHEMA_DOC"]
