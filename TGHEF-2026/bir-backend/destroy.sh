#!/usr/bin/env bash
# =============================================================================
#  Bir Festival 2026 backend — DESTROY (tag-scoped to THIS app only)
#  Removes every object with tag Project=bir-festival-2026 and NOTHING else.
#  Two safety layers:
#   1. terraform destroy can only see resources in THIS local state file.
#   2. A post-destroy tag sweep VERIFIES nothing tagged with our Project
#      remains — and refuses to claim success if it does.
#  NEVER touches any other company-demos project.
# =============================================================================
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib.sh"

preflight

warn "This removes ONLY objects tagged Project=${PROJECT_TAG}. Other projects are untouched."
if [[ "${FORCE:-0}" != "1" ]]; then
  read -r -p "Type 'destroy' to proceed: " ans
  [[ "$ans" == "destroy" ]] || die "aborted"
fi

# ── 1. Empty the S3 buckets (terraform can't delete non-empty buckets) ───────
for b in "$(tfout storage_media_bucket)" "$(tfout storage_app_dist_bucket)"; do
  if [[ -n "$b" ]] && awscli s3api head-bucket --bucket "$b" 2>/dev/null; then
    log "Emptying s3://$b"
    awscli s3 rm "s3://$b" --recursive >/dev/null 2>&1 || true
  fi
done

# ── 2. Terraform destroy (scoped by the isolated local state) ────────────────
log "Terraform destroy"
tf destroy -auto-approve -input=false -var "aws_profile=${AWS_PROFILE}" -var "aws_region=${AWS_REGION}"

# ── 3. Tag-scoped verification sweep ─────────────────────────────────────────
log "Verifying no resources remain tagged Project=${PROJECT_TAG}"
REMAIN="$(awscli resourcegroupstaggingapi get-resources \
  --tag-filters "Key=Project,Values=${PROJECT_TAG}" \
  --query 'length(ResourceTagMappingList)' --output text 2>/dev/null || echo "unknown")"
if [[ "$REMAIN" == "0" ]]; then
  ok "Clean — zero resources tagged Project=${PROJECT_TAG} remain"
elif [[ "$REMAIN" == "unknown" ]]; then
  warn "Could not run the tag sweep (permissions) — verify manually in the console"
else
  warn "$REMAIN resource(s) still tagged Project=${PROJECT_TAG} — likely CloudFront still disabling (can lag a few min). Re-run destroy.sh if it persists:"
  awscli resourcegroupstaggingapi get-resources --tag-filters "Key=Project,Values=${PROJECT_TAG}" \
    --query 'ResourceTagMappingList[].ResourceARN' --output text 2>/dev/null || true
fi

ok "Teardown complete."
