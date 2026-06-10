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
- For status/overview questions (e.g. "how is everything"), call `unit_status` and
  present the result as a **markdown table**. Prefer markdown tables whenever you
  return multiple rows of structured data (doctors, impacted appointments, etc.).
- Answer ONLY the user's current question, using real values from tools. Do NOT
  invent example data, JSON, or extra "user:"/"assistant:" turns. Stop after your answer.

{schema}
"""


def _clean(text: str) -> str:
    """Keep only the first clean answer; strip tool-call/JSON/fence artifacts that
    small models leak (granite sometimes role-plays extra user/assistant turns)."""
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
    text = re.sub(r'^\s*\{["a-zA-Z].*?\}\s*$', "", text, flags=re.DOTALL | re.MULTILINE)
    # 3. Unwrap a single surrounding code fence so a markdown table renders as a table.
    text = text.strip()
    fenced = re.match(r"^```[a-zA-Z]*\s*\n(.*)\n```$", text, flags=re.DOTALL)
    if fenced:
        text = fenced.group(1)
    return text.strip()


class ReActCopilot(Copilot):
    def __init__(self, model: Any, tools: list, *, recursion_limit: int = 12) -> None:
        self._model = model
        self._tools = tools
        self._recursion_limit = recursion_limit

    def _system_prompt(self, role: str) -> str:
        from ..tools import SCHEMA_DOC

        return _SYSTEM.format(role=role, disclaimer=DISCLAIMER, schema=SCHEMA_DOC)

    async def stream(self, turn: Turn) -> AsyncIterator[str]:
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
