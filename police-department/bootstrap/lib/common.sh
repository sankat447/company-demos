# shellcheck shell=bash
# =============================================================================
#  Shared helpers for bootstrap/*.sh
#  Sourced by every script: `source "$(dirname "$0")/lib/common.sh"`
# =============================================================================

# All scripts inherit these
set -euo pipefail

# ── Logging ─────────────────────────────────────────────────────────────────
_C_RED='\033[0;31m'; _C_GRN='\033[0;32m'; _C_YLW='\033[0;33m'
_C_BLU='\033[0;34m'; _C_BLD='\033[1m'; _C_RST='\033[0m'

log_info()  { printf "${_C_BLU}[%s]${_C_RST} %s\n" "${SCRIPT_NAME:-pd}" "$*" >&2; }
log_ok()    { printf "${_C_GRN}[%s] ✔${_C_RST} %s\n" "${SCRIPT_NAME:-pd}" "$*" >&2; }
log_warn()  { printf "${_C_YLW}[%s] ⚠${_C_RST} %s\n" "${SCRIPT_NAME:-pd}" "$*" >&2; }
log_err()   { printf "${_C_RED}[%s] ✖${_C_RST} %s\n" "${SCRIPT_NAME:-pd}" "$*" >&2; }
banner()    { printf "\n${_C_BLD}=== %s ===${_C_RST}\n\n" "$*" >&2; }

# ── Sanity ──────────────────────────────────────────────────────────────────
require_cmd() {
  local missing=()
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    log_err "missing required commands: ${missing[*]}"
    return 1
  fi
}

require_env() {
  local missing=()
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      missing+=("$v")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    log_err "missing required env vars: ${missing[*]}"
    return 1
  fi
}

# ── Cluster helpers ─────────────────────────────────────────────────────────
oc_ns_exists() {
  oc get ns "$1" >/dev/null 2>&1
}

oc_kind_exists() {
  oc get crd "$1" >/dev/null 2>&1
}

# Wait for an ArgoCD Application to reach Synced+Healthy. Args: name [ns=openshift-gitops] [timeout=600]
wait_for_app() {
  local name="$1"; local ns="${2:-openshift-gitops}"; local timeout="${3:-600}"
  local deadline; deadline=$(( $(date +%s) + timeout ))
  log_info "waiting for Application ${ns}/${name} to be Synced+Healthy (timeout=${timeout}s)"
  while :; do
    local sync health
    sync=$(oc -n "$ns" get application "$name" -o jsonpath='{.status.sync.status}' 2>/dev/null || echo "")
    health=$(oc -n "$ns" get application "$name" -o jsonpath='{.status.health.status}' 2>/dev/null || echo "")
    if [ "$sync" = "Synced" ] && [ "$health" = "Healthy" ]; then
      log_ok "${ns}/${name}: Synced + Healthy"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      log_err "${ns}/${name}: timed out (sync=${sync:-?} health=${health:-?})"
      return 1
    fi
    sleep 5
  done
}

# Apply a generated Secret idempotently via SSA. Args: name namespace [key=value...]
upsert_secret() {
  local name="$1"; local ns="$2"; shift 2
  local args=()
  for kv in "$@"; do
    args+=(--from-literal="$kv")
  done
  oc create secret generic "$name" -n "$ns" "${args[@]}" \
    --dry-run=client -o yaml \
    | oc apply --server-side --force-conflicts -f -
}

# ── Defaults ────────────────────────────────────────────────────────────────
: "${PD_REPO_URL:=https://github.com/sankat447/company-demos}"
: "${PD_BRANCH:=feature/police-department-v1}"
: "${PD_BUCKET:=ai-demo-data-lake}"
: "${PD_AURORA_DB:=rhoai_demo}"
: "${PD_AURORA_USER:=rhoai_admin}"
: "${PD_NS_CCTV:=pd-cctv}"
: "${PD_NS_PERSONAS:=pd-personas}"
