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
# Register iis-ai-ai as a Data Science Project so the KServe PII model
# (amboy-pii-model InferenceService) shows in the OpenShift AI dashboard.
oc label ns "$NS_AI" opendatahub.io/dashboard=true --overwrite >/dev/null 2>&1 || true
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

# ── 4b. pin the KServe model + agents to the freshly-built DIGEST ─────────────
# The git manifests reference amboy:latest; KServe scale cycles and node :latest
# caching can otherwise serve a stale image. Pin the exact digest (ArgoCD ignores
# this field — see application.yaml ignoreDifferences). Best-effort.
info "Phase 4b — pin model + agents to the built image digest"
DIG="$(oc -n "$NS_AI" get istag amboy:latest -o jsonpath='{.image.metadata.name}' 2>/dev/null || true)"
if [ -n "$DIG" ]; then
  IMG="image-registry.openshift-image-registry.svc:5000/$NS_AI/amboy@${DIG}"
  oc -n "$NS_AI" patch inferenceservice amboy-pii-model --type=json \
    -p "[{\"op\":\"replace\",\"path\":\"/spec/predictor/containers/0/image\",\"value\":\"${IMG}\"}]" >/dev/null 2>&1 || true
  for d in amboy-deid-gateway amboy-compare-agent; do
    oc -n "$NS_AI" patch deploy "$d" --type=json \
      -p "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/image\",\"value\":\"${IMG}\"}]" >/dev/null 2>&1 || true
  done
  ok "pinned to digest ${DIG#sha256:}"
else
  warn "could not read amboy:latest digest — services stay on :latest"
fi

# ── 4c. seed the BASE PII model into in-stack MinIO (served from S3, no egress) ─
info "Phase 4c — publish base PII model to MinIO (idempotent)"
oc -n "$NS_AI" delete job amboy-seed-base --ignore-not-found >/dev/null 2>&1 || true
oc -n "$NS_AI" apply -f "$DEMO_DIR/build/seed-base-job.yaml" >/dev/null
oc -n "$NS_AI" wait --for=condition=complete job/amboy-seed-base --timeout=300s \
  && ok "base PII model published to MinIO" \
  || warn "seed-base job not complete — model falls back to the baked copy"

# ── 5. seed synthetic reports into MinIO raw ─────────────────────────────────
info "Phase 5 — seed synthetic reports into MinIO raw"
oc -n "$NS_AI" delete job amboy-seed --ignore-not-found >/dev/null 2>&1 || true
oc -n "$NS_AI" apply -f "$DEMO_DIR/build/seed-job.yaml" >/dev/null
oc -n "$NS_AI" wait --for=condition=complete job/amboy-seed --timeout=180s \
  && ok "synthetic reports seeded into amboy-raw" \
  || warn "seed job not complete — you can still upload reports from the UI"

# ── 6. OpenShift AI dashboard launcher tile (best-effort) ────────────────────
# Renders an "Applications" card in the RHOAI dashboard linking to amboy-web. Lives
# in the dashboard's applications namespace; needs cluster perms there, so best-effort.
info "Phase 6 — OpenShift AI Applications launcher tile (best-effort)"
oc apply -f "$DEMO_DIR/gitops/openshift-ai-tile.yaml" >/dev/null 2>&1 \
  && ok "Applications tile 'Amboy NPI-Safe' applied (refresh OpenShift AI → Applications)" \
  || warn "tile skipped (no perms on redhat-ods-applications) — optional/cosmetic"

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
