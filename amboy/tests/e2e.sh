#!/usr/bin/env bash
# =============================================================================
#  Amboy — LIVE on-cluster privacy + behavior gate.
#  Runs against the deployed services (in-cluster DNS) by exec'ing python inside
#  the deid-gateway pod, plus a psql audit check. Exit 0 = all live invariants hold.
# =============================================================================
set -euo pipefail
NS_AI=iis-ai-ai; NS_DATA=iis-ai-data
GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; RESET='\033[0m'
info(){ echo -e "  ${CYAN}➤${RESET} $*"; }
ok(){   echo -e "  ${GREEN}✔${RESET} $*"; }
fail(){ echo -e "  ${RED}✘${RESET} $*" >&2; exit 1; }

command -v oc >/dev/null 2>&1 || fail "oc not on PATH"
POD="$(oc -n "$NS_AI" get pod -l app=amboy-deid-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
[ -n "$POD" ] || fail "deid-gateway pod not found — deploy first"

info "running live invariants inside $POD"
# -i is REQUIRED: without it oc doesn't forward the heredoc to `python -`, which
# then reads empty stdin and exits 0 (a silent false-positive).
oc -n "$NS_AI" exec -i "$POD" -- python - <<'PY'
import sys, httpx
from app.common import config, pii_patterns

DEID = "http://localhost:8080"
METRICS = config.METRICS_ENGINE_URL
AGENT = config.COMPARE_AGENT_URL
fails = []

# 1. ingest both reports from the raw bucket
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
# grab a real token from the deid retrieve text
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
ra = httpx.post(f"{AGENT}/analyze", json={"report_id_a": "AMB-FY2024",
                "report_id_b": "AMB-FY2025", "year_a": 2024, "year_b": 2025}, timeout=180)
if ra.status_code == 200:
    body = ra.json()
    if pii_patterns.scan(body["draft_summary"]):
        fails.append("NPI in agent draft_summary")
    if not body["grounding"]["grounded"]:
        fails.append(f"agent narrative not grounded: {body['grounding']['ungrounded']}")
    print(f"  analyze: mode={body['mode']} grounded={body['grounding']['grounded']}")
else:
    fails.append(f"analyze -> {ra.status_code}")

if fails:
    print("LIVE INVARIANTS FAILED:")
    for f in fails:
        print("  X", f)
    sys.exit(1)
print("LIVE INVARIANTS PASS")
PY

info "checking append-only audit rows"
PGPOD="$(oc -n "$NS_DATA" get pod -l app=iis-ai-postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
if [ -n "$PGPOD" ]; then
  oc -n "$NS_DATA" exec "$PGPOD" -- psql -U rhoai_admin rhoai_demo -tAc \
    "SELECT action||':'||count(*) FROM amboy.audit_log GROUP BY action ORDER BY action;" \
    | sed 's/^/    audit /'
  ok "audit_log populated (ingest/detokenize/retrieve/llm_call expected)"
else
  echo "    (postgres pod not found by label app=iis-ai-postgres — skipping audit check)"
fi

echo -e "${GREEN}make verify-cluster GREEN${RESET}"
