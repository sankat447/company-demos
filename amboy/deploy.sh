#!/usr/bin/env bash
# =============================================================================
#  Amboy NPI-Safe demo — DEPLOY (on top of the ai-demo-stack-BAREMETAL platform)
#
#  Scoped + idempotent. Creates ONLY demo-owned objects on an already-running
#  OCP 4.21 cluster (ocp419.crucible.iisl.com): out-of-band Secrets, an in-cluster
#  image build (internal registry — NO ECR), seeds synthetic reports into MinIO,
#  and the demo's standalone ArgoCD Application. Reuses platform services
#  (postgres+pgvector, minio, portkey, vault, keycloak, mlflow, n8n, grafana).
#
#  Usage:   ./deploy.sh
#  Override: KUBECONFIG, GIT_REVISION, PORTKEY_API_KEY, *_PASSWORD via env.
#  Pairs with destroy.sh (scoped, label-guarded teardown).
# =============================================================================
set -euo pipefail
DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'
info(){ echo -e "  ${CYAN}➤${RESET} $*"; }
ok(){   echo -e "  ${GREEN}✔${RESET} $*"; }
warn(){ echo -e "  ${YELLOW}⚠${RESET} $*"; }
err(){  echo -e "  ${RED}✘${RESET} $*" >&2; exit 1; }

NS_AI=iis-ai-ai; NS_UI=iis-ai-ui; NS_DATA=iis-ai-data; NS_SYS=iis-ai-system
GIT_REVISION="${GIT_REVISION:-sanjeev-dev}"
# Demo creds (match the baremetal platform defaults; override via env for real use).
PG_PASSWORD="${PG_PASSWORD:-Demo1234#}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-minioadmin}"
S3_SECRET_KEY="${S3_SECRET_KEY:-Demo1234#}"
VAULT_TOKEN="${VAULT_TOKEN:-Demo1234#}"
PORTKEY_API_KEY="${PORTKEY_API_KEY:-}"

echo -e "${CYAN}${BOLD}┌───────────────────────────────────────────────┐
│  Amboy NPI-Safe demo — deploy (baremetal)      │
└───────────────────────────────────────────────┘${RESET}"

# ── 0. preflight ─────────────────────────────────────────────────────────────
info "Phase 0 — preflight"
for t in oc kubectl python3; do command -v "$t" >/dev/null 2>&1 || err "missing tool: $t"; done
oc whoami >/dev/null 2>&1 || err "not authenticated (set KUBECONFIG / oc login)"
for ns in "$NS_AI" "$NS_UI" "$NS_DATA" "$NS_SYS"; do
  oc get ns "$ns" >/dev/null 2>&1 || err "namespace $ns missing — deploy the platform stack first"
done
ok "cluster $(oc whoami --show-server) ; namespaces present"

# ── 1. out-of-band Secret amboy-creds (NOT in git → ArgoCD never blanks it) ──
info "Phase 1 — amboy-creds Secret in all four tiers"
for ns in "$NS_AI" "$NS_UI" "$NS_DATA" "$NS_SYS"; do
  oc -n "$ns" create secret generic amboy-creds \
    --from-literal=PG_PASSWORD="$PG_PASSWORD" \
    --from-literal=S3_ACCESS_KEY="$S3_ACCESS_KEY" \
    --from-literal=S3_SECRET_KEY="$S3_SECRET_KEY" \
    --from-literal=VAULT_TOKEN="$VAULT_TOKEN" \
    --from-literal=PORTKEY_API_KEY="$PORTKEY_API_KEY" \
    --dry-run=client -o yaml | oc apply -f - >/dev/null
done
ok "amboy-creds ready (no argocd tracking label → never pruned)"

# ── 2. in-cluster image build (internal registry, single image / 4 roles) ────
info "Phase 2 — in-cluster build (this can take several minutes — torch + MiniLM)"
oc -n "$NS_AI" apply -f "$DEMO_DIR/build/buildconfig.yaml" >/dev/null
# --wait makes start-build return non-zero on build failure (--follow alone does not),
# so a broken image aborts the deploy instead of silently continuing.
oc -n "$NS_AI" start-build amboy --from-dir="$DEMO_DIR" --follow --wait \
  || err "image build FAILED — see: oc -n $NS_AI logs build/amboy-<n>"
ok "image built → image-registry…/$NS_AI/amboy:latest"

# ── 3. standalone ArgoCD Application ─────────────────────────────────────────
info "Phase 3 — ArgoCD Application (targetRevision=$GIT_REVISION)"
sed "s|targetRevision: sanjeev-dev|targetRevision: $GIT_REVISION|" \
  "$DEMO_DIR/gitops/application.yaml" | oc apply -f - >/dev/null
ok "Application amboy-demo applied"

# ── 4. wait for sync + health ────────────────────────────────────────────────
info "Phase 4 — waiting for ArgoCD to sync the demo (up to ~10 min)…"
for i in $(seq 1 120); do
  sync="$(oc -n openshift-gitops get application amboy-demo -o jsonpath='{.status.sync.status}' 2>/dev/null || true)"
  health="$(oc -n openshift-gitops get application amboy-demo -o jsonpath='{.status.health.status}' 2>/dev/null || true)"
  [ "$sync" = "Synced" ] && [ "$health" = "Healthy" ] && break
  sleep 5
done
echo "    sync=$sync health=$health"
[ "${sync:-}" = "Synced" ] || warn "app not fully Synced yet — check: oc -n openshift-gitops get app amboy-demo"

# ── 5. seed synthetic reports into MinIO raw ─────────────────────────────────
info "Phase 5 — seed synthetic reports into MinIO raw"
oc -n "$NS_AI" delete job amboy-seed --ignore-not-found >/dev/null 2>&1 || true
oc -n "$NS_AI" apply -f "$DEMO_DIR/build/seed-job.yaml" >/dev/null
oc -n "$NS_AI" wait --for=condition=complete job/amboy-seed --timeout=180s \
  && ok "synthetic reports seeded into amboy-raw" \
  || warn "seed job not complete — you can still upload reports from the UI"

# ── done ─────────────────────────────────────────────────────────────────────
ROUTE="$(oc -n "$NS_UI" get route amboy-ui -o jsonpath='{.spec.host}' 2>/dev/null || echo '<pending>')"
echo -e "
${GREEN}${BOLD}AMBOY DEPLOYED.${RESET}
  UI        : https://${ROUTE}
  npi-reveal: create a Keycloak user with the 'npi-reveal' role (realm 'amboy'),
              or in demo mode toggle the role in the UI (X-Amboy-Roles header).
  Governance: import build assets — n8n workflow ConfigMap amboy-n8n-workflow
              (iis-ai-ui); Grafana auto-loads dashboard 'Amboy — NPI Governance'.
  Verify    : make verify           (offline privacy invariants + metrics + grounding)
              make verify-cluster    (live ingest, /detokenize 403, prompt scan)
"
