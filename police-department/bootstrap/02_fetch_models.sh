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
  log_ok "already staged; skipping Qwen-VL"
  QWEN_STAGE=false
else
  QWEN_STAGE=true
fi

# Continue to BGE-small block regardless (lesson 17.33 — the old `exit 0`
# short-circuited before BGE-small was reached, so a warm re-run after a
# hard teardown left BGE-small missing while Qwen-VL was fine).
if ! "$QWEN_STAGE"; then
  # Skip everything between here and the BGE block — jump via a wrapping if
  :
else

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
        - name: AWS_SESSION_TOKEN
          valueFrom:
            secretKeyRef: { name: pd-s3-creds, key: session_token, optional: true }
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
          import os, sys, time
          from pathlib import Path
          from huggingface_hub import snapshot_download
          import boto3
          local = "/tmp/model"
          path = snapshot_download(
              repo_id=os.environ["MODEL_REPO"],
              token=os.environ["HF_TOKEN"],
              local_dir=local,
              ignore_patterns=["*.bin", "*.gguf"],  # safetensors + tokenizer only
          )
          print(f"snapshot at {path}")
          # Upload via boto3 (no aws CLI in this image). S3_PREFIX is
          # s3://<bucket>/<prefix> — split it.
          uri = os.environ["S3_PREFIX"].removeprefix("s3://")
          bucket, _, key_root = uri.partition("/")
          key_root = key_root.rstrip("/")
          s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
          uploaded = 0
          for fp in Path(path).rglob("*"):
              if not fp.is_file():
                  continue
              rel = fp.relative_to(path).as_posix()
              key = f"{key_root}/{rel}" if key_root else rel
              size = fp.stat().st_size
              t0 = time.time()
              s3.upload_file(str(fp), bucket, key)
              dt = time.time() - t0
              uploaded += size
              print(f"  -> s3://{bucket}/{key}  ({size/1e6:.1f} MB in {dt:.1f}s)", flush=True)
          print(f"upload done — {uploaded/1e9:.2f} GB total")
          PY
        resources:
          # Fetcher is IO-bound (HF download + S3 sync). Keep requests small
          # so it lands on a worker even when RHOAI/KServe controllers have
          # eaten most of the CPU reservation.
          requests: { cpu: "200m", memory: "2Gi" }
          limits:   { cpu: "2",    memory: "8Gi" }
EOF

log_info "waiting for fetcher Job (this typically takes 4-8 min for ~14GB)"
job=$(oc -n "$PD_NS_CCTV" get job -l app.kubernetes.io/part-of=police-department \
        --sort-by=.metadata.creationTimestamp -o name | tail -n 1)
oc -n "$PD_NS_CCTV" wait --for=condition=complete --timeout=20m "$job"
log_ok "Qwen2.5-VL staged at $S3_PREFIX"

fi   # close the QWEN_STAGE branch (lesson 17.33 — always fall through to BGE-small)

# =============================================================================
#  Stage BGE-small-en-v1.5 (lesson 17.22)
#
#  The structure-and-write Tekton task embeds clip narrations with BGE-small
#  before INSERTing into Aurora pgvector. The task fetches the model from
#  `s3://${PD_BUCKET}/models/police-department/bge-small-en-v1.5/` because
#  HF direct downloads were unreliable mid-pipeline. On a hard-teardowned
#  cluster (S3 models prefix wiped) the model is missing, the task fetches
#  0 entries, sentence-transformers falls through to local-load on an empty
#  dir, transformers raises
#    ValueError: Unrecognized model in .../bge-small-en-v1.5
#  and every Indexing-in-Aurora step fails. ~130 MB, takes <30s to stage.
# =============================================================================
BGE_S3_PREFIX="s3://${PD_BUCKET}/models/police-department/bge-small-en-v1.5"
BGE_REPO="BAAI/bge-small-en-v1.5"

log_info "checking $BGE_S3_PREFIX/config.json..."
if aws s3 ls "$BGE_S3_PREFIX/config.json" >/dev/null 2>&1; then
  log_ok "BGE-small already staged; skipping"
else
  log_info "staging BGE-small via ephemeral Job"
  cat <<EOF | oc apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: pd-fetch-bge-$(date +%s)
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
        - { name: HF_TOKEN,              valueFrom: { secretKeyRef: { name: pd-hf-token, key: token } } }
        - { name: AWS_ACCESS_KEY_ID,     valueFrom: { secretKeyRef: { name: pd-s3-creds, key: access_key_id } } }
        - { name: AWS_SECRET_ACCESS_KEY, valueFrom: { secretKeyRef: { name: pd-s3-creds, key: secret_access_key } } }
        - { name: AWS_REGION,            value: "us-east-1" }
        - { name: BGE_S3_PREFIX,         value: "$BGE_S3_PREFIX" }
        - { name: BGE_REPO,              value: "$BGE_REPO" }
        command: ["/bin/bash", "-c"]
        args:
        - |
          set -euo pipefail
          pip install --quiet --no-cache-dir 'huggingface_hub==0.26.2' boto3==1.35.40
          python3 - <<'PY'
          import os
          from pathlib import Path
          from huggingface_hub import snapshot_download
          import boto3
          local = snapshot_download(repo_id=os.environ["BGE_REPO"],
                                    token=os.environ["HF_TOKEN"],
                                    local_dir="/tmp/bge")
          uri = os.environ["BGE_S3_PREFIX"].removeprefix("s3://")
          bucket, _, root = uri.partition("/")
          s3 = boto3.client("s3", region_name="us-east-1")
          for fp in Path(local).rglob("*"):
              if not fp.is_file(): continue
              key = f"{root}/{fp.relative_to(local).as_posix()}"
              s3.upload_file(str(fp), bucket, key)
              print(f"  -> s3://{bucket}/{key}", flush=True)
          PY
        resources:
          requests: { cpu: "100m", memory: "1Gi" }
          limits:   { cpu: "1",    memory: "2Gi" }
EOF
  job=$(oc -n "$PD_NS_CCTV" get job -l app.kubernetes.io/part-of=police-department \
          --sort-by=.metadata.creationTimestamp -o name | tail -n 1)
  oc -n "$PD_NS_CCTV" wait --for=condition=complete --timeout=10m "$job"
  log_ok "BGE-small staged at $BGE_S3_PREFIX"
fi
