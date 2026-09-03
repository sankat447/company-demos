#!/usr/bin/env bash
# Turns terraform outputs into the mobile app's stack contract file.
# The ONLY place the two projects touch; the app validates the result.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

REST_BASE="${REST_BASE:-$(tfout payments_rest_base)}"
REST_BASE="${REST_BASE:-https://REPLACE.execute-api.${AWS_REGION}.amazonaws.com/v1}"

cat > "${MOBILE_DIR}/config/stack-outputs.json" <<JSON
{
  "region": "$(tfout region)",
  "auth": {
    "userPoolId": "$(tfout auth_user_pool_id)",
    "userPoolClientId": "$(tfout auth_user_pool_client_id)",
    "identityPoolId": "$(tfout auth_identity_pool_id)",
    "otpChannel": "sms"
  },
  "api": {
    "graphqlEndpoint": "$(tfout api_graphql_endpoint)",
    "graphqlRealtime": "$(tfout api_graphql_realtime)",
    "restBase": "${REST_BASE}"
  },
  "storage": {
    "mediaBucket": "$(tfout storage_media_bucket)",
    "cdnDomain": "$(tfout storage_cdn_domain)",
    "appDistBucket": "$(tfout storage_app_dist_bucket)",
    "appDistDomain": "$(tfout storage_app_dist_domain)"
  },
  "push": { "pinpointAppId": "REPLACE", "fcmSenderId": "REPLACE" },
  "ai": {
    "assistantPath": "/ai/assistant",
    "plannerPath": "/ai/planner",
    "translatePath": "/ai/translate",
    "queuePredictPath": "/ai/queue"
  },
  "payments": { "provider": "paytm", "orderPath": "/pay/order", "webhookVerified": true, "paytm": { "environment": "staging" } },
  "passes": {
    "issuerKid": "$(tfout passes_issuer_kid)",
    "jwksPath": "/.well-known/bir-passes/jwks.json",
    "alg": "ES256"
  },
  "realtime": { "alertTopicArnParam": "/bir/sns/emergency" },
  "geo": { "geofenceCollection": "bir-venues", "shuttleTrackerName": "bir-shuttles" },
  "flags": { "festivalMode": true, "experiencesMarketplace": true },
  "highlights": { "catalogPath": "https://$(tfout storage_cdn_domain)/config/highlights/catalog.json" }
}
JSON

ok "Wrote ${MOBILE_DIR}/config/stack-outputs.json"
if ( cd "$MOBILE_DIR" && node scripts/contract-check.mjs >/dev/null 2>&1 ); then
  ok "Contract validates against the app schema"
else
  warn "Contract did not validate — run: cd ../bir-mobile && npm run contract:check"
fi
