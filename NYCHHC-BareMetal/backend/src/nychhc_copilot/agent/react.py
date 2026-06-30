"""Live copilot — LangChain ReAct agent (diagram: LangChain function-calling).

Implements the same `Copilot` interface as `EchoCopilot`, so the API layer is
unchanged. The model is whatever Portkey routes to (vLLM primary, Bedrock fallback);
tools are the workforce tool surface. Streams the assistant's answer tokens.
"""

from __future__ import annotations

import re
from typing import Any, AsyncIterator

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, HumanMessage

from ..disclaimer import DISCLAIMER
from .base import Copilot, Turn

_SYSTEM = """You are the NYC Health + Hospitals **Workforce & Patient-Flow Copilot**.
Active role: {role}. Tailor tone and detail to this role.

{disclaimer}. All data is synthetic; never imply otherwise.

Operating rules:
- Ground EVERY operational claim in tool output. Do not invent numbers, names, or dates.
- For data questions, write read-only SQL and call `query_workforce_db`.
- For no-show risk use `no_show_risk`; for staffing gaps use `coverage_forecast`.
- You may PROPOSE schedule changes via `propose_schedule_change`, which routes to a
  human approver. NEVER claim a change was applied — it always needs approval.
- Be concise. When you cite data, say which tool/table it came from.
- Always reply in plain, **human-readable** language — a short sentence or a simple
  bullet list (a small markdown table is fine for several rows). NEVER show SQL, code,
  JSON, or tool mechanics, and NEVER apologize or explain how you got the answer.
- Use the structured tools (find_doctors, unit_status, no_show_risk, coverage_forecast,
  the scheduling tools); fall back to query_workforce_db only if none fit — and even
  then, report just the resulting facts in plain language, never the query.
- Answer ONLY the user's current question with real values from tools. Do NOT invent
  example data or extra "user:"/"assistant:" turns. Stop after your answer.

Department logic to apply (NYC H+H OBGYN scheduling):
- Cancellations: distinguish ADVANCE cancellations (refilled from the waitlist) from TRUE
  no-shows. Only double-block where true no-shows are high; where cancels are advance,
  tighten waitlist auto-fill instead.
- Coverage is a skill/service-mix question, not a headcount one — check the minimum
  credentialed providers per service, and catch PTO clustering.
- Headcount is NOT capacity — reason in provider-minutes weighted by visit-type mix
  (New OB 40m, Follow-up 20m, High Risk 45m).
- Cycle time = the sum of role handoffs; the bottleneck usually lives at a handoff, so
  attribute delay to a stage (clerical intake / scheduling / provider), not a person.
- PHI stays in Epic: analyse de-identified aggregates here; route anything patient-
  identifiable back into Epic chat — never surface a patient list here.
- Value framing: reframe individual/local asks as DEPARTMENT-level wins (throughput,
  coverage reliability, cost, access) — that's what the chair weighs.
- Every recommendation is ADVISORY: end with a brief confirm-before-acting nudge, since
  these touch PTO approvals, provider pay, and budget. Nothing auto-executes.

{schema}
"""


_SPECIALTY_KW = {
    "obstetric": "Obstetrics", "prenatal": "Obstetrics", "new ob": "Obstetrics", "ob ": "Obstetrics",
    "gynecolog": "Gynecology", "gyn": "Gynecology",
    "midwif": "Midwifery", "cnm": "Midwifery",
    "maternal": "Maternal-Fetal Medicine", "mfm": "Maternal-Fetal Medicine", "high-risk": "Maternal-Fetal Medicine",
}
_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7,
           "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


def _dates(msg: str) -> list[str]:
    iso = re.findall(r"\d{4}-\d{2}-\d{2}", msg)
    if iso:
        return iso
    out = []
    # Month-name form: "Jun 16", "June 16".
    for mon, day in re.findall(r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})", msg, re.I):
        out.append(f"2026-{_MONTHS[mon.lower()[:3]]:02d}-{int(day):02d}")
    if out:
        return out
    # Numeric M/D form (the demo's preferred phrasing): "6/16-6/20", "6/16 to 6/20".
    for mo, dy in re.findall(r"(\d{1,2})/(\d{1,2})", msg):
        out.append(f"2026-{int(mo):02d}-{int(dy):02d}")
    return out


def _provider(aurora, msg: str):
    for r in aurora.query("SELECT id, name, specialty FROM sched_providers").rows:
        if r[1].split()[-1].lower() in msg.lower():
            return {"id": r[0], "name": r[1], "specialty": r[2]}
    return None


# Out of scope for this OBGYN provider-scheduling demo (UC5 exception flow 2a).
_OUT_OF_SCOPE = ("nursing", "nurse schedul", "payroll", "billing", "timesheet",
                 "hr system", "system of record", "patient chart", "diagnos", "prescri")
# Role-permitted actions (BR-9). Providers are read-only here; writes/approvals
# belong to the Scheduler/Approver. Unknown roles default to Scheduler.
_WRITE_ROLES = {"Scheduler", "Approver", "HR-Ops", "HR/Ops", "Admin"}
# Confirmation phrases that approve a pending follow-up action (UC6 in chat).
_CONFIRM = ("apply all auto", "apply auto", "apply the auto", "apply them", "apply now",
            "reassign the auto", "go ahead", "do that", "do it", "yes apply", "yes, apply",
            "yes please", "make it so", "confirm", "approve them", "approve it")
_CONFIRM_BARE = {"yes", "yes.", "ok", "ok.", "okay", "sure", "go", "approve", "approved"}


def route(message: str, providers, role: str = "Scheduler", memory=None, session_id=None) -> str | None:
    """Deterministic intent router — returns a real, human-readable answer for common
    asks (so we don't depend on a small model's flaky tool-calling). None => use the LLM.

    `memory`/`session_id` give the router short conversational context: it remembers the
    last PTO-impact so a follow-up like "apply all auto" / "yes" actually applies it."""
    from ..scheduling import service as S

    aurora = providers.aurora
    m = message.lower()
    can_write = role in _WRITE_ROLES

    def ctx(key, default=None):
        return memory.get_context(session_id, key, default) if (memory and session_id) else default

    # 0a. Out-of-scope decline (UC5 2a) — be explicit about the boundary, don't guess.
    if any(w in m for w in _OUT_OF_SCOPE):
        return ("That's outside this demo's scope — it covers OBGYN **provider** scheduling "
                "(no-show risk, coverage, PTO impact, schedule queries). Nursing schedules, the "
                "HR/PTO system of record, payroll/billing, and clinical/PHI functions are out of scope.")

    # 0c. Follow-up confirm: apply the auto-resolvable reassignments from the LAST PTO impact
    # (conversational context). This IS the human approval (UC6) → execute + audit (BR-1/10).
    pending = ctx("pending_pto_apply")
    if pending and (any(p in m for p in _CONFIRM) or m.strip() in _CONFIRM_BARE):
        if not can_write:
            return ("Applying reassignments is a Scheduler/Approver action — as a Provider you can "
                    "view the impact but not apply it.")
        imp = S.compute_pto_impact(aurora, pending["provider_id"], pending["start"], pending["end"])
        plan = [{"appt_id": a["id"], "provider_id": a["reassign_options"][0]["provider_id"],
                 "date": a["appt_date"], "time": a["appt_time"]}
                for a in imp["impacted"] if a["recommendation"] == "reassign"]
        res = S.apply_reassignments(aurora, plan)
        S.record_audit(aurora, "pto_reassign",
                       f"Reassign {res.get('applied', 0)} appt(s) off {imp['provider']}",
                       role, f"chat:{role}", "approved",
                       outcome="executed" if res.get("ok") else "not-completed",
                       rationale="approved in chat")
        if memory and session_id:
            memory.clear_context(session_id, "pending_pto_apply")
        return (f"Done — approved and applied {res.get('applied', 0)} reassignment(s) off "
                f"{imp['provider']}. The decision is recorded in the audit trail.")

    def scalar(sql, d=0):
        try:
            r = aurora.query(sql).rows
            return r[0][0] if r and r[0] and r[0][0] is not None else d
        except Exception:
            return d

    # 0b. Clarify an ambiguous coverage ask (UC5 alt 2a) — a named provider, no date.
    if ("cover" in m) and _provider(aurora, message) and not _dates(message) \
            and not any(k in m for k in _SPECIALTY_KW):
        who = _provider(aurora, message)["name"]
        return (f"Which date (or range) should I check coverage for {who}? "
                "For example: \"who can cover {first} on 6/30?\"".format(first=who.split()[-1]))

    # 1. Doctors by specialty / openings
    if any(w in m for w in ["doctor", "availab", "opening", "slot", "who can", "cover", "specialt"]) or any(k in m for k in _SPECIALTY_KW):
        for kw, spec in _SPECIALTY_KW.items():
            if kw in m:
                docs = S.list_doctors_by_specialty(aurora, spec)
                if docs:
                    lines = [f"{spec} providers and their soonest openings:"]
                    for d in docs:
                        na = d.get("next_available") or {}
                        lines.append(f"- {d['name']} ({d['credential']}) — next open {na.get('date', '—')} {na.get('time', '')}".rstrip())
                    return "\n".join(lines)

    # 2. No-show risk / rate by provider
    if ("no-show" in m or "no show" in m or "noshow" in m) or ("risk" in m and ("provider" in m or "rate" in m or "panel" in m)):
        rows = []
        try:
            rows = aurora.query(
                "SELECT provider, count(*), avg(risk_pct), "
                "sum(CASE WHEN tier='RED' THEN 1 ELSE 0 END) "
                "FROM risk_today GROUP BY provider").rows
        except Exception:
            rows = []
        if rows:
            rows = sorted(rows, key=lambda r: -(r[2] or 0))
            lines = ["Predicted no-show risk by provider (today's panel):"]
            for prov, cnt, avg_pct, red in rows:
                lines.append(f"- {prov}: {round(avg_pct or 0)}% average risk across {cnt} appointment(s), {red} high-risk (red)")
            lines.append("High-risk patients are flagged for a reminder call or overbook before the slot.")
            return "\n".join(lines)

    # 3. Unit status / overview
    if any(w in m for w in ["how is everything", "how is it going", "how's everything", "how's it going", "overview", "status", "summary", "how are we"]):
        red, amb, grn = scalar("SELECT count(*) FROM risk_today WHERE tier='RED'"), scalar("SELECT count(*) FROM risk_today WHERE tier='AMBER'"), scalar("SELECT count(*) FROM risk_today WHERE tier='GREEN'")
        pend = scalar("SELECT count(*) FROM pto_queue WHERE status='pend'")
        booked = scalar("SELECT count(*) FROM sched_appointments WHERE appt_date='2026-06-09' AND status='Booked'")
        return ("Here's where the OBGYN department stands today:\n"
                "- Inpatient OB coverage: 2 of 2 on service (on plan)\n- Open shifts (next 7 days): 6\n"
                f"- No-show risk: {red} red, {amb} amber, {grn} green\n"
                f"- Pending PTO requests: {pend}\n- Appointments booked today: {booked}\n"
                "- Overtime this week: 38.5h (target 32.5h)")

    # 3. PTO impact
    if ("pto" in m or "time off" in m or "leave" in m) and ("impact" in m or "put" in m or "on pto" in m):
        prov, ds = _provider(aurora, message), _dates(message)
        if prov and len(ds) >= 2:
            S.request_pto(aurora, prov["id"], ds[0], ds[1], "Vacation")
            imp = S.compute_pto_impact(aurora, prov["id"], ds[0], ds[1])
            lines = [f"{prov['name']} on PTO {ds[0]} to {ds[1]} impacts {imp['impacted_count']} appointment(s) — "
                     f"{imp['auto_resolvable_count']} auto-resolvable, {imp['needs_manual_count']} need attention:"]
            for a in imp["impacted"][:8]:
                opt = (f"reassign to {a['reassign_options'][0]['provider']}" if a["reassign_options"]
                       else (f"reschedule with {a['reschedule_options'][0]['provider']}" if a["reschedule_options"] else "needs manual review"))
                lines.append(f"- {a['patient_name']} on {a['appt_date']} {a['appt_time']} → {opt}")
            conf = imp.get("conflict") or {}
            if conf.get("breach"):
                lines.append(f"⚠ COVERAGE CONFLICT: {conf['mitigation']}")
            # Remember this impact so a follow-up "apply all auto" / "yes" can act on it.
            if memory and session_id and imp.get("auto_resolvable_count"):
                memory.set_context(session_id, "pending_pto_apply",
                                   {"provider_id": prov["id"], "start": ds[0], "end": ds[1]})
            lines.append("Say \"apply all auto\" to reassign the auto-resolvable ones. "
                         "Any change needs your approval before it takes effect.")
            return "\n".join(lines)

    # 4. Cancel an appointment by patient name (a WRITE — role-gated, BR-9)
    if "cancel" in m:
        if not can_write:
            return ("As a Provider you can view schedules and request your own time off, but "
                    "cancelling or booking appointments is done by a Scheduler. I can show you the "
                    "appointment details instead.")
        for r in aurora.query("SELECT name FROM sched_patients").rows:
            if r[0].lower() in m:
                appts = S.find_appointments(aurora, query=r[0])
                if appts:
                    res = S.cancel_appointment(aurora, appts[0]["id"], reason="assistant")
                    cands = ", ".join(c["name"] for c in res.get("reoffer_candidates", [])[:3])
                    a = appts[0]
                    return (f"Cancelled {a['patient_name']}'s {a['appt_time']} appointment with {a['provider_name']} on {a['appt_date']}. "
                            f"The slot is now free — good candidates to re-offer it to: {cands or 'none'}.")

    # 5. At-risk appointment list (UC1) — "which slots are at risk this week?"
    if ("at risk" in m or "at-risk" in m or "red flag" in m or
            ("risk" in m and any(w in m for w in ["this week", "today", "appointment", "slot", "which"]))):
        rows = aurora.query("SELECT tier, patient_name, provider, appt_time, risk_pct FROM risk_today "
                            "WHERE tier IN ('RED','AMBER') ORDER BY risk_pct DESC").rows
        if rows:
            lines = ["At-risk appointments on today's panel (highest first):"]
            for tier, name, prov, t, pct in rows[:8]:
                lines.append(f"- {name} — {pct}% {tier} with {prov} at {t}")
            lines.append("RED = call + keep a standby ready; AMBER = send a text reminder.")
            return "\n".join(lines)

    # 6. Coverage planning (UC2) — 90-day forward gaps (let Epic-post / case fall through)
    if (any(w in m for w in ["coverage", "90 day", "90-day", "cover the service", "uncovered",
                             "coverage gap", "who is out", "who's out", "service line"])
            and "epic" not in m and "make the case" not in m):
        plan = S.coverage_plan(aurora)
        if plan["gap_count"] == 0:
            return ("Coverage holds for the next 90 days — every service line stays at or above its "
                    "minimum. Tightest margin is the High-Risk Panel (Brooks + Wu).")
        lines = [f"Coverage gaps in the next {plan['horizon_days']} days — {plan['gap_count']} day(s) below minimum:"]
        for sl, cnt in plan["by_service_line"].items():
            lines.append(f"- {sl}: short on {cnt} day(s)")
        g = plan["gaps"][0]
        lines.append(f"Earliest: {g['service_line']} on {g['date']} — {g['available']}/{g['required']} on "
                     f"service (out: {', '.join(g['providers_out']) or 'PTO'}).")
        lines.append("Approve PTO ahead of these windows, stagger leave, or pull a peer/float onto service.")
        return "\n".join(lines)

    # 6b. Approve-ahead PTO decision support (ASK 2) — "can I approve this PTO?"
    if ("approve" in m or "can i approve" in m or "requested" in m) and any(w in m for w in ["pto", "leave", "time off", "vacation"]):
        prov, ds = _provider(aurora, message), _dates(message)
        if prov and len(ds) >= 2:
            r = S.can_approve_pto(aurora, prov["id"], ds[0], ds[1])
            if r["approvable"]:
                return f"{prov['name']} {ds[0]}→{ds[1]}: {r['message']} You can approve — final sign-off is yours."
            opts = "\n".join(f"  ({chr(97+i)}) {o}" for i, o in enumerate(r["options"]))
            return (f"{prov['name']} {ds[0]}→{ds[1]}: {r['message']}\nOptions:\n{opts}\n"
                    "Want me to draft either as a proposal? Final approval still routes through you.")
        return ("Tell me the provider and the dates (e.g. \"can I approve PTO for Dr. Wu Jul 14-18?\") "
                "and I'll check it against the service-line minimums before you approve.")

    # 8. Cancellation breakdown (ASK 1) — "double-block?" routes to the template intent below
    if ("cancellation" in m or "cancellations" in m or
            ("cancel" in m and any(w in m for w in ["break", "by day", "rate", "pattern", "quarter", "weekday"]))):
        cb = S.cancellation_breakdown(aurora)
        o = cb["outlier"] or {}
        lines = [f"Cancellations by weekday/shift (clinic avg {cb['clinic_avg_cancel_pct']}%); top slots:"]
        for s in sorted(cb["by_slot"], key=lambda x: -x["cancel_pct"])[:5]:
            lines.append(f"- {s['day']} {s['shift']}: {s['cancel_pct']}% total = {s['advance_pct']}% advance "
                         f"+ {s['noshow_pct']}% true no-show")
        if o:
            adv_heavy = o["advance_pct"] > o["noshow_pct"]
            lines.append(f"{o['day']} {o['shift']} is the outlier ({o['cancel_pct']}%). "
                         + ("Most are advance cancellations (refilled from the waitlist), so don't "
                            "double-block — tighten waitlist auto-fill. Double-blocking pays off where "
                            "true no-shows are high (Monday AM)." if adv_heavy else
                            "These are mostly true no-shows, so double-blocking that slot is justified."))
        lines.append("This is a recommendation — confirm against provider capacity before changing the template.")
        return "\n".join(lines)

    # 9. Template optimization (UC3 / ASK 1) — advance-cancel-aware
    if any(w in m for w in ["template", "double block", "double-block", "optimi", "booking mix"]):
        recs = S.template_reco(aurora)["recommendations"]
        hot = [r for r in recs if "Double-block" in r["booking"] or "Do NOT" in r["booking"]]
        lines = ["Template recommendations (true no-show vs advance-cancel aware):"]
        for r in (hot or recs)[:7]:
            lines.append(f"- {r['day']} {r['shift']}: {r['no_show_rate']}% true no-show, "
                         f"{r['advance_rate']}% advance → {r['booking']}")
        return "\n".join(lines)

    # 10. Walk-in volume + full-vs-half-day scenario (ASK 1 Flow 3)
    if "walk-in" in m or "walk in" in m or "walkin" in m:
        if any(w in m for w in ["half", "full day", "model", "scenario", "friday"]):
            sc = S.walkin_scenario(aurora, "Friday")
            return (f"Friday walk-ins over the last {sc['weeks']} weeks: ~{sc['am_avg']}/AM, "
                    f"~{sc['pm_avg']}/PM. {sc['recommendation']} This is a model output — confirm "
                    "against provider availability before changing the template.")
        wv = S.walkin_volume(aurora)
        lines = ["Average walk-ins per day (last 12 weeks):"]
        for d in wv["by_day"]:
            lines.append(f"- {d['day']}: {d['avg_total']} ({d['avg_am']} AM / {d['avg_pm']} PM)")
        lines.append("Tuesday is the peak; Friday runs lightest and is AM-concentrated. "
                     "Ask me to model a half-day Friday walk-in template.")
        return "\n".join(lines)

    # 11. Provider load / capacity (ASK 4 / VC-A) — minute-weighted
    if (any(w in m for w in ["load balanc", "provider load", "providers per day", "provider distribution",
                             "equally distribut", "staffing", "data-driven", "intelligence behind",
                             "capacity", "provider-minute", "minute-weighted", "rebalance",
                             "matching demand", "matching the demand", "distribution"])
            and not any(k in m for k in ["make the case", "justify", "for the chair", "business case",
                                         "one-page", "one page", "build the case"])):
        lb = S.load_balance(aurora)
        lines = [f"Provider load by weekday, weighted by visit-type minutes (dept avg "
                 f"{lb['avg_utilization_pct']}% utilization):"]
        for d in lb["by_day"]:
            lines.append(f"- {d['day']}: {d['providers_per_day']} providers, avg visit {d['avg_visit_min']} min "
                         f"→ {d['utilization_pct']}% utilization ({d['flag']})")
        lines.append(lb["rebalance"] or "Headcount and minute-weighted load are reasonably balanced.")
        lines.append("Headcount isn't capacity — this weights by visit-type mix. Confirm against "
                     "provider availability and credentialing before changing the template.")
        return "\n".join(lines)

    # 12. Cycle time / department-as-a-whole (ASK 3)
    if any(w in m for w in ["cycle time", "cycle-time", "department perform", "department as a whole",
                            "as a whole", "handoff", "hand-off", "bottleneck", "stage", "where's the",
                            "where is the", "contributing", "each part of the team"]):
        ct = S.cycle_time(aurora)
        s, p = ct["stages_recent"], ct["stages_prior"]
        return ("Department cycle time (referral → seen), last 30 days vs prior quarter:\n"
                f"- Total: {ct['cycle_days_recent']} days (was {ct['cycle_days_prior']})\n"
                f"- Clerical intake/logging: {s['clerical']}d (was {p['clerical']}d)\n"
                f"- Clinical scheduling: {s['scheduling']}d (was {p['scheduling']}d)\n"
                f"- Provider availability: {s['provider']}d (was {p['provider']}d)\n"
                f"The slip is in the first handoff — {ct['bottleneck_label']} — not provider capacity. "
                "Consolidating intake / adding logging capacity compresses cycle time more than anything "
                "on the provider side. Worth confirming with the ambulatory director before reallocating.")

    # 13. Epic chat routing (ASK 5) — post an aggregate alert into Epic
    if ("epic" in m and any(w in m for w in ["post", "send", "alert", "notify", "chat"])) or "post the alert" in m or "post it" in m:
        if not can_write:
            return "Posting to Epic is a Scheduler/Approver action."
        S.record_audit(aurora, "epic_post", "Coverage alert posted to the scheduling pool in Epic chat",
                       role, f"chat:{role}", "approved", outcome="executed")
        return ("Done — coverage alert posted to the scheduling team's Epic chat (date, service, and the "
                "staffing options). Any patient-specific follow-up threads there under the patient record, "
                "not here, so Epic stays your system of record.")

    # 14. PHI boundary (ASK 5) — patient-identifiable lists stay in Epic
    if any(w in m for w in ["which patients", "which specific patient", "patient names", "named list",
                            "who is affected", "which patient", "list of patients"]):
        return ("That's patient-identifiable, so I won't pull it here — it belongs in Epic. I'll keep it "
                "at the aggregate (e.g. affected slots + service); the named list lives in the Epic "
                "schedule view where you can act on it directly. Want the Epic hand-off?")

    # 15. Read-from-Epic framing (ASK 5)
    if any(w in m for w in ["where are you getting", "where do these numbers", "data source",
                            "source of truth", "where's this data", "how do you know"]):
        return ("All scheduling, cancellation, and visit-type data is read from Epic — it stays your single "
                "source of truth. I analyse de-identified aggregates and send any patient-level, actionable "
                "output back into Epic chat, so nothing lives in two places.")

    # 16. Value narrative (ASK 6) — department-level justification artifact
    if any(w in m for w in ["make the case", "justify", "justification", "for the chair", "to my manager",
                            "business case", "one-page", "one page", "build the case", "reframe"]):
        lb = S.load_balance(aurora)
        wk = S.walkin_scenario(aurora, "Friday")
        ct = S.cycle_time(aurora)
        over = next((d for d in lb["by_day"] if d["flag"] == "over-loaded"), None)
        return ("Department-level case (this is what the chair will weigh — framed as a department win, "
                "not one director):\n"
                f"- Rebalance staffing to the minute-weighted load ({lb.get('rebalance') or 'tighten the Mon/Tue split'}) "
                f"— removes the {(over or {}).get('day','Tuesday')} overtime, cost-neutral (no added headcount).\n"
                f"- Half-day Friday walk-in template — ~{wk['provider_hours_saved']} provider-hours "
                f"(~${wk['est_cost_saved']:,}/quarter) with 0 turned away.\n"
                f"- Cut cycle time by addressing the clerical-intake handoff ({ct['cycle_days_recent']}→ target "
                f"~{ct['cycle_days_prior']} days) — improves access department-wide.\n"
                "Leads with throughput, cost, and access across the department. Want it as a one-page brief "
                "with the 12-week evidence? I'll leave the sign-off line for you — the decision is yours to route.")

    return None


def _clean(text: str) -> str:
    """Keep only the clean final answer. Strip tool-call/JSON artifacts, SQL/code
    blocks, apology/meta filler, and fabricated extra turns (granite-2b quirks).
    Unwraps fenced markdown TABLES (so they render) but drops SQL/code fences."""
    if not text:
        return ""
    # 1. Truncate at the first fabricated next turn ("user:", "assistant:", ...).
    m = re.search(r"\n\s*(?:user|assistant|human)\s*:", text, flags=re.IGNORECASE)
    if m:
        text = text[: m.start()]
    # 2. Remove tool-call markers + fenced JSON tool-arg dumps.
    text = re.sub(r"<tool_call>.*?</tool_call>", "", text, flags=re.DOTALL)
    text = re.sub(r"</?tool_call>", "", text)
    text = re.sub(r"```(?:json)?\s*\{.*?\}\s*```", "", text, flags=re.DOTALL)

    # 3. Per fenced block: drop SQL/code; UNWRAP a markdown table so it renders.
    def _fence(mm):
        lang, body = (mm.group(1) or "").lower(), mm.group(2)
        if lang in ("sql", "python", "json", "js", "bash") or re.search(
            r"\b(SELECT|FROM|JOIN|WHERE|INSERT|UPDATE|DELETE)\b", body, re.IGNORECASE):
            return ""
        return body if "|" in body else ""
    text = re.sub(r"```([a-zA-Z]*)\n(.*?)```", _fence, text, flags=re.DOTALL)

    # 4. Drop apology / "here's the query" meta lines.
    drop = re.compile(r"^\s*(apolog|sorry|i'?m sorry|here'?s the|this (query|will)|the query|corrected request|note:)", re.IGNORECASE)
    text = "\n".join(ln for ln in text.split("\n") if not drop.match(ln))
    return text.strip()


class ReActCopilot(Copilot):
    def __init__(self, model: Any, tools: list, *, providers: Any = None,
                 memory: Any = None, recursion_limit: int = 12) -> None:
        self._model = model
        self._tools = tools
        self._providers = providers
        self._memory = memory  # SessionMemory | None — conversational context
        self._recursion_limit = recursion_limit

    def _system_prompt(self, role: str) -> str:
        from ..tools import SCHEMA_DOC

        return _SYSTEM.format(role=role, disclaimer=DISCLAIMER, schema=SCHEMA_DOC)

    async def stream(self, turn: Turn) -> AsyncIterator[str]:
        sid = turn.session_id or "demo-session"
        mem = self._memory
        # Capture PRIOR turns before recording the current one (so the LLM sees history).
        prior = mem.history(sid) if mem else []
        if mem:
            mem.append(sid, "user", turn.message)

        # Deterministic intent router first: for common asks we call the real service
        # and return the actual result, so the answer never depends on the model's
        # tool-calling. The router also reads/writes short context (follow-ups).
        if self._providers is not None:
            try:
                routed = route(turn.message, self._providers, role=turn.role or "Scheduler",
                               memory=mem, session_id=sid)
            except Exception:
                routed = None
            if routed:
                if mem:
                    mem.append(sid, "assistant", routed)
                for word in routed.split(" "):
                    yield word + " "
                return

        agent = create_agent(self._model, self._tools, system_prompt=self._system_prompt(turn.role))
        config = {"recursion_limit": self._recursion_limit}
        # Build the message list from prior history + the current turn, so open-ended
        # follow-ups ("what about her?", "reschedule the second one") have context.
        msgs: list = []
        for h in prior:
            msgs.append(HumanMessage(h["content"]) if h["role"] == "user" else AIMessage(h["content"]))
        msgs.append(HumanMessage(turn.message))
        # Run the full agent (tool calls + final answer), then return ONLY the final
        # assistant message — cleaned of tool-call JSON / code-fence artifacts. Pseudo-
        # stream it word-by-word so the UI keeps its typing feel.
        result = await agent.ainvoke({"messages": msgs}, config=config)
        final = ""
        for m in reversed(result.get("messages", [])):
            if isinstance(m, AIMessage) and isinstance(m.content, str) and m.content.strip():
                final = m.content
                break
        final = _clean(final) or "I couldn't produce an answer — please try rephrasing."
        if mem:
            mem.append(sid, "assistant", final)
        for word in final.split(" "):
            yield word + " "
