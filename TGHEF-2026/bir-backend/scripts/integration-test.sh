#!/usr/bin/env bash
# End-to-end integration test for the admin control plane (the surface that needs
# a real admin token). Bootstraps/loads a master admin, exercises every endpoint
# with assertions, and cleans up its own test data. Safe to run against the live
# stack — it only creates clearly-named TEST rows and deletes them.
#
#   ADMIN_USER=master ADMIN_PASS='<your-password>' bash scripts/integration-test.sh
#
# Requires: curl, python3. ADMIN_PASS min 8 chars.
set -uo pipefail
API="${API:-https://8pthvvvixg.execute-api.us-east-1.amazonaws.com/v1}"
U="${ADMIN_USER:-master}"
P="${ADMIN_PASS:?set ADMIN_PASS (min 8 chars)}"
PASS=0; FAIL=0
get() { python3 -c "import sys,json
try:
    d=json.load(sys.stdin); print(d$1)
except Exception:
    print('')"; }
ok() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 (got '$2' want '$3')"; fi; }
okc() { local h n; h=$(printf '%s' "$2" | tr -d '[:space:]'); n=$(printf '%s' "$3" | tr -d '[:space:]'); if printf '%s' "$h" | grep -qF "$n"; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 (missing '$3' in: $(echo "$2" | head -c 160))"; fi; }
api() { local m=$1 p=$2 b=${3:-}; curl -s -X "$m" "$API$p" -H "authorization: Bearer $TOK" -H 'content-type: application/json' ${b:+-d "$b"}; }

echo "=== bootstrap / login ==="
curl -s -X POST "$API/admin/auth/bootstrap" -H 'content-type: application/json' -d "{\"username\":\"$U\",\"name\":\"Master\",\"password\":\"$P\"}" >/dev/null
LOGIN=$(curl -s -X POST "$API/admin/auth/login" -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"$P\"}")
TOK=$(echo "$LOGIN" | get "['token']")
if [ -z "$TOK" ]; then echo "  ✗ login failed: $LOGIN"; exit 1; fi
echo "  ✓ logged in as $U"
okc "GET /admin/me tier 1" "$(api GET /admin/me)" '"tier": 1'

echo "=== identity bridge (Cognito users) ==="
UC=$(api POST /admin/users '{"phone":"9812340001","name":"IT Test","groups":["organiser-lite"]}')
okc "create user → sub" "$UC" '"sub"'
okc "list users includes it" "$(api GET /admin/users?group=organiser-lite)" '+919812340001'
okc "set groups" "$(api POST '/admin/users/+919812340001/groups' '{"groups":["volunteer"]}')" 'volunteer'
okc "delete user" "$(api DELETE '/admin/users/+919812340001')" '"deleted": true'

echo "=== vendor create provisions a real partner login ==="
VC=$(api POST /admin/stalls '{"stallName":"IT Test Stall","phone":"9812340002","feeInr":1000}')
VSUB=$(echo "$VC" | get "['id']")
okc "stall keyed on sub" "$VC" '"id"'
api DELETE "/admin/stalls/$VSUB" >/dev/null
api DELETE "/admin/users/+919812340002" >/dev/null
echo "  ✓ cleaned vendor + login"

echo "=== catalog authoring (additive — must NOT wipe the 17 seeded items) ==="
api POST /admin/catalog '{"title":"IT Test Comp","categoryId":"competitions","feeInr":123,"capacity":5,"gateChecked":true}' >/dev/null
LIVE=$(api GET /admin/catalog)
okc "test item present" "$LIVE" 'it-test-comp'
okc "seeded items still present (paragliding)" "$LIVE" 'paragliding'
api DELETE /admin/catalog/it-test-comp >/dev/null
echo "  ✓ cleaned catalog test item"

echo "=== gates ==="
okc "gate create" "$(api POST /admin/gates '{"label":"IT Gate"}')" 'gate:it-gate'
okc "checkpoints uses managed gate" "$(api GET /admin/checkpoints)" 'gate:it-gate'
api DELETE '/admin/gates/gate:it-gate' >/dev/null

echo "=== wristbands (child safety) ==="
okc "register band" "$(api POST /admin/wristbands '{"bandId":"IT-1","childName":"Test Kid","guardianPhone":"+919999999999"}')" 'IT-1'
okc "lookup returns guardian" "$(api GET /admin/wristbands/IT-1)" '919999999999'
api DELETE /admin/wristbands/IT-1 >/dev/null

echo "=== orders + refunds (manual settlement) ==="
okc "orders list" "$(api GET /admin/orders)" 'revenueInr'
okc "refunds list" "$(api GET /admin/refunds)" 'pending'

echo "=== pricing ==="
okc "items list" "$(api GET /admin/items)" 'paragliding'
okc "tier upsert" "$(api POST /admin/tiers '{"id":"it-tier","titleEn":"IT tier","priceInr":1}')" 'it-tier'
api DELETE /admin/tiers/it-tier >/dev/null

echo "=== audit log records actions ==="
okc "audit has our user.create" "$(api GET /admin/audit)" 'user.create'

echo "=== session revocation (create tier-4, disable, expect 401) ==="
api POST /admin/admins '{"username":"ittest4","name":"IT4","tier":4,"password":"itpass1234"}' >/dev/null
T4=$(curl -s -X POST "$API/admin/auth/login" -H 'content-type: application/json' -d '{"username":"ittest4","password":"itpass1234"}' | get "['token']")
okc "tier4 works while active" "$(curl -s "$API/admin/me" -H "authorization: Bearer $T4")" '"tier": 4'
api POST '/admin/admins/ittest4/active' '{"active":false}' >/dev/null
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/me" -H "authorization: Bearer $T4")
ok "disabled tier4 token → 401" "$CODE" "401"
api DELETE /admin/admins/ittest4 >/dev/null
echo "  ✓ cleaned test admin"

echo ""
echo "==================== $PASS passed, $FAIL failed ===================="
[ "$FAIL" -eq 0 ] && echo "ALL GREEN — admin control plane verified end-to-end." || echo "Some checks failed — see above."
exit $FAIL
