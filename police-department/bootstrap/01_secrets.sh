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

# 5. KServe storage-initializer S3 creds (ONLY for pd-qwen25-vl-7b model
#    download). KServe storage-initializer does NOT honour AWS_SESSION_TOKEN,
#    so this MUST be a long-lived IAM user's access key (not SSO/STS).
#    Recommended: create a dedicated IAM user with S3 read on the data-lake
#    bucket only:
#      aws iam create-user --user-name pd-cctv-s3-reader
#      aws iam attach-user-policy --user-name pd-cctv-s3-reader \
#        --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
#      aws iam create-access-key --user-name pd-cctv-s3-reader
#    then export the access key as KSERVE_S3_AKID + KSERVE_S3_SECRET before
#    running this script. If those vars are empty, pd-qwen25-vl-7b will fail
#    to pull the model and the predictor pod will CrashLoopBackOff with
#    NoCredentialsError or InvalidAccessKeyId — see TROUBLESHOOTING.md §23.
if [ -n "${KSERVE_S3_AKID:-}" ] && [ -n "${KSERVE_S3_SECRET:-}" ]; then
  log_info "writing pd-kserve-s3-creds in $PD_NS_CCTV (long-lived IAM keys)"
  oc -n "$PD_NS_CCTV" create secret generic pd-kserve-s3-creds \
    --from-literal=AWS_ACCESS_KEY_ID="$KSERVE_S3_AKID" \
    --from-literal=AWS_SECRET_ACCESS_KEY="$KSERVE_S3_SECRET" \
    --dry-run=client -o yaml | oc apply --server-side --force-conflicts -f -
  oc -n "$PD_NS_CCTV" annotate secret pd-kserve-s3-creds \
    serving.kserve.io/s3-endpoint=s3.amazonaws.com \
    serving.kserve.io/s3-region="${AWS_REGION:-us-east-1}" \
    serving.kserve.io/s3-usehttps=1 \
    serving.kserve.io/s3-verifyssl=1 \
    --overwrite >/dev/null
else
  log_warn "KSERVE_S3_AKID / KSERVE_S3_SECRET unset — KServe storage-initializer"
  log_warn "will fail to pull pd-qwen25-vl-7b. See comment block above."
fi

# 6. HF token for model download (Job in 02_fetch_models reads this).
log_info "writing pd-hf-token in $PD_NS_CCTV"
upsert_secret pd-hf-token "$PD_NS_CCTV" "token=$HF_TOKEN"

# 6. Portkey key in pd-personas (optional — Portkey accepts unauthenticated calls
#    from in-cluster sources too; pass empty if unset).
log_info "writing pd-portkey-key in $PD_NS_PERSONAS"
upsert_secret pd-portkey-key "$PD_NS_PERSONAS" "api_key=${PORTKEY_API_KEY:-}"

log_ok "secrets done"
