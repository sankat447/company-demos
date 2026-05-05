#!/usr/bin/env bash
# =============================================================================
#  99_teardown.sh — remove the demo, leaving the platform untouched.
#
#  Idempotent. Steps:
#    1. Delete the bootstrap Application (ArgoCD prune cascades to children
#       and pd-cctv/pd-personas namespaces).
#    2. Optionally drop the pd_cctv schema (prompts y/N; default no).
#    3. Optionally remove sample clips from S3 (prompts y/N; default no).
# =============================================================================
SCRIPT_NAME=99_teardown
DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/common.sh
source "$DIR/lib/common.sh"

banner "Police-Department demo — TEARDOWN"
require_cmd oc

log_info "deleting ArgoCD bootstrap Application (prune cascades to children)..."
oc -n openshift-gitops delete application pd-bootstrap --ignore-not-found=true

log_info "waiting up to 5 min for ns pd-cctv / pd-personas to disappear..."
deadline=$(( $(date +%s) + 300 ))
while :; do
  pd_cctv_gone=true; pd_personas_gone=true
  oc_ns_exists pd-cctv     && pd_cctv_gone=false
  oc_ns_exists pd-personas && pd_personas_gone=false
  [ "$pd_cctv_gone" = "true" ] && [ "$pd_personas_gone" = "true" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && { log_warn "namespaces still present after 5min — proceeding anyway"; break; }
  sleep 10
done

# Optional schema drop
if [ "${PD_DROP_SCHEMA:-}" = "yes" ]; then
  ans="y"
else
  printf "Drop pd_cctv SCHEMA from Aurora (irreversible)? [y/N] " >&2
  read -r ans
fi
if [ "${ans,,}" = "y" ] || [ "${ans,,}" = "yes" ]; then
  log_info "dropping pd_cctv schema..."
  PG_HOST=$(oc -n ai-demo get secret aurora-credentials -o jsonpath='{.data.endpoint}' | base64 --decode 2>/dev/null || true)
  PG_PASS=$(oc -n ai-demo get secret aurora-credentials -o jsonpath='{.data.password}' | base64 --decode 2>/dev/null || true)
  if [ -n "$PG_HOST" ] && [ -n "$PG_PASS" ] && command -v psql >/dev/null 2>&1; then
    PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -U "$PD_AURORA_USER" -d "$PD_AURORA_DB" \
      -c "DROP SCHEMA IF EXISTS pd_cctv CASCADE;"
    log_ok "schema dropped"
  else
    log_warn "psql unavailable or aurora-credentials missing; skipping schema drop"
  fi
fi

# Optional S3 cleanup — three demo prefixes need to be cleared for a full
# rollback to the ai-demo-stack-aws baseline. Each is prompted independently
# (or auto-confirmed via PD_S3_CLEANUP=yes).
prompt_or_auto() {
  local prefix="$1"
  if [ "${PD_S3_CLEANUP:-}" = "yes" ]; then
    echo "y"
    return
  fi
  printf "Delete s3://%s/%s ? [y/N] " "$PD_BUCKET" "$prefix" >&2
  read -r reply
  echo "$reply"
}

for prefix in "clips/police-department/" "processed/police-department/" "models/police-department/"; do
  ans=$(prompt_or_auto "$prefix")
  if [ "${ans,,}" = "y" ] || [ "${ans,,}" = "yes" ]; then
    log_info "deleting s3://$PD_BUCKET/$prefix ..."
    aws s3 rm "s3://$PD_BUCKET/$prefix" --recursive 2>&1 || log_warn "S3 cleanup failed for $prefix"
  else
    log_info "skipped s3://$PD_BUCKET/$prefix (still present in bucket)"
  fi
done

log_ok "teardown complete; the ai-demo platform is untouched."
