"""UC8 — the Epic/MCP data-access layer.

`EpicAdapter` is the single seam between the AI layer and the system of record. The
AI never holds Epic credentials or touches Epic directly (BR-12); it calls these
FHIR-shaped tools. For the demo the adapter is backed by the in-stack Postgres
(synthetic, FHIR-mirrored); for production the same tool signatures are backed by a
real Epic FHIR client with no caller changes (BR-14).
"""

from .epic_adapter import EPIC_TOOLS, EpicAdapter, EpicError

__all__ = ["EpicAdapter", "EpicError", "EPIC_TOOLS"]
