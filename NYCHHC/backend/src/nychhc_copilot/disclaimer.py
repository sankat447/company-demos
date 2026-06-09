"""Mandatory demo disclaimer (Lesson L10).

The banner text MUST appear on every UI page and in every API response envelope.
This module is the single source of truth for that text.
"""

from __future__ import annotations

from typing import Any

DISCLAIMER = "FOR DEMONSTRATION ONLY — NOT FOR CLINICAL USE — SYNTHETIC DATA"

# HTTP headers must be latin-1 encodable; the em-dashes above are not. Use this
# ASCII variant anywhere that has to live in a header (see LESSONS_LEARNED.md).
DISCLAIMER_ASCII = "FOR DEMONSTRATION ONLY - NOT FOR CLINICAL USE - SYNTHETIC DATA"


def envelope(data: Any, **meta: Any) -> dict[str, Any]:
    """Wrap any payload in the standard response envelope.

    Every API response in this service goes through here so the disclaimer can
    never be accidentally omitted.
    """
    body: dict[str, Any] = {
        "disclaimer": DISCLAIMER,
        "data": data,
    }
    if meta:
        body["meta"] = meta
    return body
