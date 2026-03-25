#!/usr/bin/env bash
# =============================================================================
# deploy.sh  –  Hybrid Patch Demo: Interactive auth + Terraform apply
# Supports AWS SSO/keys and Azure device-code/service-principal auth.
# Usage: bash deploy.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${ROOT_DIR}/terraform"

echo "========================================"
echo "  Hybrid Patch Demo – Deployment"
echo "========================================"

# ── 1. Select clouds ──────────────────────────────────────────────────────────
read -rp "Deploy AWS resources? [y/N]: " USE_AWS
read -rp "Deploy Azure resources? [y/N]: " USE_AZURE
USE_AWS=${USE_AWS:-n}
USE_AZURE=${USE_AZURE:-n}

# ── 2. AWS auth ───────────────────────────────────────────────────────────────
if [[ "${USE_AWS,,}" == "y" ]]; then
  echo ""
  echo "── AWS Authentication ──"
  echo "  1) AWS SSO profile (recommended)"
  echo "  2) Static access key + secret"
  read -rp "Select method [1/2]: " AWS_AUTH

  if [[ "${AWS_AUTH}" == "1" ]]; then
    read -rp "AWS SSO profile name (from ~/.aws/config): " AWS_PROFILE
    export AWS_PROFILE
    export AWS_SDK_LOAD_CONFIG=1
    echo "Running: aws sso login --profile ${AWS_PROFILE}"
    aws sso login --profile "${AWS_PROFILE}"
  else
    read -rp  "AWS Access Key ID: "         AWS_ACCESS_KEY_ID
    read -rsp "AWS Secret Access Key: "     AWS_SECRET_ACCESS_KEY; echo
    read -rp  "AWS Region (e.g. us-east-1): " AWS_REGION
    export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    export AWS_DEFAULT_REGION="${AWS_REGION}"
  fi
fi

# ── 3. Azure auth ─────────────────────────────────────────────────────────────
if [[ "${USE_AZURE,,}" == "y" ]]; then
  echo ""
  echo "── Azure Authentication ──"
  echo "  1) Device code / interactive (supports SSO/MFA)"
  echo "  2) Service principal (client secret)"
  read -rp "Select method [1/2]: " AZ_AUTH

  if [[ "${AZ_AUTH}" == "1" ]]; then
    echo "Running: az login"
    az login
    read -rp "Azure Subscription ID to target: " AZ_SUB_ID
    az account set --subscription "${AZ_SUB_ID}"
    export ARM_SUBSCRIPTION_ID="${AZ_SUB_ID}"
    # Detect tenant automatically
    export ARM_TENANT_ID="$(az account show --query tenantId -o tsv)"
  else
    read -rp  "Azure Tenant ID: "       ARM_TENANT_ID
    read -rp  "Azure Subscription ID: " ARM_SUBSCRIPTION_ID
    read -rp  "Azure Client ID: "       ARM_CLIENT_ID
    read -rsp "Azure Client Secret: "   ARM_CLIENT_SECRET; echo
    export ARM_TENANT_ID ARM_SUBSCRIPTION_ID ARM_CLIENT_ID ARM_CLIENT_SECRET
  fi
fi

# ── 4. Terraform variable inputs ──────────────────────────────────────────────
cd "${TF_DIR}"

if [[ "${USE_AWS,,}" == "y" ]]; then
  read -rp "AWS region for demo VMs (e.g. us-east-1): " TF_AWS_REGION
  export TF_VAR_aws_region="${TF_AWS_REGION}"
else
  export TF_VAR_aws_region=""
fi

if [[ "${USE_AZURE,,}" == "y" ]]; then
  read -rp "Azure location for demo VMs (e.g. uksouth): " TF_AZ_LOCATION
  export TF_VAR_azure_location="${TF_AZ_LOCATION}"
else
  export TF_VAR_azure_location=""
fi

read -rp "Your public IP (for WinRM/RDP access, e.g. 1.2.3.4/32): " MY_IP
export TF_VAR_allowed_cidr="${MY_IP}"

export TF_VAR_enable_aws=$([[ "${USE_AWS,,}" == "y" ]] && echo true || echo false)
export TF_VAR_enable_azure=$([[ "${USE_AZURE,,}" == "y" ]] && echo true || echo false)

# ── 5. Terraform init → plan → apply ─────────────────────────────────────────
echo ""
echo "── Terraform init ──"
terraform init -upgrade

echo ""
echo "── Terraform plan ──"
terraform plan -out=tfplan

echo ""
echo "── Terraform apply ──"
terraform apply tfplan

echo ""
echo "========================================"
echo "  Deployment complete."
echo "  Run: terraform -chdir=terraform output"
echo "  to retrieve VM IPs and credentials."
echo "========================================"
