#!/usr/bin/env bash
# =============================================================================
#  Amboy NPI-Safe demo — DESTROY (AWS; scoped, label-guarded)
#
#  Deletes ONLY demo-owned objects: the ArgoCD Application (finalizer cascade-
#  prunes all children INCLUDING the demo-owned `amboy` namespace), the RHOAI
#  tile, and — with --aws — the amboy S3 buckets + IAM user. Shared platform
#  namespaces/services (ai-demo, vault, rhoai-*, Aurora, the data lake) are
#  NEVER touched.
#
#  Usage: ./destroy.sh [--aws]     (type 'destroy-amboy' to confirm)
#         --aws also empties+deletes s3://ai-demo-amboy-* and IAM user amboy-demo-s3-rw
# =============================================================================
set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info(){ echo -e "  ${CYAN}➤${RESET} $*"; }
err(){  echo -e "  ${RED}✘${RESET} $*" >&2; exit 1; }

NS=amboy
AWS_PROFILE="${AWS_PROFILE:-rhoai-demo}"; export AWS_PROFILE
AWS_CLEANUP=0; [ "${1:-}" = "--aws" ] && AWS_CLEANUP=1

command -v oc >/dev/null 2>&1 || err "oc not on PATH"
oc whoami >/dev/null 2>&1 || err "not authenticated"

echo -e "${RED}${BOLD}This deletes the Amboy demo from $(oc whoami --show-server).${RESET}"
echo "  (shared platform namespaces/services + Aurora + the data lake are left intact)"
[ "$AWS_CLEANUP" = 1 ] && echo -e "  ${RED}--aws: ALSO deletes s3://ai-demo-amboy-* and IAM user amboy-demo-s3-rw${RESET}"
read -r -p "Type 'destroy-amboy' to confirm: " c
[ "$c" = "destroy-amboy" ] || err "aborted"

# ── 1. remove the ArgoCD Application (finalizer cascade-prunes all children,
#       including the demo-owned `amboy` Namespace which is in the manifests) ──
info "removing ArgoCD Application amboy-demo (cascade prune)…"
oc -n openshift-gitops delete applications.argoproj.io amboy-demo --ignore-not-found --wait=true --timeout=300s 2>/dev/null || true

# ── 2. belt-and-braces: sweep anything left in the demo namespace ────────────
if oc get ns "$NS" >/dev/null 2>&1; then
  info "sweeping leftovers in ns $NS"
  oc -n "$NS" delete datasciencepipelinesapplication -l demo=amboy --ignore-not-found --wait=false 2>/dev/null || true
  oc -n "$NS" delete pipelineruns.tekton.dev,pipelines.tekton.dev,tasks.tekton.dev \
    -l demo=amboy --ignore-not-found --wait=false 2>/dev/null || true
  oc -n "$NS" delete secret amboy-creds --ignore-not-found 2>/dev/null || true
  oc -n "$NS" delete configmap amboy-compile-aws --ignore-not-found 2>/dev/null || true
  # the namespace is demo-owned (created by this demo alone) — remove it
  info "deleting demo-owned namespace $NS"
  oc delete ns "$NS" --ignore-not-found --timeout=300s 2>/dev/null || true
fi

# ── 2b. OpenShift AI dashboard launcher tile (lives in the dashboard's ns) ───
info "removing OpenShift AI Applications tile (redhat-ods-applications)"
oc -n redhat-ods-applications delete odhapplication,configmap -l demo=amboy --ignore-not-found 2>/dev/null || true

# ── 3. AWS resources (only with --aws) ───────────────────────────────────────
if [ "$AWS_CLEANUP" = 1 ]; then
  aws sts get-caller-identity >/dev/null 2>&1 || err "AWS session expired — aws sso login --profile $AWS_PROFILE"
  for b in ai-demo-amboy-raw ai-demo-amboy-deid ai-demo-amboy-pipelines; do
    if aws s3api head-bucket --bucket "$b" 2>/dev/null; then
      info "emptying + deleting s3://$b"
      aws s3 rb "s3://$b" --force >/dev/null 2>&1 || true
    fi
  done
  info "deleting IAM user amboy-demo-s3-rw"
  for k in $(aws iam list-access-keys --user-name amboy-demo-s3-rw --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null); do
    aws iam delete-access-key --user-name amboy-demo-s3-rw --access-key-id "$k" 2>/dev/null || true
  done
  aws iam delete-user-policy --user-name amboy-demo-s3-rw --policy-name amboy-s3-rw 2>/dev/null || true
  aws iam delete-user --user-name amboy-demo-s3-rw 2>/dev/null || true
fi

cat <<EOF

$(echo -e "${GREEN}${BOLD}AMBOY TORN DOWN.${RESET}")
  - ArgoCD Application + the demo-owned 'amboy' namespace removed.
  - DSP Pipeline Server (amboy-dsp) + OpenShift AI Applications tile removed.
  - Shared platform namespaces/services + Aurora + the data lake untouched.
$([ "$AWS_CLEANUP" = 1 ] && echo "  - amboy S3 buckets + IAM user removed." \
  || echo "  - S3 buckets + IAM user KEPT (re-run with --aws to remove them).")
  - NOTE: the amboy schema/tokens persist in Aurora (schema 'amboy'). To purge:
      re-deploy, then:  oc -n amboy exec deploy/amboy-deid-gateway -- python -c \\
        "from app.common import db; import psycopg;                          \\
         c=psycopg.connect(__import__('app.common.config',fromlist=['x']).pg_dsn()); \\
         c.execute('DROP SCHEMA IF EXISTS amboy CASCADE'); c.commit()"
      (or connect via CloudBeaver at cloudbeaver-rhoai-tools.apps.ai-demo.iisdemolab.click)
EOF
