#!/usr/bin/env bash
# =============================================================================
#  NYCHHC demo — DEPLOY (on top of the ai-demo-stack-aws platform)
#  Creates ONLY demo-owned objects: ECR repo (terraform), an OpenShift namespace,
#  demo schemas on the shared Aurora, and the demo's ArgoCD Application.
#  Idempotent; safe to re-run. Pairs with destroy.sh (scoped teardown).
# =============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib.sh"

IMAGE_TAG="${IMAGE_TAG:-0.1.0}"

preflight

# ── 1. Terraform: demo-owned AWS (ECR repo + optional IRSA), isolated state ───
log "Terraform apply (state key: nychhc/terraform.tfstate)"
terraform -chdir="$TF_DIR" init -input=false -reconfigure >/dev/null
terraform -chdir="$TF_DIR" apply -auto-approve -input=false
ECR_URL="$(terraform -chdir="$TF_DIR" output -raw ecr_repository_url)"
ECR_FE_URL="$(terraform -chdir="$TF_DIR" output -raw ecr_frontend_repository_url)"
ACCOUNT="$(terraform -chdir="$TF_DIR" output -raw account_id)"
ok "ECR: $ECR_URL , $ECR_FE_URL"

# Manifest pins account 406337554361 — warn if the live account differs.
grep -q "$ACCOUNT" "$DEMO_DIR/gitops/manifests/30-backend-deployment.yaml" \
  || warn "Deployment image account != $ACCOUNT — update 30-backend-deployment.yaml image:"

# ── 2. Namespace + ECR push/pull secret (no local docker — we build in-cluster) ─
log "Namespace + ECR registry secret"
oc create namespace "$NS" --dry-run=client -o yaml | oc apply -f - >/dev/null
oc label namespace "$NS" demo=nychhc --overwrite >/dev/null
REGISTRY="${ECR_URL%%/*}"   # <account>.dkr.ecr.<region>.amazonaws.com
# Used by BuildConfig (push) AND the pods (pull, via the SA's imagePullSecrets).
# ECR tokens last ~12h — re-running deploy.sh refreshes this.
oc -n "$NS" create secret docker-registry ecr-push \
  --docker-server="$REGISTRY" --docker-username=AWS \
  --docker-password="$(aws ecr get-login-password --profile "$AWS_PROFILE" --region "$AWS_REGION")" \
  --dry-run=client -o yaml | oc apply -f - >/dev/null
ok "Registry secret ecr-push ready ($REGISTRY)"

# ── 3. In-cluster image builds (OpenShift BuildConfig → ECR) ──────────────────
log "In-cluster build: backend"
oc -n "$NS" apply -f "$DEMO_DIR/build/backend-buildconfig.yaml" >/dev/null
oc -n "$NS" start-build nychhc-copilot --from-dir="$DEMO_DIR/backend" --follow
log "In-cluster build: frontend"
oc -n "$NS" apply -f "$DEMO_DIR/build/frontend-buildconfig.yaml" >/dev/null
oc -n "$NS" start-build nychhc-frontend --from-dir="$DEMO_DIR/frontend" --follow
ok "Images built + pushed to ECR (backend + frontend)"

# ── 4. Aurora Secret (bootstrapped from SSM; NOT in git, L6) ──────────────────
log "Aurora secret"
DSN="$(aurora_dsn)"
# No ArgoCD tracking label → ArgoCD never prunes/blanks it (PD lesson).
oc -n "$NS" create secret generic nychhc-aurora \
  --from-literal=dsn="$DSN" --dry-run=client -o yaml | oc apply -f - >/dev/null
ok "Secret nychhc-aurora ready"

# ── 5. Demo schemas + seed on the shared Aurora (demo-owned objects only) ─────
log "Apply schema + seed (schemas: workforce, rag)"
run_sql_stdin "$DSN" < "$DEMO_DIR/db/schema.sql"
ok "Schema + seed applied"

# ── 6. Train + publish predictive models to S3 (KServe storageUri targets) ────
# Skip with SKIP_MODELS=1 (e.g. iterating on the app only).
if [[ "${SKIP_MODELS:-0}" != "1" ]]; then
  log "Train + publish predictive models → s3://ai-demo-data-lake/models/nychhc/"
  ( cd "$DEMO_DIR/models" && AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" ./publish.sh ) \
    || warn "model publish failed — backend will use the rules fallback (D5)"
else
  warn "SKIP_MODELS=1 — backend will use the rules fallback until models are published"
fi

# ── 6b. Grafana: provision the NYCHHC dashboard + datasource (scoped) ─────────
grafana_provision || warn "grafana provisioning skipped"

# ── 7. Register the demo's ArgoCD Application (no edit to platform app-of-apps)─
log "Apply ArgoCD Application"
oc apply -f "$DEMO_DIR/gitops/application.yaml"
oc -n openshift-gitops annotate application/nychhc-demo \
  argocd.argoproj.io/refresh=hard --overwrite >/dev/null 2>&1 || true

# ── 8. Wait for rollout + smoke test ──────────────────────────────────────────
log "Wait for rollouts"
oc -n "$NS" rollout status deploy/nychhc-copilot --timeout=300s || warn "backend rollout slow — check ArgoCD"
oc -n "$NS" rollout status deploy/nychhc-frontend --timeout=300s || warn "frontend rollout slow — check ArgoCD"
BE_ROUTE="$(oc -n "$NS" get route nychhc-copilot -o jsonpath='{.spec.host}' 2>/dev/null || true)"
FE_ROUTE="$(oc -n "$NS" get route nychhc-frontend -o jsonpath='{.spec.host}' 2>/dev/null || true)"
[[ -n "$BE_ROUTE" ]] && { log "Smoke test https://$BE_ROUTE/health"; curl -sk "https://$BE_ROUTE/health" | head -c 200 || true; echo; }
[[ -n "$FE_ROUTE" ]] && ok "Demo UI: https://$FE_ROUTE" || warn "Frontend route not ready — oc -n $NS get route"

cat <<EOF

${c_grn}NYCHHC demo deployed on top of ai-demo-stack-aws.${c_rst}
  Namespace:  $NS         (label demo=nychhc)
  Image:      ${ECR_URL}:${IMAGE_TAG}
  ArgoCD app: nychhc-demo  (openshift-gitops)
  Teardown:   ./destroy.sh   (removes ONLY demo-owned objects)
EOF
