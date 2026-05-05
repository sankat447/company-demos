#!/usr/bin/env bash
# =============================================================================
#  01_secrets.sh — populate the demo's Secrets in pd-cctv and pd-personas.
#
#  Reads from env (or copies from the platform's existing Secrets):
#    AURORA_HOST   (or autodiscovered from ai-demo/aurora-credentials)
#    AURORA_PASSWORD
#    HF_TOKEN
#    PORTKEY_API_KEY (optional)
#    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (or IRSA)
#
#  Idempotent — uses SSA so re-running just merges values into the
#  bootstrap-managed stub Secret manifests.
# =============================================================================
SCRIPT_NAME=01_secrets
DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/common.sh
source "$DIR/lib/common.sh"

banner "Police-Department demo — secrets"
require_cmd oc

# 1. Autodiscover AURORA_HOST + AURORA_PASSWORD from the platform's Secret if not set.
if [ -z "${AURORA_HOST:-}" ]; then
  AURORA_HOST=$(oc -n ai-demo get secret aurora-credentials -o jsonpath='{.data.endpoint}' 2>/dev/null | base64 --decode 2>/dev/null || true)
fi
if [ -z "${AURORA_PASSWORD:-}" ]; then
  AURORA_PASSWORD=$(oc -n ai-demo get secret aurora-credentials -o jsonpath='{.data.password}' 2>/dev/null | base64 --decode 2>/dev/null || true)
fi
require_env AURORA_HOST AURORA_PASSWORD HF_TOKEN

# 2. Ensure namespaces exist (the bootstrap Application creates them on first sync;
#    if we are running this BEFORE 03_apply_argocd we still want secrets ready).
oc create namespace "$PD_NS_CCTV"     --dry-run=client -o yaml | oc apply -f -
oc create namespace "$PD_NS_PERSONAS" --dry-run=client -o yaml | oc apply -f -

# 3. Aurora creds in pd-cctv (Tekton tasks) and pd-personas (FastAPI service).
for ns in "$PD_NS_CCTV" "$PD_NS_PERSONAS"; do
  log_info "writing pd-aurora-credentials in $ns"
  upsert_secret pd-aurora-credentials "$ns" \
    "endpoint=$AURORA_HOST" \
    "database=$PD_AURORA_DB" \
    "username=$PD_AURORA_USER" \
    "password=$AURORA_PASSWORD"
done

# 4. S3 creds in pd-cctv (S3 watcher + pull-clip + structure-and-write).
#    session_token is included so SSO/STS temporary credentials work; keep it
#    even if your AWS_SESSION_TOKEN is empty (long-lived IAM user) — the
#    consuming pods read it as optional.
log_info "writing pd-s3-creds in $PD_NS_CCTV"
upsert_secret pd-s3-creds "$PD_NS_CCTV" \
  "access_key_id=${AWS_ACCESS_KEY_ID:-}" \
  "secret_access_key=${AWS_SECRET_ACCESS_KEY:-}" \
  "session_token=${AWS_SESSION_TOKEN:-}" \
  "region=${AWS_REGION:-us-east-1}"

# 5. HF token for model download (Job in 02_fetch_models reads this).
log_info "writing pd-hf-token in $PD_NS_CCTV"
upsert_secret pd-hf-token "$PD_NS_CCTV" "token=$HF_TOKEN"

# 6. Portkey key in pd-personas (optional — Portkey accepts unauthenticated calls
#    from in-cluster sources too; pass empty if unset).
log_info "writing pd-portkey-key in $PD_NS_PERSONAS"
upsert_secret pd-portkey-key "$PD_NS_PERSONAS" "api_key=${PORTKEY_API_KEY:-}"

log_ok "secrets done"
