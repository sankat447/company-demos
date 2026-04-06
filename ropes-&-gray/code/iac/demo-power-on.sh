#!/usr/bin/env bash
# =============================================================================
# demo-power-on.sh  –  Start demo VMs back up for a demo session
#
# Starts the AWS EC2 (AAP) and Azure VM (Windows target) that were
# previously stopped by demo-power-down.sh.
#
# Note: The AWS EIP ensures the AAP public IP stays the same after restart.
#       The Azure public IP is static so it also stays the same.
#       AAP services (controller, EDA, hub) auto-start via podman/systemd.
#
# Usage: bash iac/demo-power-on.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${ROOT_DIR}/terraform"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Hybrid Patch Demo  –  POWER ON                            ║"
echo "║   Starting VMs for demo session.                             ║"
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

read -rp "  Start both VMs? [y/N]: " CONFIRM
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

# ── Start AWS EC2 instance ───────────────────────────────────────────────────
echo ""
echo "── Starting AWS EC2 (AAP controller): ${EC2_ID} ──"

EC2_STATE="$(aws ec2 describe-instances \
  --instance-ids "${EC2_ID}" \
  --region "${AWS_REGION}" \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text 2>/dev/null)"

if [[ "${EC2_STATE}" == "running" ]]; then
  echo "  Already running."
elif [[ "${EC2_STATE}" == "stopped" ]]; then
  aws ec2 start-instances \
    --instance-ids "${EC2_ID}" \
    --region "${AWS_REGION}" \
    --output table
  echo "  Waiting for EC2 to start..."
  aws ec2 wait instance-running \
    --instance-ids "${EC2_ID}" \
    --region "${AWS_REGION}"
  echo "  ✓ EC2 running"
else
  echo "  WARNING: EC2 is in state '${EC2_STATE}' – cannot start from this state."
fi

# ── Start Azure VM ───────────────────────────────────────────────────────────
echo ""
echo "── Starting Azure VM: ${AZURE_VM_NAME} in ${AZURE_RG} ──"

AZ_POWER_STATE="$(az vm get-instance-view \
  --resource-group "${AZURE_RG}" \
  --name "${AZURE_VM_NAME}" \
  --query "instanceView.statuses[?starts_with(code,'PowerState/')].displayStatus" \
  --output tsv 2>/dev/null || echo "unknown")"

if [[ "${AZ_POWER_STATE}" == *"running"* ]]; then
  echo "  Already running."
elif [[ "${AZ_POWER_STATE}" == *"deallocated"* || "${AZ_POWER_STATE}" == *"stopped"* ]]; then
  az vm start \
    --resource-group "${AZURE_RG}" \
    --name "${AZURE_VM_NAME}" \
    --no-wait false
  echo "  ✓ Azure VM running"
else
  echo "  WARNING: Azure VM is in state '${AZ_POWER_STATE}' – attempting start anyway..."
  az vm start \
    --resource-group "${AZURE_RG}" \
    --name "${AZURE_VM_NAME}" \
    --no-wait false 2>/dev/null || echo "  Could not start. Check Azure portal."
fi

# ── Wait for AAP services to come up ─────────────────────────────────────────
echo ""
echo "── Waiting for AAP services to initialize ──"
echo "  AAP containerized services take 3-5 minutes to fully start after boot."
echo "  Checking HTTPS on ${AAP_IP}..."
echo ""

MAX_WAIT=300   # 5 minutes
ELAPSED=0
INTERVAL=15

while [[ ${ELAPSED} -lt ${MAX_WAIT} ]]; do
  HTTP_CODE="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "https://${AAP_IP}" 2>/dev/null || echo "000")"
  if [[ "${HTTP_CODE}" =~ ^(200|301|302|303|307|308)$ ]]; then
    echo "  ✓ AAP is responding (HTTP ${HTTP_CODE})"
    break
  fi
  printf "  Waiting... (%ds / %ds) [HTTP %s]\r" "${ELAPSED}" "${MAX_WAIT}" "${HTTP_CODE}"
  sleep "${INTERVAL}"
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [[ ${ELAPSED} -ge ${MAX_WAIT} ]]; then
  echo ""
  echo "  WARNING: AAP did not respond within ${MAX_WAIT}s."
  echo "  This may be normal if AAP is still starting. Try:"
  echo "    ssh -i ${TF_DIR}/aap_ec2_key.pem ec2-user@${AAP_IP}"
  echo "    sudo podman ps    # check container status"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  POWER ON COMPLETE                                           ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  AAP Controller : %-41s║\n" "https://${AAP_IP}"
printf "║  AAP URL        : %-41s║\n" "https://aap.iisdemolab.click"
printf "║  Windows Target : %-41s║\n" "${WIN_IP}"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  SSH: ssh -i iac/terraform/aap_ec2_key.pem ec2-user@<IP>    ║"
echo "║  RDP: mstsc /v:${WIN_IP}                             ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  To power down:  bash iac/demo-power-down.sh                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
