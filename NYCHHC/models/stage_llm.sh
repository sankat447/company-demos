#!/usr/bin/env bash
# =============================================================================
#  Stage the conversational LLM to the data lake so the KServe storage-initializer
#  can mount it (the cluster has NO HuggingFace egress — models must come from S3).
#  Idempotent: skips the download+upload if the model is already in S3 (FORCE=1
#  to re-stage). Default model = ibm-granite/granite-3.1-2b-instruct (ungated,
#  fits the A10G alongside vLLM). Override with HF_MODEL / S3_SUBDIR.
#
#    ./stage_llm.sh                 # stage granite-2b if not already in S3
#    FORCE=1 ./stage_llm.sh         # re-download + re-upload
# =============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

: "${AWS_PROFILE:=rhoai-demo}"
: "${AWS_REGION:=us-east-1}"
: "${BUCKET:=ai-demo-data-lake}"
: "${HF_MODEL:=ibm-granite/granite-3.1-2b-instruct}"
: "${S3_SUBDIR:=granite-2b}"
DEST="s3://${BUCKET}/models/nychhc/${S3_SUBDIR}"

if [[ "${FORCE:-0}" != "1" ]] && \
   aws s3 ls "${DEST}/config.json" --profile "$AWS_PROFILE" --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "✔ LLM already staged at ${DEST} (FORCE=1 to re-stage)"
  exit 0
fi

# huggingface_hub is the only extra dep; install on demand.
python -c "import huggingface_hub" 2>/dev/null || {
  echo "▶ Installing huggingface_hub"
  pip install -q "huggingface_hub>=0.23"
}

TMP="${LLM_STAGE_DIR:-$(mktemp -d)}/${S3_SUBDIR}"
echo "▶ Downloading ${HF_MODEL} (~5GB) → ${TMP}"
HF_MODEL="$HF_MODEL" TMP="$TMP" python - <<'PY'
import os
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id=os.environ["HF_MODEL"],
    local_dir=os.environ["TMP"],
    # weights + tokenizer + configs; skip .pth/.bin duplicates of safetensors.
    allow_patterns=["*.safetensors", "*.json", "*.txt", "*.model", "tokenizer*"],
)
PY

echo "▶ Uploading → ${DEST}"
aws s3 sync "$TMP" "$DEST" --delete --profile "$AWS_PROFILE" --region "$AWS_REGION"
echo "✔ LLM staged at ${DEST}"
