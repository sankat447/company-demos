#!/usr/bin/env bash
# =============================================================================
# destroy.sh  –  Tear down all demo infrastructure
# Run from the same shell session used for deploy.sh (reuses cached tokens).
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${ROOT_DIR}/terraform"

echo "========================================"
echo "  Hybrid Patch Demo – DESTROY"
echo "  WARNING: This deletes all demo VMs"
echo "========================================"
read -rp "Type 'yes' to confirm destruction: " CONFIRM
[[ "${CONFIRM}" == "yes" ]] || { echo "Aborted."; exit 1; }

cd "${TF_DIR}"
terraform destroy -auto-approve

echo ""
echo "All demo resources destroyed."
