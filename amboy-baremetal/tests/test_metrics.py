#!/usr/bin/env python3
"""Deterministic metrics-engine checks (offline; no DB)."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from app.metrics_engine import compute  # noqa: E402

DATA = os.path.join(ROOT, "data", "out")


def _facts(fin):
    def unit(m):
        return "USD" if m.endswith("_usd") else ("pct" if m.endswith("_pct") else "count")
    return {m: {"value": float(v), "unit": unit(m)} for m, v in fin.items()}


def main() -> int:
    if not all(os.path.exists(os.path.join(DATA, f"report_{y}.json")) for y in (2024, 2025)):
        os.system(f"{sys.executable} {os.path.join(ROOT, 'data', 'generate.py')} >/dev/null")
    r24 = json.load(open(os.path.join(DATA, "report_2024.json")))
    r25 = json.load(open(os.path.join(DATA, "report_2025.json")))
    f24, f25 = _facts(r24["financials"]), _facts(r25["financials"])
    fails = []

    cmp = compute.compare(f24, f25, 2024, 2025)
    npa = next(r for r in cmp["comparison"] if r["metric"] == "npa_ratio_pct")
    if npa["direction"] != "down":
        fails.append(f"expected NPA to improve (down), got {npa['direction']}")

    fl24 = compute.flag_policy(f24, r24["sector_concentration_usd"])
    fl25 = compute.flag_policy(f25, r25["sector_concentration_usd"])
    codes24 = {f["code"] for f in fl24["flags"]}
    codes25 = {f["code"] for f in fl25["flags"]}
    if "NPA_ELEVATED" not in codes24:
        fails.append("2024 NPA 1.62% should breach the 1.50% limit")
    if "NPA_ELEVATED" in codes25:
        fails.append("2025 NPA 1.18% should NOT breach the 1.50% limit")

    sc = compute.scenario(f25, 200)
    if "earnings_at_risk_usd" not in sc or sc["stressed_npa_ratio_pct"] <= sc["current_npa_ratio_pct"]:
        fails.append(f"scenario sensitivity malformed: {sc}")

    if fails:
        print("METRICS CHECKS FAILED:")
        for f in fails:
            print("  ✘", f)
        return 1
    print(f"  ✔ compare: NPA {npa['y2024']}% -> {npa['y2025']}% ({npa['pct_change']}%, {npa['direction']})")
    print(f"  ✔ flag_policy 2024 flags={sorted(codes24)}  |  2025 flags={sorted(codes25)}")
    print(f"  ✔ scenario(+200bps): EaR=${sc['earnings_at_risk_usd']:,.0f}, "
          f"NPA {sc['current_npa_ratio_pct']}% -> {sc['stressed_npa_ratio_pct']}% (stressed)")
    print("\nM5 metrics-engine checks PASS.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
