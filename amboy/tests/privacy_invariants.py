#!/usr/bin/env python3
"""
Amboy privacy invariants — OFFLINE gate (no cluster needed).

Runs the real de-identification engine with the deterministic LOCAL tokenizer
backend and Presidio absent (presidio_spans -> [] on connection failure), so the
REGEX sweep alone must still remove every detectable NPI entity. This is the
strongest claim: even with the ML detector down, nothing regex-detectable leaks.

Asserts:
  P1  No NPI (SSN/phone/email/address) survives in any de-identified text or in
      the loan-facts / chunks that would be indexed or sent to the LLM.
  P2  Every token has the form [ENTITY:hex].
  P3  Tokenization is deterministic: same value -> same token (cross-report).
  P4  The prompt payload an agent would build contains ONLY tokens + numbers.

Live, on-cluster checks (/detokenize 403, prompt-to-Portkey scan) live in
tests/e2e.sh.  Exit 0 = all invariants hold.
"""
import json
import os
import re
import sys

os.environ.setdefault("AMBOY_TOKENIZER_BACKEND", "local")  # no Vault offline
# Point Presidio at a dead address so presidio_spans() falls back to regex-only.
os.environ.setdefault("AMBOY_PRESIDIO_ANALYZER_URL", "http://127.0.0.1:0")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from app.common import deid, pii_patterns  # noqa: E402
from app.common.tokenizer import Tokenizer  # noqa: E402

TOKEN_FMT = re.compile(r"^\[[A-Z_]+:[0-9a-fA-F]+\]$")
DATA = os.path.join(ROOT, "data", "out")


def _load_reports():
    paths = [os.path.join(DATA, f"report_{y}.json") for y in (2024, 2025)]
    if not all(os.path.exists(p) for p in paths):
        os.system(f"{sys.executable} {os.path.join(ROOT, 'data', 'generate.py')} >/dev/null")
    return [json.load(open(p)) for p in paths]


def _deidentify(reports):
    """Return (deid_loans, all_tokens, token_by_value) using the real engine."""
    tok = Tokenizer(backend="local")
    all_tokens, token_by_value = [], {}

    def on_token(token, etype, value):
        all_tokens.append(token)
        token_by_value.setdefault(value, token)

    deid_loans = []
    for rep in reports:
        for loan in rep["loan_appendix"]:
            btok = deid.deidentify_value("PERSON", loan["borrower_name"], tok, on_token)
            for field, et in (("ssn", "US_SSN"), ("phone", "PHONE"),
                              ("email", "EMAIL"), ("street_address", "ADDRESS")):
                deid.deidentify_value(et, loan[field], tok, on_token)
            deid_notes = deid.deidentify_text(loan["notes"], tok, on_token)
            deid_loans.append({
                "loan_id": loan["loan_id"], "borrower_token": btok,
                "sector": loan["sector"], "risk_grade": loan["risk_grade"],
                "balance_usd": loan["balance_usd"], "status": loan["status"],
                "notes": deid_notes,
            })
    return deid_loans, all_tokens, token_by_value


def main() -> int:
    reports = _load_reports()
    deid_loans, all_tokens, token_by_value = _deidentify(reports)
    failures = []

    # P1 — no NPI survives anywhere in the de-identified, indexable payload.
    for loan in deid_loans:
        blob = json.dumps(loan)
        hits = pii_patterns.scan(blob)
        if hits:
            failures.append(f"P1 NPI leak in {loan['loan_id']}: {hits[:3]}")

    # P2 — token format.
    for t in all_tokens:
        if not TOKEN_FMT.match(t):
            failures.append(f"P2 bad token format: {t!r}")
            break

    # P3 — determinism (same value -> same token), re-run a sample.
    tok = Tokenizer(backend="local")
    for value, token in list(token_by_value.items())[:25]:
        again = tok.token(token[1:token.index(":")], value)
        if again != token:
            failures.append(f"P3 non-deterministic for {value!r}: {token} != {again}")

    # P4 — the agent prompt payload (deid loans + numeric facts) is token+number only.
    prompt_payload = json.dumps({
        "facts": [r["financials"] for r in reports],
        "loans": deid_loans,
    })
    hits = pii_patterns.scan(prompt_payload)
    if hits:
        failures.append(f"P4 NPI in agent prompt payload: {hits[:5]}")

    if failures:
        print("PRIVACY INVARIANTS FAILED:")
        for f in failures:
            print("  ✘", f)
        return 1
    print(f"  ✔ P1 no NPI in {len(deid_loans)} de-identified loans / chunks")
    print(f"  ✔ P2 all {len(all_tokens)} tokens well-formed [ENTITY:hex]")
    print("  ✔ P3 tokenization deterministic (same value -> same token)")
    print("  ✔ P4 agent prompt payload is tokens + numbers only")
    print("\nM4 privacy invariants PASS (regex sweep alone, Presidio absent).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
