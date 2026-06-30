"""UC6 — Human-in-the-loop (HITL) approval gate (BR-1, BR-6, BR-10).

EVERY AI-proposed action passes through here: propose → a human approves / modifies /
rejects → only then does it execute. Nothing auto-executes. Each decision is written to
the audit_log, attributable to a named user + timestamp. A PTO approval that would leave
a service window uncovered is BLOCKED unless explicitly overridden (BR-6).
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..disclaimer import envelope
from ..scheduling import service as S

router = APIRouter(prefix="/api/actions")

# In-process pending store (single-replica demo). Keyed by proposal id.
_PENDING: dict[str, dict] = {}


def _actor(request: Request) -> tuple[str, str]:
    role = request.headers.get("x-nychhc-roles", "Scheduler").split(",")[0].strip() or "Scheduler"
    user = request.headers.get("x-nychhc-user") or f"demo:{role}"
    return role, user


def _a(request: Request):
    return request.app.state.providers.aurora


class Proposal(BaseModel):
    action: str                      # pto_reassign | pto_approve | outreach | schedule_change
    summary: str
    rationale: str = ""
    payload: dict = {}


@router.post("/propose")
async def propose(request: Request, body: Proposal):
    """Stage an AI recommendation for human review. Does NOT execute (BR-1)."""
    pid = "prop-" + __import__("uuid").uuid4().hex[:10]
    _PENDING[pid] = body.model_dump()
    return envelope({"id": pid, "status": "pending", **body.model_dump()})


@router.get("/pending")
async def pending():
    return envelope([{"id": k, **v} for k, v in _PENDING.items()])


@router.get("/audit")
async def audit(request: Request, limit: int = 25):
    return envelope(S.recent_audit(_a(request), limit))


class Decision(BaseModel):
    decision: str                    # approve | modify | reject
    payload: dict | None = None      # optional modified payload (for 'modify')
    override: bool = False           # override a coverage block (BR-6)


@router.post("/{pid}/decision")
async def decide(request: Request, pid: str, body: Decision):
    prop = _PENDING.get(pid)
    if not prop:
        return envelope({"error": "unknown or already-decided proposal"}, status="not_found")
    aurora = _a(request)
    role, user = _actor(request)
    decision = body.decision.lower()
    payload = body.payload or prop.get("payload", {})
    action, summary = prop["action"], prop["summary"]

    # Reject → record, no execution.
    if decision == "reject":
        _PENDING.pop(pid, None)
        a = S.record_audit(aurora, action, summary, role, user, "rejected",
                           outcome="recorded", rationale=prop.get("rationale", ""))
        return envelope({"ok": True, "executed": False, "audit": a})

    # Approve / modify → execute the specific action, then record.
    if action == "pto_reassign":
        res = S.apply_reassignments(aurora, payload.get("plan", []))
        outcome = "executed" if res.get("ok") else "not-completed"
        _PENDING.pop(pid, None)
        a = S.record_audit(aurora, action, summary, role, user,
                           "modified" if decision == "modify" else "approved",
                           outcome=outcome, rationale=prop.get("rationale", ""))
        return envelope({"ok": res.get("ok", False), "executed": outcome == "executed",
                         "result": res, "audit": a})

    if action == "pto_approve":
        conflict = S.coverage_conflict(aurora, payload["provider_id"], payload["start"], payload["end"])
        if conflict.get("breach") and not body.override:
            # BR-6: never silently approve into an uncovered window.
            a = S.record_audit(aurora, action, summary, role, user, "approved",
                               outcome="blocked", rationale=conflict.get("mitigation", ""))
            return envelope({"ok": False, "blocked": True, "conflict": conflict, "audit": a})
        res = S.approve_pto(aurora, payload["pto_id"])
        _PENDING.pop(pid, None)
        a = S.record_audit(aurora, action, summary, role, user, "approved",
                           outcome="executed",
                           rationale=("override: " + conflict.get("mitigation", "")) if body.override else "")
        return envelope({"ok": True, "executed": True, "result": res, "audit": a})

    # Generic action (e.g. outreach — UC7 Phase 2): record the decision.
    _PENDING.pop(pid, None)
    a = S.record_audit(aurora, action, summary, role, user,
                       "modified" if decision == "modify" else "approved", outcome="recorded")
    return envelope({"ok": True, "executed": False, "audit": a})
