#!/usr/bin/env bash
# destroy.sh – Tear down all demo infrastructure
# Run from the same shell session as deploy.sh to reuse cached credentials.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${ROOT_DIR}/terraform"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Hybrid Patch Demo v2  –  DESTROY                          ║"
echo "║   This will DELETE all AWS and Azure demo resources.         ║"
echo "║   Estimated cost saved: ~$14-20/week by running this now.   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
read -rp "Type 'yes-destroy-all' to confirm: " CONFIRM
[[ "${CONFIRM}" == "yes-destroy-all" ]] || { echo "Aborted."; exit 1; }

cd "${TF_DIR}"
terraform destroy -auto-approve

echo ""
echo "All demo resources destroyed."
echo "Remember to: az logout && aws sso logout"
echo ""
# Clean up generated key
[[ -f "${TF_DIR}/aap_ec2_key.pem" ]] && rm -f "${TF_DIR}/aap_ec2_key.pem" && echo "SSH key removed."
