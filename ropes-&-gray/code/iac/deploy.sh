#!/usr/bin/env bash
# =============================================================================
# deploy.sh  –  Hybrid Patch Demo v2
# Deploys:  AWS (AAP 2.6 EC2)  +  Azure (Windows target + AUM + Log Analytics)
#
# Usage: bash iac/deploy.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${ROOT_DIR}/terraform"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Hybrid Patch Demo v2  –  Infrastructure Deploy            ║"
echo "║   AWS: AAP 2.6 (m5.xlarge RHEL9)                            ║"
echo "║   Azure: Windows target + AUM + Log Analytics               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Pre-flight checks ─────────────────────────────────────────────────────
echo "── Pre-flight checks ──"
for cmd in terraform aws az jq curl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' not found. Install it before running deploy.sh"
    exit 1
  fi
done
terraform version | head -1
echo "All tooling checks passed."
echo ""

# ── 2. AWS authentication ────────────────────────────────────────────────────
echo "── AWS Authentication ──"
echo "  1) AWS SSO profile (recommended)"
echo "  2) Static access key + secret"
read -rp "Select method [1/2]: " AWS_AUTH

if [[ "${AWS_AUTH}" == "1" ]]; then
  read -rp "AWS SSO profile name (from ~/.aws/config): " AWS_PROFILE
  export AWS_PROFILE
  export AWS_SDK_LOAD_CONFIG=1
  aws sso login --profile "${AWS_PROFILE}"
else
  read -rp  "AWS Access Key ID: "            AWS_ACCESS_KEY_ID
  read -rsp "AWS Secret Access Key: "        AWS_SECRET_ACCESS_KEY; echo
  read -rp  "AWS Region (default us-east-1): " AWS_REGION
  AWS_REGION="${AWS_REGION:-us-east-1}"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  export AWS_DEFAULT_REGION="${AWS_REGION}"
fi

read -rp "AWS region to deploy AAP (default us-east-1): " TF_AWS_REGION
TF_AWS_REGION="${TF_AWS_REGION:-us-east-1}"
export TF_VAR_aws_region="${TF_AWS_REGION}"
echo ""

# ── 3. Azure authentication ──────────────────────────────────────────────────
echo "── Azure Authentication ──"
echo "  1) Device code / interactive (recommended – supports SSO/MFA)"
echo "  2) Service principal"
read -rp "Select method [1/2]: " AZ_AUTH

if [[ "${AZ_AUTH}" == "1" ]]; then
  az login
  echo ""
  az account list --output table
  read -rp "Azure Subscription ID to use: " AZ_SUB_ID
  az account set --subscription "${AZ_SUB_ID}"
  export ARM_SUBSCRIPTION_ID="${AZ_SUB_ID}"
  export ARM_TENANT_ID="$(az account show --query tenantId -o tsv)"
  export TF_VAR_azure_subscription_id="${AZ_SUB_ID}"
else
  read -rp  "Azure Tenant ID: "       ARM_TENANT_ID
  read -rp  "Azure Subscription ID: " ARM_SUBSCRIPTION_ID
  read -rp  "Azure Client ID: "       ARM_CLIENT_ID
  read -rsp "Azure Client Secret: "   ARM_CLIENT_SECRET; echo
  export ARM_TENANT_ID ARM_SUBSCRIPTION_ID ARM_CLIENT_ID ARM_CLIENT_SECRET
  export TF_VAR_azure_subscription_id="${ARM_SUBSCRIPTION_ID}"
fi

read -rp "Azure region (default uksouth): " TF_AZ_LOCATION
TF_AZ_LOCATION="${TF_AZ_LOCATION:-uksouth}"
export TF_VAR_azure_location="${TF_AZ_LOCATION}"
echo ""

# ── 4. Red Hat credentials (needed for AAP installer) ────────────────────────
echo "── Red Hat Network credentials ──"
echo "  These are used to register the RHEL9 EC2 and download the AAP installer."
echo "  Required: active Red Hat account with AAP subscription or trial."
echo "  Sign up free trial at: https://www.redhat.com/en/technologies/management/ansible/trial"
read -rp  "Red Hat Username (access.redhat.com): " RHN_USER
read -rsp "Red Hat Password: "                      RHN_PASS; echo
export TF_VAR_rhn_username="${RHN_USER}"
export TF_VAR_rhn_password="${RHN_PASS}"
echo ""

# ── 5. Operator IP for firewall rules ─────────────────────────────────────────
echo "── Access control ──"
DETECTED_IP="$(curl -s --max-time 5 https://ifconfig.me/ip 2>/dev/null || echo '')"
if [[ -n "${DETECTED_IP}" ]]; then
  read -rp "Your public IP for SSH/RDP/UI access [detected: ${DETECTED_IP}]: " OPERATOR_IP
  OPERATOR_IP="${OPERATOR_IP:-${DETECTED_IP}}"
else
  read -rp "Your public IP for SSH/RDP/UI access (e.g. 1.2.3.4): " OPERATOR_IP
fi
export TF_VAR_operator_cidr="${OPERATOR_IP}/32"
echo ""

# ── 6. Passwords ─────────────────────────────────────────────────────────────
echo "── Credentials ──"
read -rsp "AAP admin password (min 8 chars, complex): "   AAP_PASS; echo
read -rsp "Windows VM admin password (min 12 chars): "    WIN_PASS; echo
export TF_VAR_aap_admin_password="${AAP_PASS}"
export TF_VAR_windows_admin_password="${WIN_PASS}"
echo ""

# ── 7. AAP manifest (optional at this stage) ─────────────────────────────────
echo "── AAP Subscription Manifest (optional – can add after deploy) ──"
echo "  Download from: https://access.redhat.com/management/subscription_allocations"
echo "  Then: base64 -w0 manifest.zip > manifest.b64 and paste here."
read -rp "Paste base64 manifest content (or press Enter to skip): " MANIFEST_B64
export TF_VAR_aap_manifest_b64="${MANIFEST_B64:-placeholder}"
echo ""

# ── 8. Terraform apply ───────────────────────────────────────────────────────
cd "${TF_DIR}"
echo "── Terraform init ──"
terraform init -upgrade

echo ""
echo "── Terraform plan ──"
terraform plan -out=tfplan

echo ""
echo "── Terraform apply ──"
terraform apply tfplan

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Infrastructure deployed.                                    ║"
echo "║  Next: install AAP 2.6 on EC2 (see outputs above)           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
terraform output next_steps
