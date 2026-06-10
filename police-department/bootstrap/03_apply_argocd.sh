#!/usr/bin/env bash
# =============================================================================
#  03_apply_argocd.sh — the ONLY mutating step in the bootstrap chain.
#
#  Applies argocd/bootstrap-application.yaml and waits for all 7 child
#  Applications to reach Synced + Healthy (15-min total budget).
# =============================================================================
SCRIPT_NAME=03_apply_argocd
DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/common.sh
source "$DIR/lib/common.sh"

banner "Police-Department demo — apply ArgoCD bootstrap"
require_cmd oc

ROOT="$(cd "$DIR/.." && pwd)"
oc apply -f "$ROOT/argocd/bootstrap-application.yaml"

log_info "letting ArgoCD pull and create child Applications..."
sleep 8

# In dependency order. wait_for_app uses oc get application from openshift-gitops ns.
for app in pd-namespaces pd-aurora-schema pd-inference pd-pipeline pd-personas pd-hitl pd-monitoring; do
  wait_for_app "$app" openshift-gitops 600
done

log_ok "all police-department Applications are Synced + Healthy"
log_info "next: bash bootstrap/04_seed_samples.sh"
