#!/usr/bin/env bash
# =============================================================================
# demo-power-down.sh  –  Stop/deallocate demo VMs to save costs
#
# Stops the AWS EC2 (AAP) and Azure VM (Windows target) without destroying
# the infrastructure. Networking, disks, EIP, etc. remain intact.
#
# Cost savings:
#   AWS   – EC2 compute charges stop (~$0.192/hr for m5.xlarge)
#   Azure – VM compute charges stop (~$0.05/hr for Standard_B2s)
#   Note  – EBS/disk storage, EIP, and public IP still incur small charges
#
# Usage: bash iac/demo-power-down.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${ROOT_DIR}/terraform"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Hybrid Patch Demo  –  POWER DOWN (cost saving)            ║"
echo "║   Stops VMs but keeps all infrastructure intact.             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Pre-flight checks ─────────────────────────────────────────────────────────
for cmd in aws az terraform; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "  ERROR: '$cmd' not found. Install it first."
    exit 1
  fi
done

# ── Read resource identifiers from Terraform state ────────────────────────────
cd "${TF_DIR}"

echo "── Reading Terraform state ──"
echo ""

EC2_INSTANCE_ID="$(terraform output -raw aap_public_ip 2>/dev/null || echo "")"
if [[ -z "${EC2_INSTANCE_ID}" ]]; then
  echo "  ERROR: Could not read Terraform outputs. Is the infrastructure deployed?"
  exit 1
fi

# Get the EC2 instance ID from state
EC2_ID="$(terraform state show aws_instance.aap 2>/dev/null | grep '^\s*id\s' | head -1 | awk -F'"' '{print $2}')"
AAP_IP="$(terraform output -raw aap_public_ip 2>/dev/null)"
AZURE_RG="$(terraform output -raw azure_resource_group 2>/dev/null)"
AZURE_VM_NAME="vm-win-target"
WIN_IP="$(terraform output -raw azure_windows_public_ip 2>/dev/null)"

echo "  AWS EC2 Instance : ${EC2_ID}"
echo "  AWS AAP IP       : ${AAP_IP}"
echo "  Azure RG         : ${AZURE_RG}"
echo "  Azure VM         : ${AZURE_VM_NAME}"
echo "  Azure VM IP      : ${WIN_IP}"
echo ""

read -rp "  Stop both VMs? [y/N]: " CONFIRM
[[ "$(echo "${CONFIRM}" | tr '[:upper:]' '[:lower:]')" == "y" ]] || { echo "  Aborted."; exit 0; }

# ── Detect AWS region from state ──────────────────────────────────────────────
AWS_REGION="$(terraform state show aws_instance.aap 2>/dev/null | grep '^\s*availability_zone' | head -1 | awk -F'"' '{print $2}' | sed 's/[a-z]$//')"
AWS_REGION="${AWS_REGION:-us-east-1}"

# ── Check AWS credentials ────────────────────────────────────────────────────
echo ""
echo "── Checking AWS credentials ──"
if aws sts get-caller-identity --output table 2>/dev/null; then
  echo "  ✓ AWS authenticated"
else
  echo "  AWS session expired. Attempting SSO re-login..."
  AWS_PROFILE="patch-demo-sso"
  export AWS_PROFILE
  aws sso login --sso-session patch-demo-session 2>/dev/null || {
    echo "  ERROR: Could not authenticate to AWS. Run: aws sso login"
    exit 1
  }
fi

# ── Check Azure credentials ──────────────────────────────────────────────────
echo ""
echo "── Checking Azure credentials ──"
if az account show --output table 2>/dev/null; then
  echo "  ✓ Azure authenticated"
else
  echo "  Azure session expired. Re-logging in..."
  az login 2>/dev/null || az login --use-device-code
fi

# ── Stop AWS EC2 instance ────────────────────────────────────────────────────
echo ""
echo "── Stopping AWS EC2 (AAP controller): ${EC2_ID} ──"

EC2_STATE="$(aws ec2 describe-instances \
  --instance-ids "${EC2_ID}" \
  --region "${AWS_REGION}" \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text 2>/dev/null)"

if [[ "${EC2_STATE}" == "stopped" ]]; then
  echo "  Already stopped."
elif [[ "${EC2_STATE}" == "running" ]]; then
  aws ec2 stop-instances \
    --instance-ids "${EC2_ID}" \
    --region "${AWS_REGION}" \
    --output table
  echo "  Waiting for EC2 to stop..."
  aws ec2 wait instance-stopped \
    --instance-ids "${EC2_ID}" \
    --region "${AWS_REGION}"
  echo "  ✓ EC2 stopped"
else
  echo "  WARNING: EC2 is in state '${EC2_STATE}' – skipping."
fi

# ── Stop & deallocate Azure VM ───────────────────────────────────────────────
echo ""
echo "── Deallocating Azure VM: ${AZURE_VM_NAME} in ${AZURE_RG} ──"

AZ_POWER_STATE="$(az vm get-instance-view \
  --resource-group "${AZURE_RG}" \
  --name "${AZURE_VM_NAME}" \
  --query "instanceView.statuses[?starts_with(code,'PowerState/')].displayStatus" \
  --output tsv 2>/dev/null || echo "unknown")"

if [[ "${AZ_POWER_STATE}" == *"deallocated"* ]]; then
  echo "  Already deallocated."
elif [[ "${AZ_POWER_STATE}" == *"running"* || "${AZ_POWER_STATE}" == *"stopped"* ]]; then
  az vm deallocate \
    --resource-group "${AZURE_RG}" \
    --name "${AZURE_VM_NAME}" \
    --no-wait false
  echo "  ✓ Azure VM deallocated"
else
  echo "  WARNING: Azure VM is in state '${AZ_POWER_STATE}' – attempting deallocate anyway..."
  az vm deallocate \
    --resource-group "${AZURE_RG}" \
    --name "${AZURE_VM_NAME}" \
    --no-wait false 2>/dev/null || echo "  Could not deallocate. Check Azure portal."
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  POWER DOWN COMPLETE                                         ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  AWS EC2 (AAP)     : STOPPED                                 ║"
echo "║  Azure VM (Windows): DEALLOCATED                             ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Still incurring charges:                                    ║"
echo "║    • AWS EIP (unattached to running instance) ~$3.60/month   ║"
echo "║    • AWS EBS volume (100GB gp3) ~$8/month                    ║"
echo "║    • Azure managed disk (128GB) ~$19/month                   ║"
echo "║    • Azure public IP (static)   ~$3.60/month                 ║"
echo "║  Total idle cost: ~$34/month vs ~$200+/month running         ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  To power back on:  bash iac/demo-power-on.sh               ║"
echo "║  To destroy all:    bash iac/destroy.sh                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
