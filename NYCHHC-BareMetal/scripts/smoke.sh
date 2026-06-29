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
if curl -fsk "$BE/api/sched/specialties" | grep -qi 'Cardiology'; then pass "specialties include Cardiology"; else fail "specialties"; fi
if curl -fsk "$BE/api/sched/doctors?specialty=Cardiology" | grep -qiE 'Patel|Sokolova'; then pass "Cardiology roster (Patel/Sokolova)"; else fail "Cardiology doctors"; fi

# 4. chat headline asks via the deterministic router (real data, no LLM needed)
chat(){ curl -fsk -X POST "$BE/api/chat" -H 'content-type: application/json' \
  -d "{\"message\":\"$1\",\"role\":\"${2:-Scheduler}\"}" 2>/dev/null; }
if chat "Which cardiologists have openings?" | grep -qiE 'Cardiology|Patel|Sokolova|open'; then
  pass "chat: cardiologist openings (router)"; else fail "chat: cardiologist openings"; fi
if chat "What's the no-show rate by provider?" | grep -qiE 'risk|%|no-show'; then
  pass "chat: no-show rate (router)"; else fail "chat: no-show rate"; fi
if chat "Put Dr. Tanaka on PTO 6/16-6/20 and show the impact" | grep -qiE 'impact|appointment|reassign|Tanaka'; then
  pass "chat: PTO impact (router)"; else fail "chat: PTO impact"; fi

# 5. frontend route serves the SPA
if [ -n "$FE_HOST" ] && curl -fsk "$FE/" | grep -qiE 'NYC|Workforce|<!doctype html>'; then pass "frontend SPA served"; else fail "frontend SPA"; fi

# 6. models (best-effort — rules fallback is acceptable)
READY="$(oc -n "$NS_AI" get inferenceservice -l demo=nychhc -o jsonpath='{range .items[*]}{.metadata.name}={.status.modelStatus.states.targetModelState}{"\n"}{end}' 2>/dev/null || true)"
[ -n "$READY" ] && info "models: $READY" || warn "no InferenceServices reported (rules fallback active)"

echo
if [ "$FAILS" -eq 0 ]; then ok "SMOKE PASSED"; else err "SMOKE FAILED ($FAILS check(s))"; fi
