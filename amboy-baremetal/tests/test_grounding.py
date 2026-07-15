#!/usr/bin/env python3
"""Grounding guard checks (offline) — enforces 'narrate verified numbers only'."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from app.compare_agent import grounding  # noqa: E402

# Stand-in tool outputs (shape matches metrics-engine responses).
TOOL_OUTPUTS = [
    {"comparison": [
        {"metric": "npa_ratio_pct", "y2024": 1.62, "y2025": 1.18,
         "abs_change": -0.44, "pct_change": -27.16, "direction": "down"}]},
    {"flags": [{"code": "CONCENTRATION", "value": 38.5, "threshold": 35.0}]},
    {"earnings_at_risk_usd": 3514000, "current_npa_ratio_pct": 1.18,
     "stressed_npa_ratio_pct": 1.25},
]


def main() -> int:
    fails = []

    # A narrative using only verified figures must be fully grounded.
    good = ("NPA improved from 1.62% to 1.18% (-27.16%). Concentration flag at 38.5% "
            "vs 35.0%. Rate-shock earnings-at-risk $3,514,000; NPA stressed to 1.25% "
            "in 2025. DRAFT — requires human sign-off: review concentration.")
    v_good = grounding.check(good, TOOL_OUTPUTS)
    if not v_good["grounded"]:
        fails.append(f"grounded narrative wrongly flagged: {v_good['ungrounded']}")

    # A hallucinated figure (99.9 appears nowhere) MUST be caught.
    bad = "NPA improved to 1.18%, and the bank holds a hidden 99.9% reserve buffer."
    v_bad = grounding.check(bad, TOOL_OUTPUTS)
    if v_bad["grounded"] or 99.9 not in v_bad["ungrounded"]:
        fails.append(f"hallucinated 99.9 not caught: {v_bad}")

    if fails:
        print("GROUNDING CHECKS FAILED:")
        for f in fails:
            print("  ✘", f)
        return 1
    print(f"  ✔ grounded narrative passes (score {v_good['grounding_score']})")
    print(f"  ✔ hallucinated figure 99.9 caught as ungrounded {v_bad['ungrounded']}")
    print("\nM6 grounding checks PASS.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
