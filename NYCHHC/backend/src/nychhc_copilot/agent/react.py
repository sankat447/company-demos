"""Live copilot — LangChain ReAct agent (diagram: LangChain function-calling).

Implements the same `Copilot` interface as `EchoCopilot`, so the API layer is
unchanged. The model is whatever Portkey routes to (vLLM primary, Bedrock fallback);
tools are the workforce tool surface. Streams the assistant's answer tokens.
"""

from __future__ import annotations

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

{schema}
"""


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
        async for msg, _meta in agent.astream(
            {"messages": [HumanMessage(turn.message)]},
            stream_mode="messages",
            config=config,
        ):
            # Stream only assistant text. Skip tool-call turns (empty content) and
            # ToolMessages (which are not AIMessage instances).
            if isinstance(msg, AIMessage) and isinstance(msg.content, str) and msg.content:
                yield msg.content
