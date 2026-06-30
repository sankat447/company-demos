"""Agent tool surface.

The same four tool functions are (a) wrapped as LangChain tools for the in-process
ReAct agent here, and (b) re-exported by ``mcp_server.py`` as an MCP server for
external consumers (Open WebUI / other agents) — the diagram's `+add` MCP component.
Both bind to the `Providers` bundle, so fake↔live is one factory decision.
"""

from __future__ import annotations

from langchain_core.tools import StructuredTool

from .providers import Providers, ReadOnlySQLError, build_providers

# The schema the LLM needs to write correct text-to-SQL (UC5). Kept terse.
SCHEMA_DOC = """\
Read-only OBGYN scheduling schema (unqualified table names are fine):
- sched_providers(id, name, credential, specialty['Obstetrics'|'Gynecology'|'Maternal-Fetal Medicine'|'Midwifery'], provider_type['MD'|'Midwife'|'PA'|'Walk-in'], room, work_start, work_end, slot_min)
- sched_patients(id, name, mrn, risk_tier, prior_noshows, has_contact, visit_count, contact_pref)
- sched_appointments(id, patient_id, provider_id, appt_date, appt_time, duration_min, type['New OB'|'Follow-up'|'High Risk'|'GYN Consult'|'Walk-in'], status)
- sched_pto(id, provider_id, start_date, end_date, type, status)
- risk_today(tier['RED'|'AMBER'|'GREEN'], patient_name, provider, appt_time, risk_pct, factors, action) -- today's no-show panel
- pto_queue(provider_name, type, dates, coverage_gap, status)
- appt_history(appt_date, day_of_week, time_of_day, appt_type, duration_min, provider_id, provider_type, prior_noshows, has_contact, visit_count, actual_noshow, outcome['attended'|'advance_cancel'|'no_show']) -- ~18 months for analytics
- walkin_daily(wdate, day_of_week, am, pm) -- last 12 weeks of walk-in volume by AM/PM
- cycle_log(referral_date, clerical_days, scheduling_days, provider_days, cohort['recent'|'prior']) -- referral→seen handoff timings
Joins: sched_appointments.provider_id = sched_providers.id; sched_appointments.patient_id = sched_patients.id.
Only SELECT/WITH allowed. Dates are ISO strings (today is 2026-06-09)."""


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

    def no_show_risk(appt_ids: list[str]) -> str:
        """Get no-show risk scores (red/amber/green) for the given appointment ids (e.g. 'a1').
        Backed by the No-Show KServe model (falls back to a rules model if down)."""
        scores = providers.models.no_show_scores(appt_ids)
        if not scores:
            return "No scores."
        lines = [f"- appt {s.appt_id}: {s.band.upper()} ({s.score:.0%}) — {', '.join(s.drivers)} [{s.source}]"
                 for s in scores]
        return "\n".join(lines)

    def coverage_plan(horizon_days: int = 90) -> str:
        """UC2: project provider coverage vs service-line minimums over N days (default 90)
        and list the days/service-lines that fall short (with who is out)."""
        from ..scheduling import service as _S
        plan = _S.coverage_plan(providers.aurora, horizon_days)
        if not plan["gap_count"]:
            return f"No coverage gaps in the next {horizon_days} days — all service lines meet minimum."
        lines = [f"{plan['gap_count']} day(s) below minimum in {horizon_days} days:"]
        for sl, cnt in plan["by_service_line"].items():
            lines.append(f"- {sl}: short on {cnt} day(s)")
        for g in plan["gaps"][:5]:
            lines.append(f"  · {g['date']} {g['service_line']} {g['available']}/{g['required']} "
                         f"(out: {', '.join(g['providers_out']) or 'PTO'})")
        return "\n".join(lines)

    def cancellation_breakdown() -> str:
        """ASK1/UC3: cancellation rate by weekday/shift split into advance cancellations
        (refilled from waitlist) vs TRUE no-shows — drives the double-block decision."""
        from ..scheduling import service as _S
        cb = _S.cancellation_breakdown(providers.aurora)
        rows = sorted(cb["by_slot"], key=lambda s: -s["cancel_pct"])[:6]
        return (f"clinic avg cancel {cb['clinic_avg_cancel_pct']}%\n" + "\n".join(
            f"- {s['day']} {s['shift']}: {s['cancel_pct']}% ({s['advance_pct']}% advance / "
            f"{s['noshow_pct']}% true no-show)" for s in rows))

    def template_optimization() -> str:
        """UC3/ASK1: double-block only where TRUE no-shows are high; where cancellations are
        advance (refilled), tighten waitlist auto-fill instead."""
        from ..scheduling import service as _S
        recs = _S.template_reco(providers.aurora)["recommendations"]
        hot = [r for r in recs if "Double-block" in r["booking"] or "Do NOT" in r["booking"]] or recs
        return "\n".join(f"- {r['day']} {r['shift']}: {r['no_show_rate']}% true no-show, "
                         f"{r['advance_rate']}% advance → {r['booking']}" for r in hot[:8])

    def walkin_scenario(day: str = "Friday") -> str:
        """ASK1: model a half-day (AM-only) walk-in template for a weekday vs full-day —
        coverage, provider-hours and cost saved, overflow risk."""
        from ..scheduling import service as _S
        return _S.walkin_scenario(providers.aurora, day or "Friday")["recommendation"]

    def provider_load() -> str:
        """ASK4/VC-A: provider load by weekday in provider-MINUTES weighted by visit mix
        (headcount ≠ capacity); flags over/under-load + a rebalance recommendation."""
        from ..scheduling import service as _S
        lb = _S.load_balance(providers.aurora, providers.models)
        return (f"dept avg {lb['avg_utilization_pct']}% utilization\n" + "\n".join(
            f"- {d['day']}: {d['providers_per_day']} providers, {d['avg_visit_min']}-min avg visit "
            f"→ {d['utilization_pct']}% ({d['flag']})" for d in lb["by_day"]) +
            ("\n" + lb["rebalance"] if lb.get("rebalance") else ""))

    def cycle_time() -> str:
        """ASK3: department cycle time (referral→seen) across role handoffs, with the
        increase attributed to a stage (the clerical-intake bottleneck)."""
        from ..scheduling import service as _S
        ct = _S.cycle_time(providers.aurora)
        s = ct["stages_recent"]
        return (f"cycle {ct['cycle_days_recent']}d (was {ct['cycle_days_prior']}d) — clerical {s['clerical']}d / "
                f"scheduling {s['scheduling']}d / provider {s['provider']}d; bottleneck: {ct['bottleneck_label']}")

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
        """List doctors in a specialty (Obstetrics, Gynecology, Maternal-Fetal Medicine, Midwifery) with each one's next open slot."""
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
        StructuredTool.from_function(coverage_plan),
        StructuredTool.from_function(cancellation_breakdown),
        StructuredTool.from_function(template_optimization),
        StructuredTool.from_function(walkin_scenario),
        StructuredTool.from_function(provider_load),
        StructuredTool.from_function(cycle_time),
        StructuredTool.from_function(propose_schedule_change),
        *sched_tools,
    ]


__all__ = ["build_tools", "build_providers", "Providers", "SCHEMA_DOC"]
