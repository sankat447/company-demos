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
echo "║   Estimated cost saved: ~\$14-20/week by running this now.  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
read -rp "Type 'yes-destroy-all' to confirm: " CONFIRM
[[ "${CONFIRM}" == "yes-destroy-all" ]] || { echo "Aborted."; exit 1; }

cd "${TF_DIR}"

# ── Set placeholder values for all variables so Terraform does not prompt ────
# These are only used to satisfy validation – destroy does not apply them.
export TF_VAR_operator_cidr="${TF_VAR_operator_cidr:-1.2.3.4/32}"
export TF_VAR_aap_admin_password="${TF_VAR_aap_admin_password:-!!SDemo12345}"
export TF_VAR_windows_admin_password="${TF_VAR_windows_admin_password:-!!SDemo12345}"
export TF_VAR_rhn_username="${TF_VAR_rhn_username:-placeholder}"
export TF_VAR_rhn_password="${TF_VAR_rhn_password:-placeholder}"
export TF_VAR_aap_manifest_b64="${TF_VAR_aap_manifest_b64:-placeholder}"
export TF_VAR_azure_subscription_id="${TF_VAR_azure_subscription_id:-62e011bd-876a-4f15-aa29-5267d77768d2}"
export TF_VAR_use_existing_resource_group="${TF_VAR_use_existing_resource_group:-false}"
export TF_VAR_existing_resource_group_name="${TF_VAR_existing_resource_group_name:-placeholder}"

terraform destroy -auto-approve

echo ""
echo "All demo resources destroyed."
echo "Remember to: az logout && aws sso logout"
echo ""
# Clean up generated key
[[ -f "${TF_DIR}/aap_ec2_key.pem" ]] && rm -f "${TF_DIR}/aap_ec2_key.pem" && echo "SSH key removed."
