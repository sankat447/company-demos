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
ACCOUNT="$(terraform -chdir="$TF_DIR" output -raw account_id)"
ok "ECR: $ECR_URL"

# Manifest pins account 406337554361 — warn if the live account differs.
grep -q "$ACCOUNT" "$DEMO_DIR/gitops/manifests/30-backend-deployment.yaml" \
  || warn "Deployment image account != $ACCOUNT — update 30-backend-deployment.yaml image:"

# ── 2. Build + push the copilot image to the demo ECR repo ────────────────────
CLI="$(container_cli)"
log "Build + push image ($CLI) → ${ECR_URL}:${IMAGE_TAG}"
aws ecr get-login-password --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  | "$CLI" login --username AWS --password-stdin "${ECR_URL%/*}"
"$CLI" build -t "${ECR_URL}:${IMAGE_TAG}" -t "${ECR_URL}:latest" "$DEMO_DIR/backend"
"$CLI" push "${ECR_URL}:${IMAGE_TAG}"
"$CLI" push "${ECR_URL}:latest"
ok "Image pushed"

# ── 3. Namespace + Aurora Secret (bootstrapped from SSM; NOT in git, L6) ──────
log "Namespace + Aurora secret"
oc create namespace "$NS" --dry-run=client -o yaml | oc apply -f - >/dev/null
oc label namespace "$NS" demo=nychhc --overwrite >/dev/null
DSN="$(aurora_dsn)"
# No ArgoCD tracking label → ArgoCD never prunes/blanks it (PD lesson).
oc -n "$NS" create secret generic nychhc-aurora \
  --from-literal=dsn="$DSN" --dry-run=client -o yaml | oc apply -f - >/dev/null
ok "Secret nychhc-aurora ready"

# ── 4. Demo schemas + seed on the shared Aurora (demo-owned objects only) ─────
log "Apply schema + seed (schemas: workforce, rag)"
run_sql_stdin "$DSN" < "$DEMO_DIR/db/schema.sql"
ok "Schema + seed applied"

# ── 4b. Train + publish predictive models to S3 (KServe storageUri targets) ───
# Skip with SKIP_MODELS=1 (e.g. iterating on the app only).
if [[ "${SKIP_MODELS:-0}" != "1" ]]; then
  log "Train + publish predictive models → s3://ai-demo-data-lake/models/nychhc/"
  ( cd "$DEMO_DIR/models" && AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" ./publish.sh ) \
    || warn "model publish failed — backend will use the rules fallback (D5)"
else
  warn "SKIP_MODELS=1 — backend will use the rules fallback until models are published"
fi

# ── 5. Register the demo's ArgoCD Application (no edit to platform app-of-apps)─
log "Apply ArgoCD Application"
oc apply -f "$DEMO_DIR/gitops/application.yaml"
oc -n openshift-gitops annotate application/nychhc-demo \
  argocd.argoproj.io/refresh=hard --overwrite >/dev/null 2>&1 || true

# ── 6. Wait for rollout + smoke test ──────────────────────────────────────────
log "Wait for backend rollout"
oc -n "$NS" rollout status deploy/nychhc-copilot --timeout=300s || warn "rollout slow — check ArgoCD"
ROUTE="$(oc -n "$NS" get route nychhc-copilot -o jsonpath='{.spec.host}' 2>/dev/null || true)"
if [[ -n "$ROUTE" ]]; then
  log "Smoke test https://$ROUTE/health"
  curl -sk "https://$ROUTE/health" | head -c 300 || true; echo
  ok "Deployed. Route: https://$ROUTE"
else
  warn "Route not ready yet — re-check with: oc -n $NS get route"
fi

cat <<EOF

${c_grn}NYCHHC demo deployed on top of ai-demo-stack-aws.${c_rst}
  Namespace:  $NS         (label demo=nychhc)
  Image:      ${ECR_URL}:${IMAGE_TAG}
  ArgoCD app: nychhc-demo  (openshift-gitops)
  Teardown:   ./destroy.sh   (removes ONLY demo-owned objects)
EOF
