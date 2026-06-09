"""Copilot agent implementations.

`Copilot` is the stable interface the API depends on. `EchoCopilot` satisfies it
with zero external deps (scaffold phase). A LangChain ReAct copilot will implement
the same interface in the agent-wiring step, so routes never change.
"""

from .base import Copilot, Turn
from .echo import EchoCopilot

__all__ = ["Copilot", "Turn", "EchoCopilot"]
