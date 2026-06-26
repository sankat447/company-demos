#!/usr/bin/env bash
# =============================================================================
#  Amboy NPI-Safe demo — DESTROY (scoped, label-guarded)
#
#  Deletes ONLY demo-owned objects. The shared iis-ai-* namespaces and platform
#  services are NEVER touched — teardown is by the `demo=amboy` label + the
#  ArgoCD Application's cascade finalizer.
#
#  Usage: ./destroy.sh    (type 'destroy-amboy' to confirm)
# =============================================================================
set -euo pipefail
DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info(){ echo -e "  ${CYAN}➤${RESET} $*"; }
err(){  echo -e "  ${RED}✘${RESET} $*" >&2; exit 1; }

command -v oc >/dev/null 2>&1 || err "oc not on PATH"
oc whoami >/dev/null 2>&1 || err "not authenticated"
NS_LIST="iis-ai-ai iis-ai-ui iis-ai-data iis-ai-system"

echo -e "${RED}${BOLD}This deletes the Amboy demo from $(oc whoami --show-server).${RESET}"
echo "  (shared iis-ai-* namespaces and platform services are left intact)"
read -r -p "Type 'destroy-amboy' to confirm: " c
[ "$c" = "destroy-amboy" ] || err "aborted"

# ── 1. remove the ArgoCD Application (finalizer cascade-prunes all children) ──
info "removing ArgoCD Application amboy-demo (cascade prune)…"
oc -n openshift-gitops delete application amboy-demo --ignore-not-found --wait=true --timeout=180s 2>/dev/null || true

# ── 2. label-sweep any stragglers across the shared tiers (NEVER the namespace) ─
info "label-sweeping demo=amboy resources across: $NS_LIST"
KINDS="deployment service route job configmap serviceaccount rolebinding role buildconfig imagestream secret pvc inferenceservice"
# DSP Pipeline Server (the operator GC's its child pods/svcs when the DSPA is removed).
oc -n iis-ai-ai delete datasciencepipelinesapplication -l demo=amboy --ignore-not-found --wait=false 2>/dev/null || true
for ns in $NS_LIST; do
  for k in $KINDS; do
    oc -n "$ns" delete "$k" -l demo=amboy --ignore-not-found --wait=false 2>/dev/null || true
  done
done
# amboy-creds carries no demo label (out-of-band) — remove it explicitly.
for ns in $NS_LIST; do oc -n "$ns" delete secret amboy-creds --ignore-not-found 2>/dev/null || true; done

# ── 2b. OpenShift AI dashboard launcher tile (lives in the dashboard's namespace) ─
info "removing OpenShift AI Applications tile (redhat-ods-applications)"
oc -n redhat-ods-applications delete odhapplication,configmap -l demo=amboy --ignore-not-found 2>/dev/null || true

# ── 2c. OpenShift Pipelines (Tekton) resources — FQN (pipeline name is ambiguous) ─
info "removing Tekton pipelines/tasks/runs (demo=amboy)"
oc -n iis-ai-ai delete pipelineruns.tekton.dev,pipelines.tekton.dev,tasks.tekton.dev \
  -l demo=amboy --ignore-not-found --wait=false 2>/dev/null || true

# ── 3. clear any stuck PVC finalizers (none expected; demo uses no PVCs) ─────
for ns in $NS_LIST; do
  for pvc in $(oc -n "$ns" get pvc -l demo=amboy -o name 2>/dev/null); do
    oc -n "$ns" patch "$pvc" -p '{"metadata":{"finalizers":null}}' --type=merge 2>/dev/null || true
  done
done

cat <<EOF

${GREEN}${BOLD}AMBOY TORN DOWN.${RESET}
  - ArgoCD Application + all demo=amboy resources removed across the four tiers.
  - DSP Pipeline Server (amboy-dsp) + OpenShift AI Applications tile removed.
  - Shared namespaces + platform services untouched.
  - NOTE: amboy schema/tokens persist in Postgres (schema 'amboy') and MinIO
    buckets remain (incl. amboy-pipelines artifacts). To purge demo data:
      oc -n iis-ai-data exec deploy/iis-ai-postgres -- \\
        psql -U rhoai_admin rhoai_demo -c 'DROP SCHEMA IF EXISTS amboy CASCADE;'
EOF
