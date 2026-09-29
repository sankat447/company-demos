#!/usr/bin/env bash
# Shared helpers for the bir-backend deploy/destroy/seed/cost scripts.
# FOR DEMONSTRATION — SYNTHETIC DATA. Standalone app; touches no other project.
set -euo pipefail

# ── Config (override via env) ────────────────────────────────────────────────
export AWS_PROFILE="${AWS_PROFILE:-rhoai-demo}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"

# Ownership tag — the ONE key that scopes every deploy/destroy/cost action to
# THIS app. Must match provider default_tags in terraform/versions.tf.
PROJECT_TAG="bir-festival-2026"

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${BACKEND_DIR}/terraform"
MOBILE_DIR="$(cd "${BACKEND_DIR}/.." && pwd)/bir-mobile"

# ── Logging ──────────────────────────────────────────────────────────────────
c_blue=$'\033[34m'; c_grn=$'\033[32m'; c_red=$'\033[31m'; c_yel=$'\033[33m'; c_rst=$'\033[0m'
log()  { echo "${c_blue}▶ $*${c_rst}"; }
ok()   { echo "${c_grn}✔ $*${c_rst}"; }
warn() { echo "${c_yel}⚠ $*${c_rst}"; }
die()  { echo "${c_red}✘ $*${c_rst}" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }

# ── Preflight: tools + AWS SSO (the script owns the login) ───────────────────
preflight() {
  log "Preflight: tools + AWS auth"
  for t in aws terraform jq openssl; do need "$t"; done
  if ! aws sts get-caller-identity --profile "$AWS_PROFILE" >/dev/null 2>&1; then
    log "AWS SSO session missing/expired — launching login for profile '$AWS_PROFILE'"
    aws sso login --profile "$AWS_PROFILE"
    aws sts get-caller-identity --profile "$AWS_PROFILE" >/dev/null 2>&1 \
      || die "AWS SSO login did not complete"
  fi
  local acct; acct="$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)"
  ok "Preflight passed (account $acct, region $AWS_REGION, profile $AWS_PROFILE)"
}

awscli() { aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"; }
tf()     { terraform -chdir="$TF_DIR" "$@"; }
tfout()  { terraform -chdir="$TF_DIR" output -raw "$1" 2>/dev/null; }
