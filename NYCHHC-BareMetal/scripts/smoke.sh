#!/usr/bin/env bash
# Live smoke test for a deployed NYCHHC-BareMetal demo (run by `make verify-cluster`).
# Hits the public Routes with -k (self-signed wildcard). Exits non-zero on failure.
set -uo pipefail
DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DEMO_DIR/scripts/lib.sh"
nychhc_kubeconfig

FAILS=0
pass(){ ok "$*"; }
fail(){ echo -e "  ${RED}✘${RESET} $*" >&2; FAILS=$((FAILS+1)); }

BE_HOST="$(oc -n "$NS_AI" get route nychhc-copilot -o jsonpath='{.spec.host}' 2>/dev/null || true)"
FE_HOST="$(oc -n "$NS_UI" get route nychhc-frontend -o jsonpath='{.spec.host}' 2>/dev/null || true)"
[ -n "$BE_HOST" ] || err "backend route nychhc-copilot not found — is the demo deployed?"
BE="https://$BE_HOST"; FE="https://$FE_HOST"
info "backend=$BE"; info "frontend=$FE"

# 1. health
if curl -fsk "$BE/health" | grep -q '"status"'; then pass "/health ok"; else fail "/health"; fi
# 2. capabilities (DR list)
if curl -fsk "$BE/api/capabilities" | grep -q 'DR-01'; then pass "/api/capabilities lists DR-01…"; else fail "/api/capabilities"; fi
# 3. scheduling reads — roster + specialties
if curl -fsk "$BE/api/sched/specialties" | grep -qi 'Obstetrics'; then pass "specialties include Obstetrics"; else fail "specialties"; fi
if curl -fsk "$BE/api/sched/doctors?specialty=Obstetrics" | grep -qiE 'Chen|Santos'; then pass "Obstetrics roster (Chen/Santos)"; else fail "Obstetrics doctors"; fi

# 4. chat headline asks via the deterministic router (real data, no LLM needed)
chat(){ curl -fsk -X POST "$BE/api/chat" -H 'content-type: application/json' \
  -d "{\"message\":\"$1\",\"role\":\"${2:-Scheduler}\"}" 2>/dev/null; }
if chat "Which OB providers have openings?" | grep -qiE 'Obstetrics|Okonkwo|Stein|Rahman|open'; then
  pass "chat: OB provider openings (router)"; else fail "chat: OB provider openings"; fi
if chat "What's the no-show rate by provider?" | grep -qiE 'risk|%|no-show'; then
  pass "chat: no-show rate (router)"; else fail "chat: no-show rate"; fi
if chat "Put Dr. Brooks on PTO 7/14-7/18 and show the impact" | grep -qiE 'impact|conflict|coverage|reassign|Brooks'; then
  pass "chat: PTO impact + conflict (router)"; else fail "chat: PTO impact"; fi
# new P2 capabilities via chat
if chat "How can I cover the service for the next 90 days?" | grep -qiE 'coverage|High-Risk|gap|minimum'; then
  pass "chat: 90-day coverage (UC2)"; else fail "chat: coverage"; fi
if chat "Should we double-block Tuesday afternoons?" | grep -qiE 'double-block|no-show|template'; then
  pass "chat: template optimization (UC3)"; else fail "chat: template"; fi

# 5. frontend route serves the SPA
if [ -n "$FE_HOST" ] && curl -fsk "$FE/" | grep -qiE 'NYC|Workforce|<!doctype html>'; then pass "frontend SPA served"; else fail "frontend SPA"; fi

# 6. models (best-effort — rules fallback is acceptable)
READY="$(oc -n "$NS_AI" get inferenceservice -l demo=nychhc -o jsonpath='{range .items[*]}{.metadata.name}={.status.modelStatus.states.targetModelState}{"\n"}{end}' 2>/dev/null || true)"
[ -n "$READY" ] && info "models: $READY" || warn "no InferenceServices reported (rules fallback active)"

echo
if [ "$FAILS" -eq 0 ]; then ok "SMOKE PASSED"; else err "SMOKE FAILED ($FAILS check(s))"; fi
