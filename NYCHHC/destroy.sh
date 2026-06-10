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

# ── 1b. Remove the NYCHHC Grafana dashboard + datasource + folder (scoped) ────
grafana_teardown || warn "grafana teardown skipped"

# ── 2. Delete the ArgoCD Application (finalizer cascade-prunes its children) ──
# Disable automated sync FIRST — the app has selfHeal+CreateNamespace=true, which
# would otherwise re-create the namespace + children mid-teardown (race).
log "Delete ArgoCD Application nychhc-demo"
oc -n openshift-gitops patch application nychhc-demo --type=merge \
  -p '{"spec":{"syncPolicy":{"automated":null}}}' >/dev/null 2>&1 || true
oc -n openshift-gitops delete application nychhc-demo --wait=true --ignore-not-found

# ── 3. Delete the namespace (guarded by the demo label; retry to beat any race) ─
if oc get ns "$NS" >/dev/null 2>&1; then
  assert_demo_namespace          # refuses unless ns carries demo=nychhc
  log "Delete namespace $NS"
  for attempt in 1 2 3; do
    oc delete ns "$NS" --wait=true --timeout=180s --ignore-not-found || true
    oc get ns "$NS" >/dev/null 2>&1 || break
    warn "namespace still present (attempt $attempt) — retrying"
    sleep 5
  done
  oc get ns "$NS" >/dev/null 2>&1 && warn "namespace $NS still terminating — check finalizers" || ok "namespace $NS removed"
fi

# ── 3b. Revert any MachineSet we scaled up (guarded) — restore EXACT original ──
# Only touches MachineSets we annotated. Scales back to the recorded prev-replicas
# (GPU set → 0, worker set → 1), so teardown leaves no demo compute running.
for ms in $(oc -n openshift-machine-api get machinesets \
    -o jsonpath='{range .items[?(@.metadata.annotations.nychhc-demo\.iisl\.com/scaled-up-by=="nychhc-demo")]}{.metadata.name}{"\n"}{end}' 2>/dev/null); do
  prev="$(oc -n openshift-machine-api get machineset "$ms" -o jsonpath='{.metadata.annotations.nychhc-demo\.iisl\.com/prev-replicas}' 2>/dev/null || echo "")"
  # Fallback for sets annotated before prev-replicas existed: GPU sets → 0, else 1.
  if [[ -z "$prev" ]]; then case "$ms" in *gpu*) prev=0;; *) prev=1;; esac; fi
  log "Scaling $ms back to $prev (demo scaled it up)"
  oc -n openshift-machine-api scale machineset "$ms" --replicas="$prev" || warn "scale-back failed for $ms"
  oc -n openshift-machine-api annotate machineset "$ms" \
    nychhc-demo.iisl.com/scaled-up-by- nychhc-demo.iisl.com/prev-replicas- 2>/dev/null || true
done

# ── 3c. Remove the demo IAM user used by KServe to pull the model from S3 ─────
U=nychhc-demo-s3-rw
if aws iam get-user --user-name "$U" --profile "$AWS_PROFILE" >/dev/null 2>&1; then
  log "Delete demo IAM user $U"
  for k in $(aws iam list-access-keys --user-name "$U" --profile "$AWS_PROFILE" --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null); do
    aws iam delete-access-key --user-name "$U" --access-key-id "$k" --profile "$AWS_PROFILE" 2>/dev/null || true; done
  aws iam delete-user-policy --user-name "$U" --policy-name s3-models-read --profile "$AWS_PROFILE" 2>/dev/null || true
  aws iam delete-user --user-name "$U" --profile "$AWS_PROFILE" 2>/dev/null || true
fi
# Demo-owned model artifacts in the shared bucket (our prefix only).
aws s3 rm "s3://ai-demo-data-lake/models/nychhc/" --recursive --profile "$AWS_PROFILE" --region "$AWS_REGION" 2>/dev/null || true

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
