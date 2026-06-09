"""Provider interfaces for the agent's tools.

A *provider* is the thing a tool talks to (Aurora, a KServe model, n8n). Each has a
real impl (`live.py`) and an offline impl (`fake.py`). Tools depend only on these
Protocols, so swapping fake↔live is a factory decision (see ``tools/__init__.py``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[list[Any]]
    sql: str
    note: str = ""

    def as_markdown(self, limit: int = 25) -> str:
        head = "| " + " | ".join(self.columns) + " |"
        sep = "| " + " | ".join("---" for _ in self.columns) + " |"
        body = [
            "| " + " | ".join("" if v is None else str(v) for v in r) + " |"
            for r in self.rows[:limit]
        ]
        more = "" if len(self.rows) <= limit else f"\n_({len(self.rows) - limit} more rows)_"
        return "\n".join([head, sep, *body]) + more


@dataclass
class RiskScore:
    appt_id: int
    score: float          # 0..1
    band: str             # red / amber / green
    drivers: list[str] = field(default_factory=list)
    source: str = "model"  # "model" | "fallback"


@dataclass
class ForecastPoint:
    dept_id: int
    date: str
    block: str
    required: float
    projected: float

    @property
    def understaffed(self) -> bool:
        return self.projected < self.required


@dataclass
class ChangeProposal:
    """A schedule change the agent proposes. NEVER auto-applied — needs approval (D7)."""

    proposal_id: str
    summary: str
    status: str = "pending_approval"
    routed_via: str = "n8n"


@runtime_checkable
class AuroraProvider(Protocol):
    def query(self, sql: str) -> QueryResult: ...
    # Parameterized write (INSERT/UPDATE/DELETE/DDL) for the scheduling actions.
    # Distinct from query()'s read-only text-to-SQL path. Returns affected rowcount.
    def execute(self, sql: str, params: tuple = ()) -> int: ...


@runtime_checkable
class ModelProvider(Protocol):
    def no_show_scores(self, appt_ids: list[int]) -> list[RiskScore]: ...
    def coverage_forecast(self, dept_id: int, horizon_days: int) -> list[ForecastPoint]: ...


@runtime_checkable
class WorkflowProvider(Protocol):
    def propose_schedule_change(self, summary: str, payload: dict) -> ChangeProposal: ...


class ReadOnlySQLError(ValueError):
    """Raised when a tool is asked to run non-SELECT SQL (demo safety guard)."""
