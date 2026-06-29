"""UC8 — Epic MCP adapter (FHIR-shaped tools over the in-stack Postgres).

The adapter exposes the spec's named tools (get_patient_appointments,
get_provider_schedule, check_slot_availability, plus get_risk_scores and
check_pto_impact) and returns FHIR Appointment/Slot-shaped JSON. It is the ONLY
component that "reads Epic" — here, the synthetic FHIR-mirrored Postgres via the
existing scheduling service. Swapping the backend to a real Epic FHIR client is the
only change needed for production (BR-14); callers (agent, UI) are unaffected.

Errors are TYPED (EpicError) so a caller can enter degraded mode instead of
fabricating data (BR-12; UC8 exception flow 2a). FOR DEMONSTRATION — SYNTHETIC DATA.
"""

from __future__ import annotations

from typing import Any

from ..scheduling import service as S


class EpicError(Exception):
    """Typed adapter error. `.code` lets callers branch (e.g. into degraded mode)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def as_dict(self) -> dict:
        return {"error": {"code": self.code, "message": self.message}}


# The callable tool surface (name → one-line description), mirrored by mcp_server.py
# and exposed over REST at /api/mcp/tools for UI/demoer visibility.
EPIC_TOOLS = {
    "get_patient_appointments": "FHIR Appointments for a patient (by patient_id).",
    "get_provider_schedule": "A provider's booked FHIR Appointments for a date.",
    "check_slot_availability": "Open FHIR Slots for a provider on a date.",
    "get_risk_scores": "No-show risk tiers for today's panel (per appointment).",
    "check_pto_impact": "Downstream coverage impact of a provider's leave window.",
}


def _start_iso(d: str, t: str) -> str:
    """Combine FHIR-style date + HH:MM into a local datetime string."""
    return f"{d}T{t}:00"


def _appt_to_fhir(a: dict) -> dict:
    """Map a sched_appointments row to a FHIR R4 Appointment resource."""
    status_map = {"Booked": "booked", "Cancelled": "cancelled", "Open": "free"}
    return {
        "resourceType": "Appointment",
        "id": a.get("id"),
        "status": status_map.get(a.get("status", "Booked"), "booked"),
        "appointmentType": {"text": a.get("type")},
        "description": a.get("reason"),
        "start": _start_iso(a.get("appt_date", ""), a.get("appt_time", "")),
        "minutesDuration": a.get("duration_min", 30),
        "participant": [
            {"actor": {"reference": f"Patient/{a.get('patient_id')}", "display": a.get("patient_name")},
             "status": "accepted"},
            {"actor": {"reference": f"Practitioner/{a.get('provider_id')}", "display": a.get("provider_name")},
             "status": "accepted"},
        ],
    }


def _slot_to_fhir(provider_id: str, provider_name: str, d: str, t: str, status: str) -> dict:
    """Map a computed calendar slot to a FHIR R4 Slot resource."""
    return {
        "resourceType": "Slot",
        "status": "free" if status == "Open" else "busy",
        "start": _start_iso(d, t),
        "schedule": {"reference": f"Schedule/{provider_id}", "display": provider_name},
    }


class EpicAdapter:
    """FHIR-shaped tool surface over a `Providers` bundle (the AI's only data path)."""

    def __init__(self, providers: Any) -> None:
        self._providers = providers
        self.aurora = providers.aurora

    # ── FHIR tools (spec-named) ────────────────────────────────────────────────
    def get_patient_appointments(self, patient_id: str) -> list[dict]:
        try:
            rows = S.find_appointments(self.aurora, patient_id=patient_id, status="")
            return [_appt_to_fhir(a) for a in rows]
        except Exception as e:  # pragma: no cover - defensive
            raise EpicError("source_unavailable", f"Epic appointment read failed: {e}") from e

    def get_provider_schedule(self, provider_id: str, date: str) -> list[dict]:
        try:
            cal = S.get_calendar(self.aurora, provider_id, date)
            if cal.get("error"):
                raise EpicError("not_found", f"unknown provider {provider_id}")
            out = []
            for s in cal.get("slots", []):
                if s["status"] == "Booked":
                    a = dict(s["appt"]); a["appt_date"] = date
                    a["status"] = "Booked"; a["provider_id"] = provider_id
                    a["provider_name"] = cal["provider"]["name"]
                    out.append(_appt_to_fhir(a))
            return out
        except EpicError:
            raise
        except Exception as e:  # pragma: no cover
            raise EpicError("source_unavailable", f"Epic schedule read failed: {e}") from e

    def check_slot_availability(self, provider_id: str, date: str) -> list[dict]:
        try:
            cal = S.get_calendar(self.aurora, provider_id, date)
            if cal.get("error"):
                raise EpicError("not_found", f"unknown provider {provider_id}")
            name = cal["provider"]["name"]
            return [_slot_to_fhir(provider_id, name, date, s["time"], s["status"])
                    for s in cal.get("slots", []) if s["status"] == "Open"]
        except EpicError:
            raise
        except Exception as e:  # pragma: no cover
            raise EpicError("source_unavailable", f"Epic slot read failed: {e}") from e

    def get_risk_scores(self, date: str | None = None) -> list[dict]:
        try:
            rows = self.aurora.query(
                "SELECT tier, patient_name, appt_time, provider, risk_pct, factors "
                "FROM risk_today ORDER BY risk_pct DESC").rows
            return [{"tier": r[0], "patient": r[1], "time": r[2], "provider": r[3],
                     "risk_pct": r[4], "factors": r[5]} for r in rows]
        except Exception as e:  # pragma: no cover
            raise EpicError("source_unavailable", f"risk score read failed: {e}") from e

    def check_pto_impact(self, provider_id: str, start: str, end: str) -> dict:
        try:
            return S.compute_pto_impact(self.aurora, provider_id, start, end)
        except Exception as e:  # pragma: no cover
            raise EpicError("source_unavailable", f"PTO impact compute failed: {e}") from e

    # ── dispatch (used by the REST + MCP surfaces) ─────────────────────────────
    def call(self, tool: str, **kwargs) -> Any:
        if tool not in EPIC_TOOLS:
            raise EpicError("unknown_tool", f"no such Epic tool: {tool}")
        return getattr(self, tool)(**kwargs)
