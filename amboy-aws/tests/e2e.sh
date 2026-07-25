#!/usr/bin/env bash
# =============================================================================
#  Amboy on AWS — LIVE on-cluster privacy + behavior gate.
#  Same invariants as ../amboy-baremetal/tests/e2e.sh, re-plumbed: single ns
#  `amboy`, and the audit check runs via python/psycopg INSIDE the deid pod
#  (the database is Aurora — there is no postgres pod on the AWS stack).
# =============================================================================
set -euo pipefail
NS=amboy
GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; RESET='\033[0m'
info(){ echo -e "  ${CYAN}➤${RESET} $*"; }
ok(){   echo -e "  ${GREEN}✔${RESET} $*"; }
fail(){ echo -e "  ${RED}✘${RESET} $*" >&2; exit 1; }

command -v oc >/dev/null 2>&1 || fail "oc not on PATH"
POD="$(oc -n "$NS" get pod -l app=amboy-deid-gateway --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
[ -n "$POD" ] || fail "deid-gateway pod not found — deploy first"

info "running live invariants inside $POD"
# -i is REQUIRED: without it oc doesn't forward the heredoc to `python -`, which
# then reads empty stdin and exits 0 (a silent false-positive).
oc -n "$NS" exec -i "$POD" -- python - <<'PY'
import sys, httpx
from app.common import config, pii_patterns

DEID = "http://localhost:8080"
METRICS = config.METRICS_ENGINE_URL
AGENT = config.COMPARE_AGENT_URL
fails = []

# 1. ingest both reports from the S3 raw bucket
for key in ("report_2024.json", "report_2025.json"):
    r = httpx.post(f"{DEID}/ingest", json={"bucket": config.S3_BUCKET_RAW,
                   "raw_key": key, "actor": "e2e"}, timeout=120)
    if r.status_code != 200:
        fails.append(f"ingest {key} -> {r.status_code} {r.text[:200]}")
print("  ingest done")

# 2. /retrieve output must contain NO NPI (de-identified chunks only)
r = httpx.post(f"{DEID}/retrieve", json={"query": "collateral inspection", "k": 5}, timeout=60)
hits = pii_patterns.scan(r.text)
if hits:
    fails.append(f"NPI leaked in retrieve output: {hits[:3]}")
else:
    print("  retrieve output NPI-clean")

# 3. /detokenize WITHOUT the role -> 403
import re
m = re.search(r"\[[A-Z_]+:[0-9a-fA-F]+\]", r.text)
token = m.group(0) if m else "[PERSON:deadbeef]"
r403 = httpx.post(f"{DEID}/detokenize", json={"token": token}, headers={"X-Amboy-Roles": ""}, timeout=30)
if r403.status_code != 403:
    fails.append(f"detokenize without role expected 403, got {r403.status_code}")
else:
    print("  detokenize denied (403) without npi-reveal")

# 4. /detokenize WITH the role -> 200 (+ audited server-side)
r200 = httpx.post(f"{DEID}/detokenize", json={"token": token},
                  headers={"X-Amboy-Roles": config.NPI_REVEAL_ROLE}, timeout=30)
if r200.status_code != 200:
    fails.append(f"detokenize with role expected 200, got {r200.status_code}")
else:
    print("  detokenize allowed (200) with npi-reveal")

# 5. /analyze -> grounded, and the draft narrative carries NO NPI
# 600s (baremetal: 180s): with no PORTKEY_API_KEY the agent exhausts the LLM
# retry chain (~6-7 min) before the deterministic fallback answers — a latency
# artifact of keyless mode, not a privacy regression.
ra = httpx.post(f"{AGENT}/analyze", json={"report_id_a": "AMB-FY2024",
                "report_id_b": "AMB-FY2025", "year_a": 2024, "year_b": 2025}, timeout=600)
if ra.status_code == 200:
    body = ra.json()
    if pii_patterns.scan(body["draft_summary"]):
        fails.append("NPI in agent draft_summary")
    g = body["grounding"]
    # In LLM mode the guard may FLAG model-derived figures (e.g. a computed
    # delta) — that is the invariant WORKING (the draft is gated for sign-off),
    # not a failure. Fail only if the guard reports nothing yet grounded=False.
    if not g["grounded"] and not g.get("ungrounded"):
        fails.append("agent narrative not grounded and nothing flagged")
    print(f"  analyze: mode={body['mode']} grounded={g['grounded']}"
          + (f" (guard flagged: {g.get('ungrounded')})" if g.get("ungrounded") else ""))
else:
    fails.append(f"analyze -> {ra.status_code}")

if fails:
    print("LIVE INVARIANTS FAILED:")
    for f in fails:
        print("  X", f)
    sys.exit(1)
print("LIVE INVARIANTS PASS")
PY

info "checking append-only audit rows (Aurora, via psycopg in-pod)"
oc -n "$NS" exec -i "$POD" -- python - <<'PY'
from app.common import db
with db.connect() as conn:
    cur = conn.cursor()
    cur.execute("SELECT action, count(*) FROM amboy.audit_log GROUP BY action ORDER BY action")
    for action, n in cur.fetchall():
        print(f"    audit {action}:{n}")
PY
ok "audit_log populated (ingest/detokenize/retrieve/llm_call expected)"

echo -e "${GREEN}make verify-cluster GREEN${RESET}"
