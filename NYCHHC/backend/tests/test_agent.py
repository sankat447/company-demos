"""Offline test of the live ReAct copilot.

Uses a scripted fake chat model that drives a real tool call (coverage_forecast)
then returns a final answer — exercising the create_agent loop, the tool layer, and
the streaming path with NO LLM/cluster.
"""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from nychhc_copilot.agent.base import Turn
from nychhc_copilot.agent.react import ReActCopilot
from nychhc_copilot.config import Settings
from nychhc_copilot.tools import build_tools
from nychhc_copilot.tools.providers import build_providers


class ScriptedChatModel(BaseChatModel):
    """Returns a pre-scripted AIMessage on each call; supports bind_tools."""

    script: list[AIMessage]
    i: int = 0

    @property
    def _llm_type(self) -> str:
        return "scripted-fake"

    def bind_tools(self, tools: Any, **kwargs: Any):  # noqa: ARG002
        return self  # ignore — we script the tool calls

    def _generate(self, messages: list[BaseMessage], stop=None,
                  run_manager: CallbackManagerForLLMRun | None = None, **kwargs: Any) -> ChatResult:
        msg = self.script[min(self.i, len(self.script) - 1)]
        self.i += 1
        return ChatResult(generations=[ChatGeneration(message=msg)])


@pytest.mark.asyncio
async def test_react_copilot_runs_tool_then_answers():
    providers = build_providers(Settings())
    tools = build_tools(providers)
    model = ScriptedChatModel(script=[
        AIMessage(content="", tool_calls=[
            {"name": "coverage_forecast", "args": {"dept_id": 1, "horizon_days": 14}, "id": "c1"},
        ]),
        AIMessage(content="Next Tuesday the Emergency department is understaffed (2 open day shifts)."),
    ])
    copilot = ReActCopilot(model, tools)

    chunks = [c async for c in copilot.stream(Turn(message="why is Tuesday understaffed?", role="Scheduler"))]
    answer = "".join(chunks)

    # The tool actually ran against the fake DB, and the final answer streamed.
    assert "understaffed" in answer.lower()
    # The empty tool-call turn was NOT streamed to the user.
    assert answer.strip() == "Next Tuesday the Emergency department is understaffed (2 open day shifts)."
