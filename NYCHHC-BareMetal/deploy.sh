#!/usr/bin/env bash
# =============================================================================
#  NYCHHC-BareMetal — DEPLOY (on the ai-demo-stack-BAREMETAL platform)
#
#  Scoped + idempotent. Creates ONLY demo-owned objects (label demo=nychhc) on an
#  already-running OCP 4.21 cluster (ocp419.crucible.iisl.com): out-of-band Secrets,
#  two in-cluster image builds (internal registry — NO ECR/Terraform), the demo's
#  standalone ArgoCD Application, and a Grafana dashboard. Reuses platform services
#  (postgres+pgvector, minio, portkey, grafana).
#
#  Usage:    ./deploy.sh
#  Override: KUBECONFIG, GIT_REVISION, PORTKEY_API_KEY, PG_PASSWORD, S3_* via env.
#  Pairs with destroy.sh (scoped, label-guarded teardown).
# =============================================================================
set -euo pipefail
DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DEMO_DIR/scripts/lib.sh"

GIT_REVISION="${GIT_REVISION:-sanjeev-dev}"
# Demo creds (match the baremetal platform defaults; override via env for real use).
PG_PASSWORD="${PG_PASSWORD:-Demo1234#}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-minioadmin}"
S3_SECRET_KEY="${S3_SECRET_KEY:-Demo1234#}"
PORTKEY_API_KEY="${PORTKEY_API_KEY:-}"

echo -e "${CYAN}${BOLD}┌───────────────────────────────────────────────┐
│  NYCHHC-BareMetal — deploy (baremetal)         │
└───────────────────────────────────────────────┘${RESET}"

# ── 0. preflight ─────────────────────────────────────────────────────────────
info "Phase 0 — preflight"
nychhc_kubeconfig
require_cluster
# Register iis-ai-ai as a Data Science Project so the KServe models show in the
# OpenShift AI Model Serving dashboard.
oc label ns "$NS_AI" opendatahub.io/dashboard=true --overwrite >/dev/null 2>&1 || true
ok "cluster $(oc whoami --show-server) ; namespaces present"

# ── 1. out-of-band nychhc-creds Secret (NOT in git → ArgoCD never blanks it) ──
info "Phase 1 — nychhc-creds Secret in iis-ai-{ai,ui,data}"
# Build a psycopg URL DSN with the password URL-escaped (# → %23).
PG_PW_ENC="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PG_PASSWORD")"
AURORA_DSN="postgresql://${PG_USER}:${PG_PW_ENC}@${PG_HOST}:5432/${PG_DB}"
for ns in "$NS_AI" "$NS_UI" "$NS_DATA"; do
  oc -n "$ns" create secret generic nychhc-creds \
    --from-literal=PG_PASSWORD="$PG_PASSWORD" \
    --from-literal=AURORA_DSN="$AURORA_DSN" \
    --from-literal=S3_ACCESS_KEY="$S3_ACCESS_KEY" \
    --from-literal=S3_SECRET_KEY="$S3_SECRET_KEY" \
    --from-literal=PORTKEY_API_KEY="$PORTKEY_API_KEY" \
    --dry-run=client -o yaml | oc apply -f - >/dev/null
done
ok "nychhc-creds ready (no argocd tracking label → never pruned)"

# ── 2. in-cluster backend image (internal registry, single image / 2 roles) ──
info "Phase 2 — build backend image (this can take a few minutes)"
oc -n "$NS_AI" apply -f "$DEMO_DIR/build/buildconfig.yaml" >/dev/null
# --wait makes start-build return non-zero on build failure (--follow alone does not).
oc -n "$NS_AI" start-build nychhc --from-dir="$DEMO_DIR" --follow --wait \
  || err "backend image build FAILED — see: oc -n $NS_AI logs build/nychhc-<n>"
ok "backend image → image-registry…/$NS_AI/nychhc:latest"

# ── 3. in-cluster frontend image (static SPA + nginx BFF) ────────────────────
info "Phase 3 — build frontend image"
oc -n "$NS_UI" apply -f "$DEMO_DIR/build/frontend-buildconfig.yaml" >/dev/null
oc -n "$NS_UI" start-build nychhc-frontend --from-dir="$DEMO_DIR/frontend" --follow --wait \
  || err "frontend image build FAILED — see: oc -n $NS_UI logs build/nychhc-frontend-<n>"
ok "frontend image → image-registry…/$NS_UI/nychhc-frontend:latest"

# ── 4. standalone ArgoCD Application ─────────────────────────────────────────
info "Phase 4 — ArgoCD Application (targetRevision=$GIT_REVISION)"
sed "s|targetRevision: sanjeev-dev|targetRevision: $GIT_REVISION|" \
  "$DEMO_DIR/gitops/application.yaml" | oc apply -f - >/dev/null
ok "Application nychhc-demo applied"

# ── 5. wait for sync + health ────────────────────────────────────────────────
info "Phase 5 — waiting for ArgoCD to sync the demo (up to ~10 min)…"
sync=""; health=""
for i in $(seq 1 120); do
  sync="$(oc -n openshift-gitops get application nychhc-demo -o jsonpath='{.status.sync.status}' 2>/dev/null || true)"
  health="$(oc -n openshift-gitops get application nychhc-demo -o jsonpath='{.status.health.status}' 2>/dev/null || true)"
  [ "$sync" = "Synced" ] && [ "$health" = "Healthy" ] && break
  sleep 5
done
echo "    sync=$sync health=$health"
[ "${sync:-}" = "Synced" ] || warn "app not fully Synced yet — check: oc -n openshift-gitops get app nychhc-demo"

# ── 6. pin the KServe models to the freshly-built DIGEST ─────────────────────
# The git manifests reference nychhc:latest; KServe scale cycles + node :latest
# caching can serve a stale image. Pin the exact digest (ArgoCD ignores this field —
# see application.yaml ignoreDifferences). Best-effort.
info "Phase 6 — pin KServe models to the built image digest"
DIG="$(oc -n "$NS_AI" get istag nychhc:latest -o jsonpath='{.image.metadata.name}' 2>/dev/null || true)"
if [ -n "$DIG" ]; then
  IMG="image-registry.openshift-image-registry.svc:5000/$NS_AI/nychhc@${DIG}"
  for is in nychhc-noshow nychhc-forecast; do
    oc -n "$NS_AI" patch inferenceservice "$is" --type=json \
      -p "[{\"op\":\"replace\",\"path\":\"/spec/predictor/containers/0/image\",\"value\":\"${IMG}\"}]" >/dev/null 2>&1 || true
  done
  ok "models pinned to digest ${DIG#sha256:}"
else
  warn "could not read nychhc:latest digest — models stay on :latest"
fi

# ── 7. Grafana dashboard (provisioned via API; removed by destroy.sh) ────────
info "Phase 7 — Grafana dashboard + datasource"
grafana_provision "$DEMO_DIR/grafana/nychhc-dashboard.json"

# ── done ─────────────────────────────────────────────────────────────────────
FE="$(oc -n "$NS_UI" get route nychhc-frontend -o jsonpath='{.spec.host}' 2>/dev/null || echo '<pending>')"
BE="$(oc -n "$NS_AI" get route nychhc-copilot  -o jsonpath='{.spec.host}' 2>/dev/null || echo '<pending>')"
GF="$(grafana_base || true)"
echo -e "
${GREEN}${BOLD}NYCHHC-BareMetal DEPLOYED.${RESET}
  UI        : https://${FE}            (role picker → X-NYCHHC-Roles)
  Backend   : https://${BE}/health  +  /api/capabilities
  Grafana   : ${GF:-<grafana route not found>}  (dashboard: NYCHHC Workforce)
  Models    : oc -n ${NS_AI} get inferenceservice -l demo=nychhc
  Chat (router, real data): \"Which cardiologists have openings?\",
              \"What's the no-show rate by provider?\",
              \"Put Dr. Tanaka on PTO 6/16-6/20 and show the impact\"
  Verify    : make verify        (offline kustomize + backend tests)
              make verify-cluster (live smoke against the routes)
"
