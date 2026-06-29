"""Echo copilot — scaffold-phase stand-in for the real LangChain agent.

No external dependencies. Streams a role-aware canned plan so the end-to-end
streaming path (frontend → API → copilot) can be verified before any cluster
service is wired.
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from .base import Copilot, Turn

# Role-aware greeting prefix (DR-01). The real agent will put this in its system prompt.
_GREETING = {
    "Scheduler": "As your scheduling copilot,",
    "HR/Ops": "As your HR & operations copilot,",
    "Provider": "As your provider copilot,",
}


class EchoCopilot(Copilot):
    """Streams a deterministic, role-aware echo. Useful for tests and demos-without-cluster."""

    def __init__(self, token_delay_s: float = 0.0) -> None:
        self._delay = token_delay_s

    async def stream(self, turn: Turn) -> AsyncIterator[str]:
        greeting = _GREETING.get(turn.role, "As your copilot,")
        reply = (
            f"{greeting} I received your question: “{turn.message}”. "
            "[echo mode — real reasoning via Portkey → vLLM is wired in a later step.]"
        )
        for word in reply.split(" "):
            if self._delay:
                await asyncio.sleep(self._delay)
            yield word + " "
