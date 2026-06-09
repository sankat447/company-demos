#!/usr/bin/env bash
# =============================================================================
#  NYCHHC demo — DESTROY (scoped to the demo ONLY)
#  Removes: demo Aurora schemas, the ArgoCD Application (cascade-prunes its
#  workloads), the OpenShift namespace, and demo-owned AWS (ECR repo, optional
#  IRSA) via the ISOLATED terraform state.
#  NEVER touches: platform terraform state, the shared Aurora CLUSTER, the data
#  lake, the OCP cluster, or anything tagged Project=ai.
# =============================================================================
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib.sh"

preflight

warn "This removes ONLY demo-owned objects. Platform (ai-demo-stack-aws) is untouched."

# ── 1. Drop demo schemas on the shared Aurora (demo-owned objects only) ───────
if oc get ns "$NS" >/dev/null 2>&1; then
  log "Drop demo schemas (workforce, rag) — Aurora cluster left intact"
  DSN="$(aurora_dsn)"
  printf 'DROP SCHEMA IF EXISTS workforce CASCADE;\nDROP SCHEMA IF EXISTS rag CASCADE;\n' \
    | run_sql_stdin "$DSN" || warn "schema drop failed (ns/secret may be gone) — continuing"
fi

# ── 2. Delete the ArgoCD Application (finalizer cascade-prunes its children) ──
log "Delete ArgoCD Application nychhc-demo"
oc -n openshift-gitops delete application nychhc-demo --wait=true --ignore-not-found

# ── 3. Delete the namespace (guarded by the demo label) ───────────────────────
if oc get ns "$NS" >/dev/null 2>&1; then
  assert_demo_namespace          # refuses unless ns carries demo=nychhc
  log "Delete namespace $NS"
  oc delete ns "$NS" --wait=true --ignore-not-found
fi

# ── 4. Terraform destroy — isolated state ⇒ only demo-owned AWS resources ──────
log "Terraform destroy (state key: nychhc/terraform.tfstate)"
terraform -chdir="$TF_DIR" init -input=false -reconfigure >/dev/null
terraform -chdir="$TF_DIR" destroy -auto-approve -input=false

# ── 5. Verify nothing platform-owned was touched ──────────────────────────────
log "Verify platform intact"
oc get ns ai-demo >/dev/null 2>&1 && ok "platform namespace ai-demo still present" || warn "ai-demo namespace not found (?)"
aws ssm get-parameter --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --name "/${PLATFORM_SSM_PREFIX}/aurora/endpoint" >/dev/null 2>&1 \
  && ok "platform Aurora SSM still present" || warn "platform Aurora SSM not found (?)"

ok "NYCHHC demo destroyed. Platform untouched."
