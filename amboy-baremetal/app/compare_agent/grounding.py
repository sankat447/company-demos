"""Number-grounding guard: every figure the LLM states must trace to a tool output.

This is how we enforce "narrate verified numbers only" and back the invariant
'every figure in the agent narrative also exists in the metrics-engine output'.
"""
from __future__ import annotations

import re

_NUM_RE = re.compile(r"-?\$?\d[\d,]*(?:\.\d+)?%?")


def _norm(tok: str):
    t = tok.replace("$", "").replace(",", "").replace("%", "")
    try:
        return round(float(t), 2)
    except ValueError:
        return None


def extract_numbers(text: str, material_only: bool = False) -> set:
    """Extract numeric tokens. With material_only, keep only figures that could be
    a real financial claim — those with a decimal/comma/%/$ or magnitude >= 100 —
    so cosmetic single digits (markdown '### 1.', 'Tier 1') don't trip grounding."""
    out = set()
    for m in _NUM_RE.finditer(text or ""):
        tok = m.group(0)
        v = _norm(tok)
        if v is None:
            continue
        if material_only and not (
                any(c in tok for c in ".,%$") or abs(v) >= 100):
            continue
        out.add(v)
    return out


def verified_numbers(tool_outputs) -> set:
    """Walk all tool-output JSON and collect every numeric leaf (rounded)."""
    seen = set()

    def walk(x):
        if isinstance(x, bool):
            return
        if isinstance(x, (int, float)):
            seen.add(round(float(x), 2))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, str):
            for n in extract_numbers(x):
                seen.add(n)
    walk(tool_outputs)
    return seen


def check(narrative: str, tool_outputs) -> dict:
    """Return grounding verdict. Years 1990-2100 are always allowed as labels."""
    verified = verified_numbers(tool_outputs)
    # Compare on MAGNITUDE: the engine stores declines as negative abs_change /
    # pct_change, while a narrative states them as positive ("down 0.44pp"), often
    # with a typographic minus the regex can't read as a sign.
    verified_abs = {abs(v) for v in verified}
    stated = extract_numbers(narrative, material_only=True)
    ungrounded = []
    for n in stated:
        a = abs(n)
        if a in verified_abs:
            continue
        if 1990 <= a <= 2100 and float(a).is_integer():  # year labels
            continue
        # tolerate rounding drift vs any verified figure (0.5% or 0.01 abs)
        if any(abs(a - av) <= max(0.01, av * 0.005) for av in verified_abs):
            continue
        ungrounded.append(n)
    score = 1.0 if not stated else round(1 - len(ungrounded) / len(stated), 3)
    return {"grounded": not ungrounded, "ungrounded": sorted(ungrounded),
            "grounding_score": score, "stated_count": len(stated)}
