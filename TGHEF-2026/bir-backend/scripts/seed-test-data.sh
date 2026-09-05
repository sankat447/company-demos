#!/usr/bin/env bash
# Seeds synthetic test data into the deployed DynamoDB table + publishes the
# JWKS. Idempotent. All data is festival-2026 demo content.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

TABLE="$(tfout dynamodb_table)"
MEDIA="$(tfout storage_media_bucket)"
[[ -n "$TABLE" ]] || die "no dynamodb table output — deploy first"

put() { awscli dynamodb put-item --table-name "$TABLE" --item "$1" >/dev/null; }

log "Seeding ticket tiers"
put '{"pk":{"S":"TIER"},"sk":{"S":"day-pass"},"titleEn":{"S":"Day pass"},"titleHi":{"S":"दिन का पास"},"priceInr":{"N":"499"}}'
put '{"pk":{"S":"TIER"},"sk":{"S":"3day-pass"},"titleEn":{"S":"3-Day pass"},"titleHi":{"S":"3-दिन का पास"},"priceInr":{"N":"1199"}}'

log "Seeding cultural-night schedule (21–23 Nov)"
put '{"pk":{"S":"SCHEDULE"},"sk":{"S":"2026-11-21#folk"},"day":{"S":"2026-11-21"},"venue":{"S":"Chogan Ground"},"titleEn":{"S":"Folk music of Kangra"},"titleHi":{"S":"कांगड़ा का लोक संगीत"},"startsAt":{"N":"1795284000"}}'
put '{"pk":{"S":"SCHEDULE"},"sk":{"S":"2026-11-23#awards"},"day":{"S":"2026-11-23"},"venue":{"S":"Chogan Ground"},"titleEn":{"S":"Award ceremony"},"titleHi":{"S":"पुरस्कार समारोह"},"startsAt":{"N":"1795462200"}}'

log "Seeding fly-status (flying)"
put '{"pk":{"S":"FLYSTATUS"},"sk":{"S":"current"},"state":{"S":"flying"},"reasonEn":{"S":"Clear skies over Billing"},"reasonHi":{"S":"बिलिंग के ऊपर साफ़ आसमान"},"updatedAt":{"N":"1795248000"},"refundsAutoQueued":{"BOOL":false}}'

log "Seeding sample confirmed competition registrations (lodging pool)"
put '{"pk":{"S":"REG"},"sk":{"S":"reg:p1:him-queen-2026:na"},"name":{"S":"Anita Thakur"},"competitionId":{"S":"him-queen-2026"},"gender":{"S":"female"},"nights":{"L":[{"S":"2026-11-21"},{"S":"2026-11-22"},{"S":"2026-11-23"}]},"needsLodging":{"BOOL":true},"status":{"S":"confirmed"}}'
put '{"pk":{"S":"REG"},"sk":{"S":"reg:p4:him-prince-2026:na"},"name":{"S":"Rohan Katoch"},"competitionId":{"S":"him-prince-2026"},"gender":{"S":"male"},"nights":{"L":[{"S":"2026-11-22"},{"S":"2026-11-23"}]},"needsLodging":{"BOOL":true},"status":{"S":"confirmed"}}'

log "Seeding a demo revocation (B6) — the offline verifier rejects this jti"
put '{"pk":{"S":"REV#demo-revoked-jti"},"sk":{"S":"REV"},"jti":{"S":"demo-revoked-jti"},"revokedAt":{"N":"1795000000"},"gsi1pk":{"S":"REVOCATION"},"gsi1sk":{"S":"1795000000"}}'

log "Seeding volunteer roster (B3)"
# The roster is keyed by the volunteer's Cognito sub (VOL#<sub>). For a live
# smoke test, set VOL_TEST_SUB to a real volunteer-group user's sub so their
# app shows this profile; otherwise a placeholder id is used for structure.
VOL_SUB="${VOL_TEST_SUB:-vol-demo-1}"
put '{"pk":{"S":"VOL"},"sk":{"S":"'"$VOL_SUB"'"},"sub":{"S":"'"$VOL_SUB"'"},"name":{"S":"Tenzin Dorje"},"team":{"S":"Gate & Access"},"idVerified":{"BOOL":true},"shifts":{"L":[{"M":{"id":{"S":"sh-21-gateA"},"date":{"S":"2026-11-21"},"zone":{"S":"Chogan Gate A"},"role":{"S":"Scanner"},"startsAtSec":{"N":"1795233600"},"endsAtSec":{"N":"1795262400"}}},{"M":{"id":{"S":"sh-22-landing"},"date":{"S":"2026-11-22"},"zone":{"S":"Bir Landing"},"role":{"S":"Crowd steward"},"startsAtSec":{"N":"1795320000"},"endsAtSec":{"N":"1795348800"}}}]}}'
ok "volunteer roster seeded (sub=$VOL_SUB)"

log "Seeding partner consoles (B4) — keyed by the partner's Cognito sub"
# Uses the same test principal as the roster (add it to the 'partner' group for a
# live smoke test). analytics / allocations are native lists → AWSJSON on output.
PARTNER_SUB="${PARTNER_TEST_SUB:-$VOL_SUB}"
put '{"pk":{"S":"STALL"},"sk":{"S":"'"$PARTNER_SUB"'"},"stallName":{"S":"Kangra Kitchen"},"category":{"S":"Local food · siddu & dham"},"stage":{"S":"approved"},"allocationLabel":{"S":"Food Street · Stall F-12"},"feeInr":{"N":"3500"},"paid":{"BOOL":false},"analytics":{"L":[{"M":{"day":{"S":"2026-11-21"},"ordersEstimate":{"N":"220"},"footfallIndex":{"N":"78"}}},{"M":{"day":{"S":"2026-11-22"},"ordersEstimate":{"N":"310"},"footfallIndex":{"N":"91"}}},{"M":{"day":{"S":"2026-11-23"},"ordersEstimate":{"N":"265"},"footfallIndex":{"N":"84"}}}]},"rules":{"L":[{"S":"Single-use plastic is prohibited across the food street."},{"S":"Serve on deposit-return cups and plates only."}]},"rulesHi":{"L":[{"S":"फ़ूड स्ट्रीट पर एकल-उपयोग प्लास्टिक निषिद्ध है।"},{"S":"केवल डिपॉज़िट-रिटर्न कप और प्लेट में परोसें।"}]}}'
put '{"pk":{"S":"HOSP"},"sk":{"S":"'"$PARTNER_SUB"'"},"hotelName":{"S":"Deodar Homestay"},"tier":{"S":"11+ rooms → two complimentary twin-sharing rooms, two nights"},"complimentaryRooms":{"N":"2"},"allocations":{"L":[{"M":{"regId":{"S":"reg:p1:him-queen-2026:na"},"guestName":{"S":"Anita Thakur"},"roomLabel":{"S":"Deodar Cottage 2"},"nights":{"L":[{"S":"2026-11-21"},{"S":"2026-11-22"},{"S":"2026-11-23"}]},"checkedIn":{"BOOL":false}}},{"M":{"regId":{"S":"reg:p6:chef-local:na"},"guestName":{"S":"Karan Verma"},"roomLabel":{"S":"Pine Suite"},"nights":{"L":[{"S":"2026-11-20"},{"S":"2026-11-21"}]},"checkedIn":{"BOOL":true}}}]}}'
ok "partner consoles seeded (sub=$PARTNER_SUB)"

log "Seeding room inventory (source of truth for commit-allocation re-validation)"
TABLE="$TABLE" AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" \
  node "${BACKEND_DIR}/scripts/seed-rooms.mjs" && ok "rooms seeded" || warn "room seed failed"

log "Publishing JWKS to the media bucket"
if [[ -f "${TF_DIR}/.build/jwks.json" ]]; then
  awscli s3 cp "${TF_DIR}/.build/jwks.json" "s3://${MEDIA}/.well-known/bir-passes/jwks.json" \
    --content-type application/json >/dev/null
  ok "JWKS published"
else
  warn "JWKS not generated yet (deploy.sh generates it) — skipping"
fi

# B1: the server-driven Highlights catalog. Public via CloudFront (/config/*);
# the app fetches it (highlights.catalogPath) when flags.mockHighlights is off.
log "Publishing Highlights catalog to the media CDN"
CATALOG="${BACKEND_DIR}/data/highlights-catalog.json"
if [[ -f "$CATALOG" ]]; then
  awscli s3 cp "$CATALOG" "s3://${MEDIA}/config/highlights/catalog.json" \
    --content-type application/json >/dev/null
  ok "Highlights catalog published (config/highlights/catalog.json)"
else
  warn "Highlights catalog missing: $CATALOG — skipping"
fi

ok "Test data seeded into $TABLE"
