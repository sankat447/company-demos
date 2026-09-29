#!/usr/bin/env bash
# =============================================================================
#  Bir Festival 2026 backend — DEPLOY
#  Provisions ONLY objects owned by this app (tag Project=bir-festival-2026):
#  Cognito, AppSync, DynamoDB, S3, CloudFront, Lambda, SSM. Generates the ES256
#  pass key + JWKS, wires the mobile stack contract, and seeds test data.
#  Idempotent; safe to re-run. Pairs with destroy.sh (tag-scoped teardown).
#  Touches NO other company-demos project (local state + isolated tags).
# =============================================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib.sh"

preflight

# ── 1. Terraform apply (all AWS objects) ─────────────────────────────────────
log "Terraform init + apply"
tf init -input=false >/dev/null
tf apply -auto-approve -input=false -var "aws_profile=${AWS_PROFILE}" -var "aws_region=${AWS_REGION}"
ok "Infrastructure provisioned"

# ── 2. Generate the ES256 signing key + publish the JWKS ─────────────────────
# The private key lives ONLY in SSM SecureString; the public JWKS goes to the
# media bucket so the app verifies passes OFFLINE. Regenerated only if absent.
KEY_PARAM="$(tfout pass_private_key_param)"
MEDIA="$(tfout storage_media_bucket)"
CUR="$(awscli ssm get-parameter --name "$KEY_PARAM" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || echo "")"
if [[ "$CUR" == "PLACEHOLDER_ROTATE_ON_DEPLOY" || -z "$CUR" ]]; then
  log "Generating ES256 (P-256) issuer key + JWKS"
  mkdir -p "${TF_DIR}/.build"
  openssl ecparam -name prime256v1 -genkey -noout -out "${TF_DIR}/.build/priv.pem"
  # Real key into SSM (never git, never returned by any API).
  awscli ssm put-parameter --name "$KEY_PARAM" --type SecureString \
    --value "file://${TF_DIR}/.build/priv.pem" --overwrite >/dev/null
  # Public JWKS (kid must match the app's passes.issuerKid).
  node "${BACKEND_DIR}/scripts/jwks-from-pem.mjs" "${TF_DIR}/.build/priv.pem" "$(tfout passes_issuer_kid)" \
    > "${TF_DIR}/.build/jwks.json"
  rm -f "${TF_DIR}/.build/priv.pem"   # key stays only in SSM
  ok "Signing key stored in SSM; JWKS built"
else
  ok "Signing key already present in SSM (reusing)"
fi

# ── 3. Wire the mobile stack contract ────────────────────────────────────────
log "Emit mobile stack-outputs.json + validate"
bash "${BACKEND_DIR}/scripts/emit-stack-outputs.sh"

# ── 4. Seed synthetic test data + publish JWKS ───────────────────────────────
log "Seed test data"
bash "${BACKEND_DIR}/scripts/seed-test-data.sh"

# ── 5. Smoke test ────────────────────────────────────────────────────────────
log "Smoke test: invoke the health Lambda"
awscli lambda invoke --function-name "$(tfout health_function_name)" \
  --cli-binary-format raw-in-base64-out --payload '{}' /tmp/bir-health.json >/dev/null 2>&1 \
  && { ok "health: $(cat /tmp/bir-health.json)"; } \
  || warn "health invoke skipped (check console)"

cat <<EOF

${c_grn}Bir Festival 2026 backend deployed.${c_rst}
  Account/Region:  $(tfout account_id) / $(tfout region)
  GraphQL:         $(tfout api_graphql_endpoint)
  User Pool:       $(tfout auth_user_pool_id)
  DynamoDB:        $(tfout dynamodb_table)
  Media/CDN:       $(tfout storage_cdn_domain)
  Contract:        ../bir-mobile/config/stack-outputs.json  (validated)
  Cost estimate:   ./scripts/cost-estimate.sh
  Teardown:        ./destroy.sh   (removes ONLY Project=bir-festival-2026)
EOF
