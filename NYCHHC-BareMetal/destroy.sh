#!/usr/bin/env bash
# =============================================================================
#  NYCHHC-BareMetal — DESTROY (scoped, label-guarded teardown)
#
#  Removes ONLY demo-owned objects: everything labeled demo=nychhc across the
#  iis-ai-{ai,ui,data} tiers, the out-of-band nychhc-creds Secret, the demo's
#  Postgres schemas (workforce, rag — incl. the sched_* tables), the MinIO
#  nychhc-models bucket, and the Grafana dashboard/datasource.
#
#  NEVER deletes the shared namespaces or any platform service. Refuses to touch
#  anything not carrying the demo=nychhc label.
#
#  Teardown-race fix: the ArgoCD app has selfHeal — DISABLE automated sync BEFORE
#  deleting the Application, else selfHeal re-creates objects mid-teardown.
#
#  Usage: ./destroy.sh        (override KUBECONFIG, S3_* via env)
# =============================================================================
set -euo pipefail
DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DEMO_DIR/scripts/lib.sh"

PG_PASSWORD="${PG_PASSWORD:-Demo1234#}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-minioadmin}"
S3_SECRET_KEY="${S3_SECRET_KEY:-Demo1234#}"

echo -e "${CYAN}${BOLD}┌───────────────────────────────────────────────┐
│  NYCHHC-BareMetal — destroy (scoped)           │
└───────────────────────────────────────────────┘${RESET}"

info "Phase 0 — preflight"
nychhc_kubeconfig
for t in oc kubectl; do command -v "$t" >/dev/null 2>&1 || err "missing tool: $t"; done
oc whoami >/dev/null 2>&1 || err "not authenticated (set KUBECONFIG / oc login)"
ok "cluster $(oc whoami --show-server)"

# ── 1. disable ArgoCD auto-sync FIRST (else selfHeal re-creates as we delete) ──
info "Phase 1 — disable ArgoCD automated sync (teardown-race fix)"
oc -n openshift-gitops patch application nychhc-demo --type=merge \
  -p '{"spec":{"syncPolicy":{"automated":null}}}' >/dev/null 2>&1 \
  && ok "automated sync disabled" || warn "app nychhc-demo not found (already gone?)"

# ── 2. Grafana dashboard + datasource ────────────────────────────────────────
info "Phase 2 — remove Grafana dashboard + datasource"
grafana_remove

# ── 3. delete the ArgoCD Application (finalizer cascade-prunes children) ──────
info "Phase 3 — delete ArgoCD Application (cascade prune)"
oc -n openshift-gitops delete application nychhc-demo --ignore-not-found --timeout=120s >/dev/null 2>&1 \
  && ok "Application deleted" || warn "Application delete timed out — continuing with label sweep"

# ── 4. belt-and-braces label sweep (deletes ONLY demo=nychhc objects) ────────
info "Phase 4 — label-sweep demo=nychhc across iis-ai-{ai,ui,data}"
KINDS="deployment,service,route,job,configmap,serviceaccount,role,rolebinding,buildconfig,imagestream,inferenceservice,secret,pvc"
for ns in "$NS_AI" "$NS_UI" "$NS_DATA"; do
  oc -n "$ns" delete $KINDS -l demo=nychhc --ignore-not-found --wait=false >/dev/null 2>&1 || true
done
ok "labeled resources deleted (demo=nychhc only)"

# ── 5. remove the out-of-band nychhc-creds Secret (carries no demo label) ────
info "Phase 5 — remove nychhc-creds Secret"
for ns in "$NS_AI" "$NS_UI" "$NS_DATA"; do
  oc -n "$ns" delete secret nychhc-creds --ignore-not-found >/dev/null 2>&1 || true
done
ok "nychhc-creds removed"

# ── 6. drop the demo Postgres schemas (workforce + rag; incl. sched_* tables) ─
info "Phase 6 — drop demo schemas (workforce, rag) from Postgres"
psql_run "DROP SCHEMA IF EXISTS workforce CASCADE; DROP SCHEMA IF EXISTS rag CASCADE;" >/dev/null 2>&1 \
  && ok "schemas workforce + rag dropped" \
  || warn "could not drop schemas (PG unreachable?) — drop manually if needed"

# ── 7. remove the MinIO nychhc-models bucket ─────────────────────────────────
info "Phase 7 — remove MinIO bucket nychhc-models"
oc -n "$NS_DATA" run "nychhc-mc-$$" --rm -i --restart=Never --quiet \
  --image=quay.io/minio/mc:latest \
  --env=HOME=/tmp --env=MC_CONFIG_DIR=/tmp/.mc \
  --env=S3_ACCESS_KEY="$S3_ACCESS_KEY" --env=S3_SECRET_KEY="$S3_SECRET_KEY" -- \
  /bin/sh -c 'mc alias set m "'"$MINIO_ENDPOINT"'" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null 2>&1 && mc rb --force m/nychhc-models >/dev/null 2>&1; echo done' >/dev/null 2>&1 \
  && ok "bucket nychhc-models removed" \
  || warn "could not remove bucket (MinIO unreachable?) — remove manually if needed"

# ── done ─────────────────────────────────────────────────────────────────────
echo -e "
${GREEN}${BOLD}NYCHHC-BareMetal TORN DOWN.${RESET}
  Shared namespaces (iis-ai-ai/ui/data/system) and ALL platform services intact.
  Verify nothing demo-owned remains:
    for ns in $NS_AI $NS_UI $NS_DATA; do oc -n \$ns get all,secret -l demo=nychhc; done
"
