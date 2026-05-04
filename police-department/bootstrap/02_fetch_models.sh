#!/usr/bin/env bash
# =============================================================================
#  02_fetch_models.sh — stage Qwen2.5-VL-7B in S3 for the InferenceService.
#
#  Idempotent: skips if s3://${PD_BUCKET}/models/police-department/qwen2.5-vl-7b/
#  already contains a config.json. Otherwise spins up an ephemeral pod that
#  uses the HF token to clone the repo into S3.
#
#  Spinning up a pod (rather than running locally) keeps the bandwidth inside
#  the cluster's VPC and avoids dragging the model through the operator's
#  laptop. The pod runs in pd-cctv with pd-hf-token + pd-s3-creds mounted.
# =============================================================================
SCRIPT_NAME=02_fetch_models
DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/common.sh
source "$DIR/lib/common.sh"

banner "Police-Department demo — fetch Qwen2.5-VL-7B"
require_cmd oc aws

MODEL_REPO="Qwen/Qwen2.5-VL-7B-Instruct"
S3_PREFIX="s3://${PD_BUCKET}/models/police-department/qwen2.5-vl-7b"

log_info "checking $S3_PREFIX/config.json..."
if aws s3 ls "$S3_PREFIX/config.json" >/dev/null 2>&1; then
  log_ok "already staged; skipping"
  exit 0
fi

log_info "launching ephemeral fetcher pod in $PD_NS_CCTV"
cat <<EOF | oc apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: pd-fetch-qwen-$(date +%s)
  namespace: $PD_NS_CCTV
  labels:
    app.kubernetes.io/part-of: police-department
spec:
  ttlSecondsAfterFinished: 300
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: fetch
        image: registry.access.redhat.com/ubi9/python-311:latest
        env:
        - name: HF_TOKEN
          valueFrom:
            secretKeyRef: { name: pd-hf-token, key: token }
        - name: AWS_ACCESS_KEY_ID
          valueFrom:
            secretKeyRef: { name: pd-s3-creds, key: access_key_id }
        - name: AWS_SECRET_ACCESS_KEY
          valueFrom:
            secretKeyRef: { name: pd-s3-creds, key: secret_access_key }
        - name: AWS_REGION
          valueFrom:
            secretKeyRef: { name: pd-s3-creds, key: region, optional: true }
        - name: S3_PREFIX
          value: "$S3_PREFIX"
        - name: MODEL_REPO
          value: "$MODEL_REPO"
        command: ["/bin/bash", "-c"]
        args:
        - |
          set -euo pipefail
          pip install --quiet --no-cache-dir 'huggingface_hub==0.26.2' boto3==1.35.40
          python3 - <<'PY'
          import os, subprocess
          from huggingface_hub import snapshot_download
          local = "/tmp/model"
          path = snapshot_download(
              repo_id=os.environ["MODEL_REPO"],
              token=os.environ["HF_TOKEN"],
              local_dir=local,
              ignore_patterns=["*.bin", "*.gguf"],  # safetensors + tokenizer only
          )
          print(f"snapshot at {path}")
          subprocess.check_call([
              "aws", "s3", "sync", path, os.environ["S3_PREFIX"],
              "--region", os.environ.get("AWS_REGION", "us-east-1"),
          ])
          print("upload done")
          PY
        resources:
          requests: { cpu: "1", memory: "4Gi" }
          limits:   { cpu: "2", memory: "8Gi" }
EOF

log_info "waiting for fetcher Job (this typically takes 4-8 min for ~14GB)"
job=$(oc -n "$PD_NS_CCTV" get job -l app.kubernetes.io/part-of=police-department \
        --sort-by=.metadata.creationTimestamp -o name | tail -n 1)
oc -n "$PD_NS_CCTV" wait --for=condition=complete --timeout=20m "$job"
log_ok "Qwen2.5-VL staged at $S3_PREFIX"
