#!/usr/bin/env bash
# Train both models and publish artifacts to the data lake (demo-owned prefix).
# KServe InferenceServices (gitops/manifests/60,61) pull from these paths.
#
#   ./publish.sh            # train + upload to s3://ai-demo-data-lake/models/nychhc/
#
# IMPORTANT: train with the SAME sklearn version the KServe sklearn runtime uses,
# or the joblib may fail to unpickle on the server (version-skew trap). Pin in CI.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

: "${AWS_PROFILE:=rhoai-demo}"
: "${AWS_REGION:=us-east-1}"
: "${BUCKET:=ai-demo-data-lake}"
PREFIX="models/nychhc"

# Ensure training deps (sklearn/joblib/numpy) are importable; install if not.
python -c "import sklearn, joblib, numpy" 2>/dev/null || {
  echo "▶ Installing model training deps"
  pip install -q -e . || pip install -q "scikit-learn>=1.5" "numpy>=1.26" "joblib>=1.4"
}

echo "▶ Training models"
python train_noshow.py
python train_forecast.py

echo "▶ Uploading artifacts → s3://${BUCKET}/${PREFIX}/"
aws s3 cp artifacts/noshow/model.joblib   "s3://${BUCKET}/${PREFIX}/noshow/model.joblib"   --profile "$AWS_PROFILE" --region "$AWS_REGION"
aws s3 cp artifacts/forecast/model.joblib "s3://${BUCKET}/${PREFIX}/forecast/model.joblib" --profile "$AWS_PROFILE" --region "$AWS_REGION"
echo "✔ Published. (KServe storageUri points at these paths.)"
