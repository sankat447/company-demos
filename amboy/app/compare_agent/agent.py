"""LangGraph compare-agent. Talks to the LLM ONLY via Portkey; narrates verified
numbers only. Falls back to a deterministic summary if egress isn't configured or
the LLM/graph errors — so the demo always produces a grounded result.
"""
from __future__ import annotations

import json

from app.common import config
from . import grounding
from . import tools as T

SYSTEM_PROMPT = (
    "You are a bank credit-risk analyst assistant preparing an EXECUTIVE comparison "
    "of two annual investment/credit reports.\n\n"
    "ABSOLUTE RULES:\n"
    "1. You may ONLY state numeric figures that appear in tool outputs. NEVER compute, "
    "derive, estimate, or invent a number. If you need a figure, call a tool.\n"
    "2. People and accounts appear as opaque tokens like [PERSON:1a2b] or [US_SSN:9f3c]. "
    "They are de-identified. NEVER guess or infer a real identity, name, SSN, phone, "
    "email, or address.\n"
    "3. Use get_metrics for the year-over-year comparison, flag_policy for risk flags, "
    "compute_scenario for rate-shock sensitivity, retrieve for supporting de-identified notes.\n"
    "4. Any recommendation MUST begin with 'DRAFT — requires human sign-off:'.\n"
    "5. Be concise and executive: headline change first, then key risk flags, then "
    "scenario sensitivity. Cite metric names."
)


def _portkey_headers() -> dict:
    import os
    h = {}
    if os.environ.get("AMBOY_PORTKEY_PROVIDER"):
        h["x-portkey-provider"] = os.environ["AMBOY_PORTKEY_PROVIDER"]
    if os.environ.get("AMBOY_PORTKEY_VIRTUAL_KEY"):
        h["x-portkey-virtual-key"] = os.environ["AMBOY_PORTKEY_VIRTUAL_KEY"]
    return h


def _run_langgraph(task: str):
    """Genuine LangGraph ReAct agent over Portkey. Returns (narrative, tool_outputs)."""
    from langchain_core.tools import tool
    from langchain_openai import ChatOpenAI
    from langgraph.prebuilt import create_react_agent

    @tool
    def get_metrics(report_id_a: str, report_id_b: str, year_a: int, year_b: int) -> dict:
        """Verified year-over-year comparison of portfolio metrics."""
        return T.get_metrics(report_id_a, report_id_b, year_a, year_b)

    @tool
    def flag_policy(report_id: str) -> dict:
        """Deterministic policy risk flags for one report."""
        return T.flag_policy(report_id)

    @tool
    def compute_scenario(report_id: str, shock_bps: int = 200) -> dict:
        """Rate-shock sensitivity (illustrative, not a forecast)."""
        return T.compute_scenario(report_id, shock_bps)

    @tool
    def retrieve(query: str, report_id: str = None, k: int = 5) -> dict:
        """Similarity search over DE-IDENTIFIED report notes (tokens only)."""
        return T.retrieve(query, report_id, k)

    model = ChatOpenAI(model=config.LLM_MODEL, base_url=config.PORTKEY_BASE_URL,
                       api_key=config.PORTKEY_API_KEY or "portkey", temperature=0,
                       default_headers=_portkey_headers())
    agent = create_react_agent(model, [get_metrics, flag_policy, compute_scenario, retrieve],
                               state_modifier=SYSTEM_PROMPT)
    result = agent.invoke({"messages": [("user", task)]})
    msgs = result["messages"]
    tool_outputs = []
    for m in msgs:
        if getattr(m, "type", None) == "tool":
            try:
                tool_outputs.append(json.loads(m.content))
            except Exception:
                tool_outputs.append({"raw": str(m.content)})
    return msgs[-1].content, tool_outputs


def deterministic_summary(report_id_a, report_id_b, year_a, year_b, shock_bps=200):
    """LLM-free narrative built straight from verified tool outputs (always grounded)."""
    cmp = T.get_metrics(report_id_a, report_id_b, year_a, year_b)
    flags = T.flag_policy(report_id_b)
    scen = T.compute_scenario(report_id_b, shock_bps)
    by = {r["metric"]: r for r in cmp["comparison"]}
    lines = [f"Executive comparison — {report_id_a} vs {report_id_b}:"]
    for m in ("npa_ratio_pct", "net_charge_off_rate_pct", "tier1_capital_ratio_pct",
              "total_loans_usd", "net_income_usd"):
        if m in by:
            r = by[m]
            lines.append(f"- {m}: {r[f'y{year_a}']} -> {r[f'y{year_b}']} "
                         f"({r['pct_change']}%, {r['direction']})")
    if flags["flags"]:
        lines.append("Risk flags (" + report_id_b + "): "
                     + "; ".join(f"{f['code']} ({f['value']} vs {f['threshold']})"
                                 for f in flags["flags"]))
    else:
        lines.append(f"Risk flags ({report_id_b}): none breached.")
    lines.append(f"Rate-shock sensitivity (+{shock_bps}bps): earnings-at-risk "
                 f"${scen['earnings_at_risk_usd']:,.0f}; NPA {scen['current_npa_ratio_pct']}% -> "
                 f"{scen['stressed_npa_ratio_pct']}% (illustrative).")
    lines.append("DRAFT — requires human sign-off: review the flags above before any action.")
    return "\n".join(lines), [cmp, flags, scen]


def run_agent(report_id_a, report_id_b, year_a, year_b, question=None, shock_bps=200) -> dict:
    task = (f"Compare {report_id_a} (FY{year_a}) against {report_id_b} (FY{year_b}). "
            f"Summarize the year-over-year change, list policy risk flags for {report_id_b}, "
            f"and give the +{shock_bps}bps rate-shock sensitivity. {question or ''}")
    mode = "llm"
    try:
        narrative, tool_outputs = _run_langgraph(task)
        if not tool_outputs:                       # model answered without tools — distrust it
            raise RuntimeError("model produced no tool calls")
    except Exception as e:
        mode = "fallback"
        narrative, tool_outputs = deterministic_summary(
            report_id_a, report_id_b, year_a, year_b, shock_bps)
        narrative = f"[deterministic fallback: {type(e).__name__}]\n" + narrative

    verdict = grounding.check(narrative, tool_outputs)
    return {"draft_summary": narrative, "mode": mode, "grounding": verdict,
            "tool_outputs": tool_outputs}
