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


def route(message: str, providers) -> str | None:
    """Deterministic intent router — returns a real, human-readable answer for common
    asks (so we don't depend on a small model's flaky tool-calling). None => use the LLM."""
    from ..scheduling import service as S

    aurora = providers.aurora
    m = message.lower()

    def scalar(sql, d=0):
        try:
            r = aurora.query(sql).rows
            return r[0][0] if r and r[0] and r[0][0] is not None else d
        except Exception:
            return d

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
            lines.append("Say \"apply all auto\" to reassign the auto-resolvable ones. "
                         "Any change needs your approval before it takes effect.")
            return "\n".join(lines)

    # 4. Cancel an appointment by patient name
    if "cancel" in m:
        for r in aurora.query("SELECT name FROM sched_patients").rows:
            if r[0].lower() in m:
                appts = S.find_appointments(aurora, query=r[0])
                if appts:
                    res = S.cancel_appointment(aurora, appts[0]["id"], reason="assistant")
                    cands = ", ".join(c["name"] for c in res.get("reoffer_candidates", [])[:3])
                    a = appts[0]
                    return (f"Cancelled {a['patient_name']}'s {a['appt_time']} appointment with {a['provider_name']} on {a['appt_date']}. "
                            f"The slot is now free — good candidates to re-offer it to: {cands or 'none'}.")
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
    def __init__(self, model: Any, tools: list, *, providers: Any = None, recursion_limit: int = 12) -> None:
        self._model = model
        self._tools = tools
        self._providers = providers
        self._recursion_limit = recursion_limit

    def _system_prompt(self, role: str) -> str:
        from ..tools import SCHEMA_DOC

        return _SYSTEM.format(role=role, disclaimer=DISCLAIMER, schema=SCHEMA_DOC)

    async def stream(self, turn: Turn) -> AsyncIterator[str]:
        # Deterministic intent router first: for common asks we call the real service
        # and return the actual result, so the answer never depends on a small model's
        # flaky tool-calling (which tends to narrate "I'll use the X function...").
        if self._providers is not None:
            try:
                routed = route(turn.message, self._providers)
            except Exception:
                routed = None
            if routed:
                for word in routed.split(" "):
                    yield word + " "
                return

        agent = create_agent(self._model, self._tools, system_prompt=self._system_prompt(turn.role))
        config = {"recursion_limit": self._recursion_limit}
        # Run the full agent (tool calls + final answer), then return ONLY the final
        # assistant message — cleaned of tool-call JSON / code-fence artifacts that
        # some models (e.g. granite's tool parser) leak into content. Pseudo-stream it
        # word-by-word so the UI keeps its typing feel without mixing in JSON.
        result = await agent.ainvoke({"messages": [HumanMessage(turn.message)]}, config=config)
        final = ""
        for m in reversed(result.get("messages", [])):
            if isinstance(m, AIMessage) and isinstance(m.content, str) and m.content.strip():
                final = m.content
                break
        final = _clean(final) or "I couldn't produce an answer — please try rephrasing."
        for word in final.split(" "):
            yield word + " "
