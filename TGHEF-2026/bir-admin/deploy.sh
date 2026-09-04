#!/usr/bin/env bash
# Publish the ops console to the app-dist bucket under /admin/ and invalidate CDN.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF="$HERE/../bir-backend/terraform"
export AWS_PROFILE="${AWS_PROFILE:-rhoai-demo}" AWS_REGION="${AWS_REGION:-us-east-1}"
BUCKET="$(terraform -chdir="$TF" output -raw storage_app_dist_bucket)"
aws s3 sync "$HERE" "s3://$BUCKET/admin/" \
  --exclude '*.sh' --exclude 'README.md' --exclude '.DS_Store' \
  --cache-control 'no-cache' --only-show-errors
echo "Synced to s3://$BUCKET/admin/"
DIST="$(aws cloudfront list-distributions --query "DistributionList.Items[?Origins.Items[?starts_with(DomainName, '${BUCKET}')]].Id | [0]" --output text 2>/dev/null || true)"
if [ -n "${DIST:-}" ] && [ "$DIST" != "None" ]; then
  aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/admin/*' --query 'Invalidation.Status' --output text
  echo "Invalidated /admin/* on $DIST"
else
  echo "No matching CloudFront distribution found — serve from S3 or wire your CDN manually."
fi
