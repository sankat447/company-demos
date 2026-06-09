"""Stable copilot interface.

The API layer depends only on this Protocol, so swapping EchoCopilot for the real
LangChain ReAct copilot is a one-line change in app wiring.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import AsyncIterator, Protocol, runtime_checkable


@dataclass
class Turn:
    """One copilot invocation."""

    message: str
    role: str = "Scheduler"  # DR-01 active role context
    session_id: str = "demo-session"
    # Citations / tool-trace get attached as the real agent runs; empty in echo.
    citations: list[dict] = field(default_factory=list)


@runtime_checkable
class Copilot(Protocol):
    """A copilot streams answer tokens for a Turn."""

    async def stream(self, turn: Turn) -> AsyncIterator[str]:
        """Yield answer text incrementally (tokens or chunks)."""
        ...
