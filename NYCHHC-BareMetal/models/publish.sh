#!/usr/bin/env bash
# Train both models and (optionally) publish the joblib artifacts to the in-stack
# MinIO bucket the KServe predictor pulls from (MinIO-first, baked fallback).
#
#   ./publish.sh                       # train only (artifacts/ -> baked into the image)
#   NYCHHC_MINIO_ENDPOINT_URL=... \    # train + upload to s3://$BUCKET/{noshow,forecast}/model.joblib
#   NYCHHC_S3_SECRET_KEY=... ./publish.sh
#
# On-cluster the upload is normally done by the nychhc-bootstrap-minio Job (it runs
# this same boto3 put from the backend image, which has the artifacts baked in).
#
# IMPORTANT: train with the SAME sklearn version the predictor image pins
# (scikit-learn==1.9.0) or the joblib may fail to unpickle (version-skew trap).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

: "${NYCHHC_S3_BUCKET:=nychhc-models}"
: "${NYCHHC_MINIO_ENDPOINT_URL:=}"
: "${NYCHHC_S3_ACCESS_KEY:=minioadmin}"
: "${NYCHHC_S3_SECRET_KEY:=}"

python -c "import sklearn, joblib, numpy" 2>/dev/null || {
  echo "▶ Installing model training deps"
  pip install -q "scikit-learn==1.9.0" "numpy>=1.26" "joblib>=1.4"
}

echo "▶ Training models"
python train_noshow.py
python train_forecast.py

if [[ -n "$NYCHHC_MINIO_ENDPOINT_URL" && -n "$NYCHHC_S3_SECRET_KEY" ]]; then
  echo "▶ Uploading artifacts → s3://${NYCHHC_S3_BUCKET}/ (endpoint ${NYCHHC_MINIO_ENDPOINT_URL})"
  python - <<'PY'
import os, boto3
ep  = os.environ["NYCHHC_MINIO_ENDPOINT_URL"]
bkt = os.environ.get("NYCHHC_S3_BUCKET", "nychhc-models")
s3 = boto3.client("s3", endpoint_url=ep,
                  aws_access_key_id=os.environ.get("NYCHHC_S3_ACCESS_KEY", "minioadmin"),
                  aws_secret_access_key=os.environ["NYCHHC_S3_SECRET_KEY"])
try:
    s3.create_bucket(Bucket=bkt)
except Exception:
    pass
for name in ("noshow", "forecast"):
    s3.upload_file(f"artifacts/{name}/model.joblib", bkt, f"{name}/model.joblib")
    print(f"  uploaded {name}/model.joblib")
PY
  echo "✔ Published to MinIO."
else
  echo "✔ Trained only (set NYCHHC_MINIO_ENDPOINT_URL + NYCHHC_S3_SECRET_KEY to upload)."
fi
