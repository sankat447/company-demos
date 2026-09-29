#!/usr/bin/env bash
# Cost estimate for the bir-backend stack — SCOPED to Project=bir-festival-2026.
#   ./cost-estimate.sh            → forward monthly estimate (assumptions below)
#   ./cost-estimate.sh --actual   → ACTUAL month-to-date from Cost Explorer,
#                                    filtered to the Project tag (this app only)
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# ── Festival-load assumptions (edit to taste) ────────────────────────────────
USERS=50000            # monthly active (Cognito)
GQL_OPS=3000000        # AppSync requests/month (festival week heavy)
LAMBDA_INVOCATIONS=2000000
DDB_WRITES=1500000
DDB_READS=4000000
S3_GB=5
CF_GB=50               # CloudFront egress (posters, media)

forward_estimate() {
  log "Forward monthly estimate — Project=${PROJECT_TAG} (us-east-1 on-demand prices)"
  awk -v users="$USERS" -v gql="$GQL_OPS" -v inv="$LAMBDA_INVOCATIONS" \
      -v w="$DDB_WRITES" -v r="$DDB_READS" -v s3="$S3_GB" -v cf="$CF_GB" 'BEGIN {
    # Cognito: first 50k MAU free (Essentials tier historically free to 50k)
    cognito = (users > 50000) ? (users-50000)*0.0055 : 0
    # AppSync: $4.00 per million query/mutation ops
    appsync = gql/1e6 * 4.00
    # Lambda: 128MB ~ $0.0000002083/req + $0.20/M requests; tiny at this size
    lambda = inv/1e6 * 0.20 + inv * 0.0000002083 * 0.1
    # DynamoDB on-demand: $1.25/M writes, $0.25/M reads + PITR ~ negligible at demo size
    ddb = w/1e6*1.25 + r/1e6*0.25 + 0.20
    # S3 standard: $0.023/GB + requests (approx)
    s3c = s3*0.023 + 0.50
    # CloudFront: ~$0.085/GB egress (first tier)
    cfc = cf*0.085
    # CloudWatch logs: small
    logs = 1.00
    total = cognito+appsync+lambda+ddb+s3c+cfc+logs
    printf "  %-22s $%8.2f\n", "Cognito (MAU)", cognito
    printf "  %-22s $%8.2f\n", "AppSync (GraphQL)", appsync
    printf "  %-22s $%8.2f\n", "Lambda", lambda
    printf "  %-22s $%8.2f\n", "DynamoDB (on-demand)", ddb
    printf "  %-22s $%8.2f\n", "S3", s3c
    printf "  %-22s $%8.2f\n", "CloudFront", cfc
    printf "  %-22s $%8.2f\n", "CloudWatch Logs", logs
    printf "  %-22s ---------\n", ""
    printf "  %-22s $%8.2f / month (festival load)\n", "ESTIMATED TOTAL", total
    printf "\n  IDLE (no traffic): ~$1-3/month — CloudFront + DDB PITR + logs only.\n"
    printf "  All services are serverless/pay-per-use: zero fixed compute cost.\n"
  }'
}

actual_from_cost_explorer() {
  log "Actual month-to-date — Cost Explorer filtered to Project=${PROJECT_TAG}"
  local start end
  start="$(date -u +%Y-%m-01)"
  end="$(date -u +%Y-%m-%d)"
  awscli ce get-cost-and-usage \
    --time-period "Start=${start},End=${end}" \
    --granularity MONTHLY --metrics UnblendedCost \
    --filter "{\"Tags\":{\"Key\":\"Project\",\"Values\":[\"${PROJECT_TAG}\"]}}" \
    --query 'ResultsByTime[0].Total.UnblendedCost' 2>/dev/null \
    || warn "Cost Explorer needs the tag active + ~24h of data. Tag scoping is the point: this returns ONLY this app's spend."
}

if [[ "${1:-}" == "--actual" ]]; then
  preflight
  actual_from_cost_explorer
else
  forward_estimate
fi
