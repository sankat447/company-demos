"""Deterministic financial computations (EXTRACT-COMPUTE-NARRATE).

Every figure the agent is allowed to state is produced here, in code, from the
NPI-free facts. The LLM never computes or invents a number. No forecasting from
two snapshots — /scenario offers transparent rate-shock SENSITIVITY with its
assumptions stated, not a prediction.
"""
from __future__ import annotations


def pct_change(old: float, new: float):
    return None if not old else round((new - old) / old * 100.0, 2)


def _v(facts: dict, metric: str, default=0.0) -> float:
    return float(facts.get(metric, {}).get("value", default))


# ── /compare ─────────────────────────────────────────────────────────────────
def compare(facts_a: dict, facts_b: dict, year_a: int, year_b: int) -> dict:
    rows = []
    for m in sorted(set(facts_a) & set(facts_b)):
        a, b = facts_a[m]["value"], facts_b[m]["value"]
        unit = facts_a[m].get("unit")
        delta = round(b - a, 4)
        rows.append({
            "metric": m, "unit": unit,
            f"y{year_a}": a, f"y{year_b}": b,
            "abs_change": delta,
            "pct_change": pct_change(a, b),
            "direction": "up" if delta > 0 else ("down" if delta < 0 else "flat"),
        })
    return {"years": [year_a, year_b], "comparison": rows}


# ── /flag_policy ─────────────────────────────────────────────────────────────
# (code, metric, comparator, threshold, severity, message)
POLICY_RULES = [
    ("NPA_ELEVATED", "npa_ratio_pct", ">", 1.50, "high",
     "Non-performing asset ratio above the 1.50% board limit"),
    ("CHARGEOFF_HIGH", "net_charge_off_rate_pct", ">", 0.50, "medium",
     "Net charge-off rate above the 0.50% tolerance"),
    ("CAPITAL_LOW", "tier1_capital_ratio_pct", "<", 10.0, "high",
     "Tier-1 capital ratio below the 10.0% internal floor"),
]
CONCENTRATION_LIMIT_PCT = 35.0


def flag_policy(facts: dict, sectors: dict) -> dict:
    flags = []
    for code, metric, cmp, thr, sev, msg in POLICY_RULES:
        if metric not in facts:
            continue
        val = facts[metric]["value"]
        breach = (val > thr) if cmp == ">" else (val < thr)
        if breach:
            flags.append({"code": code, "severity": sev, "metric": metric,
                          "value": val, "threshold": thr, "comparator": cmp,
                          "message": msg})

    total_loans = _v(facts, "total_loans_usd")
    if total_loans:
        for sector, bal in sectors.items():
            share = round(bal / total_loans * 100.0, 2)
            if share > CONCENTRATION_LIMIT_PCT:
                flags.append({
                    "code": "CONCENTRATION", "severity": "medium",
                    "metric": f"sector_share::{sector}", "value": share,
                    "threshold": CONCENTRATION_LIMIT_PCT, "comparator": ">",
                    "message": f"Concentration in {sector} ({share}%) above "
                               f"{CONCENTRATION_LIMIT_PCT}% guideline"})

    # Reserve coverage of estimated non-performing loans.
    npa_pct = _v(facts, "npa_ratio_pct")
    reserve = _v(facts, "loan_loss_reserve_usd")
    npl = total_loans * npa_pct / 100.0
    if npl:
        coverage = round(reserve / npl, 2)
        if coverage < 1.0:
            flags.append({"code": "THIN_RESERVE", "severity": "medium",
                          "metric": "reserve_coverage_ratio", "value": coverage,
                          "threshold": 1.0, "comparator": "<",
                          "message": f"Loan-loss reserve covers only {coverage}x "
                                     f"estimated non-performing loans"})
    return {"flags": flags, "flag_count": len(flags)}


# ── /scenario — rate-shock SENSITIVITY (not a forecast) ──────────────────────
def scenario(facts: dict, shock_bps: int) -> dict:
    total_loans = _v(facts, "total_loans_usd")
    total_deposits = _v(facts, "total_deposits_usd")
    npa_pct = _v(facts, "npa_ratio_pct")

    # Crude 1-yr repricing gap proxy; earnings-at-risk for a parallel shock.
    repricing_gap = total_loans - total_deposits
    earnings_at_risk = round(-(shock_bps / 10000.0) * repricing_gap, 0)
    # NPA stress: assume credit deteriorates proportionally to the rate move.
    stress_factor = abs(shock_bps) / 10000.0 * 3.0
    stressed_npa = round(npa_pct * (1.0 + stress_factor), 2)

    return {
        "shock_bps": shock_bps,
        "earnings_at_risk_usd": earnings_at_risk,
        "current_npa_ratio_pct": npa_pct,
        "stressed_npa_ratio_pct": stressed_npa,
        "assumptions": [
            "Parallel rate shock; 1-year repricing gap proxied as loans minus deposits",
            "Earnings-at-risk = -(shock_bps/10000) x repricing_gap",
            "NPA stress = current x (1 + 3 x |shock_bps|/10000); illustrative sensitivity, not a forecast",
        ],
    }
