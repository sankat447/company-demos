#!/usr/bin/env bash
# Publish the public download landing page to the app-dist bucket under /get/
# and invalidate the CDN. The QR posters (bir-mobile/docs/DISTRIBUTION.md) point at
#   https://<app-dist CDN>/get/index.html
# The page reads /android/latest.json at runtime — upload the signed APK + latest.json
# to /android/ (via the release pipeline) and this page lights up the download button
# automatically; no redeploy of the page needed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TF="${TF:-$HERE/../../bir-backend/terraform}"
export AWS_PROFILE="${AWS_PROFILE:-rhoai-demo}"

BUCKET="$(terraform -chdir="$TF" output -raw storage_app_dist_bucket)"

aws s3 cp "$HERE/index.html" "s3://$BUCKET/get/index.html" \
  --content-type 'text/html; charset=utf-8' \
  --cache-control 'public, max-age=300'
echo "Uploaded s3://$BUCKET/get/index.html"

DIST="$(aws cloudfront list-distributions --query "DistributionList.Items[?Origins.Items[?starts_with(DomainName, '${BUCKET}')]].Id | [0]" --output text 2>/dev/null || true)"
if [ -n "$DIST" ] && [ "$DIST" != "None" ]; then
  echo -n "Invalidating $DIST … "
  aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/get/*' --query 'Invalidation.Status' --output text
  DOMAIN="$(aws cloudfront get-distribution --id "$DIST" --query 'Distribution.DomainName' --output text)"
  echo "Live at: https://$DOMAIN/get/index.html"
else
  echo "No matching CloudFront distribution found — serve from S3 or wire your CDN manually."
fi
