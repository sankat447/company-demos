"""Copilot agent implementations.

`Copilot` is the stable interface the API depends on. `EchoCopilot` satisfies it
with zero external deps (scaffold phase). A LangChain ReAct copilot will implement
the same interface in the agent-wiring step, so routes never change.
"""

from .base import Copilot, Turn
from .echo import EchoCopilot
from .memory import SessionMemory

__all__ = ["Copilot", "Turn", "EchoCopilot", "SessionMemory", "build_react_copilot"]


def build_react_copilot(settings, memory=None, providers=None):
    """Construct the live LangChain ReAct copilot (Portkey model + workforce tools).

    Imported lazily (heavy langchain deps) so echo mode never pays for it. `memory`
    gives the copilot per-session conversational context; `providers` lets the caller
    share the app's provider bundle (so chat + the data API hit the same store).
    """
    from ..llm import build_chat_model_with_fallback
    from ..scheduling import ensure_seeded
    from ..tools import build_providers, build_tools
    from .react import ReActCopilot

    model = build_chat_model_with_fallback(settings)
    if providers is None:
        providers = build_providers(settings)
    try:
        ensure_seeded(providers.aurora)  # scheduling tools need sched_* present
    except Exception:
        pass
    tools = build_tools(providers)
    return ReActCopilot(model, tools, providers=providers, memory=memory)
