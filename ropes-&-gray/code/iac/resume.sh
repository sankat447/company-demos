#!/usr/bin/env bash
# =============================================================================
# resume.sh  –  Resume deploy from Step 5 (IP / passwords / Terraform)
# Use this when AWS + Azure logins are already cached from a previous run.
#
# Usage: bash iac/resume.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${ROOT_DIR}/terraform"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Hybrid Patch Demo v2  –  Resume Deploy                    ║"
echo "║   (AWS + Azure sessions already authenticated)               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Re-activate existing sessions ────────────────────────────────────────────
echo "── Re-activating AWS SSO session ──"
AWS_PROFILE="patch-demo-sso"
export AWS_PROFILE
export AWS_SDK_LOAD_CONFIG=1
export AWS_DEFAULT_REGION="${TF_VAR_aws_region:-us-east-1}"

# Refresh the SSO token silently (no browser needed if still valid)
aws sts get-caller-identity --profile "${AWS_PROFILE}" --output table 2>/dev/null || {
  echo "  Session expired – re-logging in..."
  aws sso login --sso-session patch-demo-session
  aws sts get-caller-identity --profile "${AWS_PROFILE}" --output table
}


echo ""
echo "── Re-activating Azure session ──"
az account show --output table 2>/dev/null || {
  echo "  Session expired – re-logging in..."
  az login
}
AZ_SUB_ID="$(az account show --query id -o tsv)"
export ARM_SUBSCRIPTION_ID="${AZ_SUB_ID}"
export ARM_TENANT_ID="$(az account show --query tenantId -o tsv)"
export TF_VAR_azure_subscription_id="${AZ_SUB_ID}"
export TF_VAR_aws_region="${TF_VAR_aws_region:-us-east-1}"
echo "  ✓ Azure: ${AZ_SUB_ID}"

# ── Azure resource group ───────────────────────────────────────────────────────
echo ""
echo "── Azure resource group ──"
echo ""
echo "  Checking resource groups you have access to..."
az group list --query '[].{Name:name, Location:location}' --output table 2>/dev/null || \
  echo "  (could not list – you may have scoped access only)"
echo ""
echo "  Do you want to:"
echo "    1) Use an EXISTING resource group from the list above"
echo "    2) Create a NEW resource group called rg-patch-demo (requires subscription Contributor)"
echo ""
read -rp "  Select [1/2]: " RG_CHOICE

if [[ "${RG_CHOICE}" == "1" ]]; then
  read -rp "  Enter the exact resource group name: " EXISTING_RG
  export TF_VAR_use_existing_resource_group="true"
  export TF_VAR_existing_resource_group_name="${EXISTING_RG}"
  # Get the location from the existing RG
  RG_LOCATION="$(az group show --name "${EXISTING_RG}" --query location -o tsv 2>/dev/null || echo 'uksouth')"
  export TF_VAR_azure_location="${RG_LOCATION}"
  echo "  ✓ Will use existing resource group: ${EXISTING_RG} (${RG_LOCATION})"
else
  export TF_VAR_use_existing_resource_group="false"
  export TF_VAR_existing_resource_group_name=""
  read -rp "  Azure region for new resource group (default uksouth): " AZ_LOC
  export TF_VAR_azure_location="${AZ_LOC:-uksouth}"
  echo "  ✓ Will create new resource group: rg-patch-demo"
fi

# ── Red Hat ───────────────────────────────────────────────────────────────────
echo ""
echo "── Red Hat credentials ──"
read -rp  "  Red Hat username: " RHN_USER
read -rsp "  Red Hat password: " RHN_PASS; echo
export TF_VAR_rhn_username="${RHN_USER}"
export TF_VAR_rhn_password="${RHN_PASS}"
read -rsp "  Red Hat offline token (from console.redhat.com/ansible/automation-hub/token): " RHN_TOKEN; echo
export TF_VAR_rhn_offline_token="${RHN_TOKEN}"

# ── IP detection ─────────────────────────────────────────────────────────────
echo ""
echo "── Detecting your public IP ──"
DETECTED_IP=""
for svc in "https://ifconfig.me/ip" "https://api.ipify.org" "https://checkip.amazonaws.com"; do
  DETECTED_IP="$(curl -s --max-time 6 "${svc}" 2>/dev/null | tr -d '[:space:]')"
  [[ "${DETECTED_IP}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && break
  DETECTED_IP=""
done

echo "  Detected: ${DETECTED_IP:-unknown}"
read -rp "  Use ${DETECTED_IP} for SSH/RDP/AAP access? [Y/n]: " CONFIRM_IP
if [[ "$(echo "${CONFIRM_IP}" | tr '[:upper:]' '[:lower:]')" == "n" ]]; then
  read -rp "  Enter your public IP: " OPERATOR_IP
else
  OPERATOR_IP="${DETECTED_IP}"
fi
export TF_VAR_operator_cidr="${OPERATOR_IP}/32"
echo "  ✓ Using: ${OPERATOR_IP}/32"

# ── Passwords ─────────────────────────────────────────────────────────────────
echo ""
echo "── Demo passwords ──"
echo "  Default password for all components: !!SDemo12345"
echo "  Press Enter to accept default, or type a custom password."
echo ""
read -rsp "  AAP admin password [default: !!SDemo12345]: " AAP_PASS; echo
AAP_PASS="${AAP_PASS:-!!SDemo12345}"
read -rsp "  Windows VM password [default: !!SDemo12345]: " WIN_PASS; echo
WIN_PASS="${WIN_PASS:-!!SDemo12345}"
export TF_VAR_aap_admin_password="${AAP_PASS}"
export TF_VAR_windows_admin_password="${WIN_PASS}"
export TF_VAR_aap_manifest_b64="placeholder"

# ── Terraform ────────────────────────────────────────────────────────────────
echo ""
echo "── Terraform deploy ──"
read -rp "  Proceed with deployment? [y/N]: " PROCEED
[[ "$(echo "${PROCEED}" | tr '[:upper:]' '[:lower:]')" == "y" ]] || { echo "Aborted."; exit 0; }

cd "${TF_DIR}"
terraform init -upgrade
terraform plan -out=tfplan
terraform apply tfplan

AAP_IP="$(terraform output -raw aap_public_ip 2>/dev/null || echo 'check terraform output')"
WIN_IP="$(terraform output -raw azure_windows_public_ip 2>/dev/null || echo 'check terraform output')"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  DEPLOYMENT COMPLETE                                         ║"
printf "║  AAP EC2 IP  : %-45s║\n" "${AAP_IP}"
printf "║  Azure VM IP : %-45s║\n" "${WIN_IP}"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  SSH: ssh -i iac/terraform/aap_ec2_key.pem ec2-user@<IP>     ║"
echo "║  See: aap/install/README.md                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
terraform output next_steps 2>/dev/null || true
