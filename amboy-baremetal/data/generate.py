#!/usr/bin/env python3
"""
Amboy NPI-Safe demo — synthetic data generator (M1).

Produces TWO annual investment/credit reports for a fictional community bank
(2024 + 2025) plus a loan-level appendix (>=50 rows/year) seeded with
DELIBERATELY FAKE PII to stress-test redaction:

  * SSNs only in never-issued 000 / 900-999 area blocks, in 3 formats.
  * Phones only in the reserved 555-0100..0199 fiction block, in 4 formats.
  * Invented street numbers/names on real city/ZIP refs; reserved email domains.
  * Messy PII embedded in free-text "notes" (e.g. "SSN ending 6789", restated
    addresses) so detection is tested in prose, not just structured columns.
  * 2025 shows a modestly improved credit profile vs 2024 (lower NPA ratio,
    fewer charge-offs) for a believable multi-year story.

ALL PII is synthetic. RNG is seeded for reproducibility. On run, the generator
self-validates every emitted identifier against amboy/app/common/pii_patterns.py
and refuses to write if anything escapes the safe fiction ranges.

Usage:  python amboy/data/generate.py [--out DIR] [--seed N]
Output: <out>/report_2024.json , <out>/report_2025.json
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys

# Reuse the ONE canonical recognizer module (DRY: same regexes the privacy
# scan and Presidio recognizers use).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
from common import pii_patterns as pp  # noqa: E402

SEED = 20240620
BANK = "Amboy Community Bancorp"
PREPARED_FOR = "Board Investment & Credit Risk Committee"

FIRST_NAMES = [
    "Marcus", "Yolanda", "Devon", "Priya", "Stefan", "Imani", "Caleb", "Rosa",
    "Tobias", "Naomi", "Hassan", "Lillian", "Diego", "Freya", "Omar", "Greta",
    "Quincy", "Sasha", "Malik", "Beatrice", "Theo", "Carmen", "Felix", "Nadia",
    "Ezra", "Pilar", "Roman", "Sloane", "Idris", "Wren", "Cyrus", "Maren",
]
LAST_NAMES = [
    "Okafor", "Delacroix", "Vespucci", "Halloran", "Nakamura", "Petrov",
    "Castellanos", "Bjornsson", "Mwangi", "Lindqvist", "Abernathy", "Sokolov",
    "Fontaine", "Ramaswamy", "Underwood", "Calderon", "Strand", "Quintero",
    "Faulkner", "Vasquez", "Holloway", "Dabrowski", "Espinoza", "Ashworth",
]
STREET_NAMES = [
    "Kingfisher", "Cobalt", "Marlinspike", "Verdant", "Tannery", "Halyard",
    "Pemberton", "Quillfeather", "Saltmarsh", "Birchwood", "Larkspur",
    "Hollowmere", "Ashbourne", "Wexford", "Tallow", "Driftwood",
]
STREET_SUFFIX = ["St", "Ave", "Blvd", "Rd", "Dr", "Ln", "Ct", "Way", "Ter", "Pl"]
# Real city/state/ZIP refs (the street NUMBER + NAME are invented, so no real address).
CITY_REF = [
    ("Perth Amboy", "NJ", "08861"), ("Edison", "NJ", "08817"),
    ("New Brunswick", "NJ", "08901"), ("Elizabeth", "NJ", "07201"),
    ("Newark", "NJ", "07102"), ("Jersey City", "NJ", "07302"),
    ("Trenton", "NJ", "08608"), ("Paterson", "NJ", "07501"),
]
AREA_CODES = ["732", "908", "201", "973", "609", "862"]
SECTORS = [
    "Commercial Real Estate", "Commercial & Industrial", "Residential Mortgage",
    "Consumer", "Agriculture & Small Business",
]
RISK_GRADES = ["Pass", "Pass", "Pass", "Special Mention", "Substandard", "Doubtful"]
STATUSES_2024 = ["Current"] * 7 + ["30-59 DPD", "60-89 DPD", "Nonaccrual", "Charged-Off"]
STATUSES_2025 = ["Current"] * 9 + ["30-59 DPD", "Nonaccrual"]  # improved profile


def _fmt_ssn(rng: random.Random) -> str:
    area = rng.choice(pp.SAFE_SSN_AREAS)
    grp = f"{rng.randint(0, 99):02d}"
    ser = f"{rng.randint(1, 9999):04d}"
    return rng.choice([f"{area}-{grp}-{ser}", f"{area}{grp}{ser}", f"{area} {grp} {ser}"])


def _fmt_phone(rng: random.Random) -> str:
    ac = rng.choice(AREA_CODES)
    sub = f"{rng.randint(pp.SAFE_PHONE_SUBSCRIBER_LO, pp.SAFE_PHONE_SUBSCRIBER_HI):04d}"
    return rng.choice([
        f"({ac}) 555-{sub}", f"{ac}-555-{sub}", f"{ac}.555.{sub}", f"+1 {ac} 555 {sub}",
    ])


def _fmt_email(rng: random.Random, first: str, last: str) -> str:
    dom = rng.choice(pp.SAFE_EMAIL_DOMAINS)
    sep = rng.choice([".", "_", ""])
    return f"{first.lower()}{sep}{last.lower()}@{dom}"


def _fmt_address(rng: random.Random):
    num = rng.randint(10, 9989)
    name = rng.choice(STREET_NAMES)
    suf = rng.choice(STREET_SUFFIX)
    city, st, zc = rng.choice(CITY_REF)
    return f"{num} {name} {suf}, {city}, {st} {zc}"


def _notes(rng: random.Random, ssn: str, phone: str, address: str) -> str:
    """Free-text note with messy PII restated in prose (tests prose detection)."""
    last4 = pp.SSN_RE.search(ssn).group(3)
    templates = [
        f"Borrower reachable at {phone}; confirmed SSN ending {last4}. Site visit "
        f"scheduled at {address}.",
        f"Restructure discussion held. Mailing address on file is {address}. "
        f"Left voicemail at {phone}.",
        f"Annual review: borrower (SSN last 4 {last4}) requested statements by email. "
        f"No change to collateral.",
        f"Collateral inspection at {address} completed. Follow-up call to {phone} pending.",
        f"KYC refresh: identity re-verified, SSN ending {last4}; updated phone {phone}.",
    ]
    return rng.choice(templates)


def _financials(year: int) -> dict:
    """Portfolio-level facts. 2025 is the modestly-improved year."""
    if year == 2024:
        return {
            "total_assets_usd": 1_482_000_000,
            "total_loans_usd": 1_046_500_000,
            "total_deposits_usd": 1_201_300_000,
            "net_income_usd": 14_280_000,
            "tier1_capital_ratio_pct": 11.4,
            "npa_ratio_pct": 1.62,          # non-performing assets / loans
            "net_charge_off_rate_pct": 0.48,
            "loan_loss_reserve_usd": 18_350_000,
            "num_loans": 55,
        }
    return {
        "total_assets_usd": 1_553_900_000,   # +4.9% growth
        "total_loans_usd": 1_092_700_000,
        "total_deposits_usd": 1_268_400_000,
        "net_income_usd": 16_910_000,
        "tier1_capital_ratio_pct": 12.1,     # stronger capital
        "npa_ratio_pct": 1.18,               # improved (lower)
        "net_charge_off_rate_pct": 0.31,     # improved (lower)
        "loan_loss_reserve_usd": 16_900_000,
        "num_loans": 55,
    }


def _sector_concentration(rng: random.Random, total_loans: int) -> dict:
    # Weights drift slightly year to year; CRE stays the largest bucket.
    weights = [rng.uniform(*r) for r in
               [(0.34, 0.40), (0.20, 0.26), (0.16, 0.20), (0.08, 0.12), (0.06, 0.10)]]
    s = sum(weights)
    return {sec: round(total_loans * w / s) for sec, w in zip(SECTORS, weights)}


def _loan_appendix(rng: random.Random, year: int, n: int, statuses) -> list:
    loans = []
    for i in range(1, n + 1):
        first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
        ssn, phone = _fmt_ssn(rng), _fmt_phone(rng)
        address = _fmt_address(rng)
        loans.append({
            "loan_id": f"AMB-{year}-{i:04d}",
            "borrower_name": f"{first} {last}",
            "ssn": ssn,
            "phone": phone,
            "email": _fmt_email(rng, first, last),
            "street_address": address,
            "sector": rng.choice(SECTORS),
            "risk_grade": rng.choice(RISK_GRADES),
            "balance_usd": rng.randint(45_000, 8_500_000),
            "status": rng.choice(statuses),
            "notes": _notes(rng, ssn, phone, address),
        })
    return loans


def build_report(year: int, rng: random.Random) -> dict:
    fin = _financials(year)
    statuses = STATUSES_2024 if year == 2024 else STATUSES_2025
    return {
        "meta": {
            "bank": BANK,
            "fiscal_year": year,
            "report_type": "Annual Investment & Credit Report",
            "prepared_for": PREPARED_FOR,
            "classification": "CONFIDENTIAL — contains synthetic NPI for demo only",
        },
        "financials": fin,
        "sector_concentration_usd": _sector_concentration(rng, fin["total_loans_usd"]),
        "loan_appendix": _loan_appendix(rng, year, fin["num_loans"], statuses),
    }


def validate(report: dict) -> list:
    """Return a list of violations; empty == every identifier is safe-synthetic."""
    bad = []
    for loan in report["loan_appendix"]:
        if not pp.ssn_is_synthetic(loan["ssn"]):
            bad.append(("ssn", loan["loan_id"], loan["ssn"]))
        if not pp.phone_is_synthetic(loan["phone"]):
            bad.append(("phone", loan["loan_id"], loan["phone"]))
        if not pp.email_is_synthetic(loan["email"]):
            bad.append(("email", loan["loan_id"], loan["email"]))
        # The note must contain detectable PII (so the redaction test is meaningful)…
        if not pp.scan(loan["notes"]):
            bad.append(("notes-no-pii", loan["loan_id"], loan["notes"]))
        # …but any phone restated in the note must still be in the safe block.
        for _, hit in pp.scan(loan["notes"]):
            if pp.PHONE_RE.fullmatch(hit) and not pp.phone_is_synthetic(hit):
                bad.append(("notes-phone", loan["loan_id"], hit))
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate synthetic Amboy reports.")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "out"))
    ap.add_argument("--seed", type=int, default=SEED)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    rng = random.Random(args.seed)

    total_bad = 0
    for year in (2024, 2025):
        report = build_report(year, rng)
        violations = validate(report)
        if violations:
            total_bad += len(violations)
            for kind, lid, val in violations[:10]:
                print(f"  ✘ UNSAFE {kind} in {lid}: {val!r}", file=sys.stderr)
            continue
        path = os.path.join(args.out, f"report_{year}.json")
        with open(path, "w") as f:
            json.dump(report, f, indent=2)
        n = len(report["loan_appendix"])
        npa = report["financials"]["npa_ratio_pct"]
        print(f"  ✔ {path}  ({n} loans, NPA {npa}%) — all PII safe-synthetic")

    if total_bad:
        print(f"\nREFUSING: {total_bad} identifier(s) escaped the safe fiction ranges.",
              file=sys.stderr)
        return 1
    print("\nM1 OK — two reports written; every identifier validated synthetic.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
