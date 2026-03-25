#!/usr/bin/env bash
# =============================================================================
# deploy.sh  –  Hybrid Patch Demo v2
# Browser-based login for AWS, Azure and Red Hat — no profile setup needed.
#
# AWS   → opens browser via AWS SSO / Identity Center  OR  IAM console
# Azure → opens browser via az login  (device code / interactive)
# RH    → opens browser to access.redhat.com  (credentials still typed)
#
# Usage: bash iac/deploy.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${ROOT_DIR}/terraform"

# ── Helpers ───────────────────────────────────────────────────────────────────
open_browser() {
  local url="$1"
  if command -v open &>/dev/null; then       # macOS
    open "$url"
  elif command -v xdg-open &>/dev/null; then # Linux X11
    xdg-open "$url" &>/dev/null &
  else
    echo "  → Open manually: $url"
  fi
}

banner() {
  echo ""
  echo "┌─────────────────────────────────────────────────────────────┐"
  printf  "│  %-61s│\n" "$1"
  echo "└─────────────────────────────────────────────────────────────┘"
}

pause() { read -rp "  Press Enter to continue once done in the browser..."; }

# ── Welcome ───────────────────────────────────────────────────────────────────
clear
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Hybrid Patch Demo v2  –  Infrastructure Deploy            ║"
echo "║   AWS: AAP 2.6 (m5.xlarge RHEL9)                            ║"
echo "║   Azure: Windows target + AUM + Log Analytics               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Browser windows will open for each cloud login."
echo "  Complete each login in the browser then return here."
echo ""

# ═════════════════════════════════════════════════════════════════════════════
# STEP 1 – Pre-flight checks
# ═════════════════════════════════════════════════════════════════════════════
banner "Step 1 of 7 │ Pre-flight checks"
echo ""

MISSING=()
for cmd in terraform aws az jq curl python3; do
  if command -v "$cmd" &>/dev/null; then
    printf "  ✓  %-12s %s\n" "$cmd" "$("${cmd}" --version 2>&1 | head -1)"
  else
    printf "  ✗  %-12s NOT FOUND\n" "$cmd"
    MISSING+=("$cmd")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo ""
  echo "  ERROR: Missing tools: ${MISSING[*]}"
  echo "  Install on macOS:"
  for m in "${MISSING[@]}"; do
    case "$m" in
      az)        echo "    brew install azure-cli" ;;
      aws)       echo "    brew install awscli" ;;
      terraform) echo "    brew tap hashicorp/tap && brew install hashicorp/tap/terraform" ;;
      jq)        echo "    brew install jq" ;;
      python3)   echo "    brew install python3" ;;
    esac
  done
  exit 1
fi
echo ""
echo "  All tools found."

# ═════════════════════════════════════════════════════════════════════════════
# STEP 2 – AWS browser login
# ═════════════════════════════════════════════════════════════════════════════
banner "Step 2 of 7 │ AWS – browser login"
echo ""
echo "  How do you log in to AWS?"
echo ""
echo "    1) AWS IAM Identity Center / SSO  (company account – opens browser)"
echo "    2) AWS IAM user                   (personal / test account – console)"
echo ""
read -rp "  Select [1/2]: " AWS_METHOD
echo ""

case "${AWS_METHOD}" in

  1)
    # ── SSO / Identity Center ──────────────────────────────────────────────
    echo "  We will configure a temporary SSO session and open your browser."
    echo ""
    read -rp "  Your AWS SSO start URL  (e.g. https://mycompany.awsapps.com/start): " SSO_URL
    read -rp "  AWS region where IAM Identity Center is deployed (e.g. us-east-1): " SSO_REGION
    SSO_REGION="${SSO_REGION:-us-east-1}"
    AWS_PROFILE="patch-demo-sso"
    mkdir -p ~/.aws

    # Write sso-session + profile into ~/.aws/config
    python3 - "${AWS_PROFILE}" "${SSO_URL}" "${SSO_REGION}" <<'PYEOF'
import configparser, pathlib, sys
profile, sso_url, sso_region = sys.argv[1], sys.argv[2], sys.argv[3]
cfg_path = pathlib.Path.home() / ".aws" / "config"
cfg = configparser.RawConfigParser()
if cfg_path.exists():
    cfg.read(cfg_path)
# sso-session block
ss = "sso-session patch-demo-session"
if ss not in cfg: cfg[ss] = {}
cfg[ss]["sso_start_url"]           = sso_url
cfg[ss]["sso_region"]              = sso_region
cfg[ss]["sso_registration_scopes"] = "sso:account:access"
# profile block (account_id + role filled after login)
sec = f"profile {profile}"
if sec not in cfg: cfg[sec] = {}
cfg[sec]["sso_session"] = "patch-demo-session"
cfg[sec]["region"]      = sso_region
cfg[sec]["output"]      = "json"
with open(cfg_path, "w") as f:
    cfg.write(f)
print(f"  AWS config written → profile: {profile}")
PYEOF

    echo ""
    echo "  Opening browser for AWS SSO login..."
    aws sso login --sso-session patch-demo-session
    echo ""

    # Show available accounts so user can pick
    echo "  Fetching AWS accounts accessible to your SSO session..."
    SSO_TOKEN="$(python3 - <<'PYEOF2'
import json, os, glob, pathlib, time
cache_dir = pathlib.Path.home() / ".aws" / "sso" / "cache"
best = None
for f in cache_dir.glob("*.json"):
    try:
        data = json.loads(f.read_text())
        if "accessToken" in data:
            exp = data.get("expiresAt","")
            if best is None or exp > best[0]:
                best = (exp, data["accessToken"])
    except Exception:
        pass
print(best[1] if best else "")
PYEOF2
)"
    if [[ -n "${SSO_TOKEN}" ]]; then
      echo ""
      echo "  Accounts available:"
      aws sso list-accounts \
        --access-token "${SSO_TOKEN}" \
        --region "${SSO_REGION}" \
        --query 'accountList[*].[accountId,accountName]' \
        --output table 2>/dev/null || echo "  (could not list accounts – enter manually)"
    fi

    echo ""
    read -rp "  AWS Account ID to deploy into: "              SSO_ACCOUNT_ID
    read -rp "  SSO Role name (e.g. AdministratorAccess):    " SSO_ROLE

    python3 - "${AWS_PROFILE}" "${SSO_ACCOUNT_ID}" "${SSO_ROLE}" <<'PYEOF3'
import configparser, pathlib, sys
profile, account_id, role = sys.argv[1], sys.argv[2], sys.argv[3]
cfg_path = pathlib.Path.home() / ".aws" / "config"
cfg = configparser.RawConfigParser()
cfg.read(cfg_path)
sec = f"profile {profile}"
cfg[sec]["sso_account_id"] = account_id
cfg[sec]["sso_role_name"]  = role
with open(cfg_path, "w") as f:
    cfg.write(f)
print(f"  Profile '{profile}' updated.")
PYEOF3

    export AWS_PROFILE="${AWS_PROFILE}"
    export AWS_SDK_LOAD_CONFIG=1
    echo ""
    echo "  Verifying AWS identity..."
    aws sts get-caller-identity --profile "${AWS_PROFILE}" --output table
    ;;

  2)
    # ── IAM user – get keys from AWS console ──────────────────────────────
    echo "  Opening AWS Console – go to IAM → Security credentials → Create access key"
    echo ""
    open_browser "https://console.aws.amazon.com/iam/home#/security_credentials"
    pause
    echo ""
    read -rp  "  AWS Access Key ID     : " AWS_ACCESS_KEY_ID
    read -rsp "  AWS Secret Access Key : " AWS_SECRET_ACCESS_KEY; echo
    export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    echo ""
    echo "  Verifying AWS identity..."
    aws sts get-caller-identity --output table
    ;;

  *)
    echo "  Invalid selection. Exiting."; exit 1 ;;
esac

echo ""
read -rp "  AWS region to deploy AAP into (default us-east-1): " TF_AWS_REGION
TF_AWS_REGION="${TF_AWS_REGION:-us-east-1}"
export TF_VAR_aws_region="${TF_AWS_REGION}"
export AWS_DEFAULT_REGION="${TF_AWS_REGION}"
echo "  ✓ AWS ready"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 3 – Azure browser login
# ═════════════════════════════════════════════════════════════════════════════
banner "Step 3 of 7 │ Azure – browser login"
echo ""
echo "  Opening browser for Azure login..."
echo "  Sign in with your Azure account when the browser opens."
echo ""

# az login on macOS opens the system browser automatically.
# Falls back to device-code flow in headless environments.
az login 2>/dev/null || az login --use-device-code

echo ""
echo "  Your Azure subscriptions:"
az account list \
  --query '[].{Name:name, SubscriptionId:id, State:state}' \
  --output table

echo ""
read -rp "  Azure Subscription ID to use: " AZ_SUB_ID
az account set --subscription "${AZ_SUB_ID}"

export ARM_SUBSCRIPTION_ID="${AZ_SUB_ID}"
export ARM_TENANT_ID="$(az account show --query tenantId -o tsv)"
export TF_VAR_azure_subscription_id="${AZ_SUB_ID}"

echo ""
read -rp "  Azure region (default uksouth – good for UK clients, use eastus for US): " TF_AZ_LOCATION
TF_AZ_LOCATION="${TF_AZ_LOCATION:-uksouth}"
export TF_VAR_azure_location="${TF_AZ_LOCATION}"
echo "  ✓ Azure ready  (subscription: ${AZ_SUB_ID}  tenant: ${ARM_TENANT_ID})"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 4 – Red Hat account (browser to get credentials)
# ═════════════════════════════════════════════════════════════════════════════
banner "Step 4 of 7 │ Red Hat account"
echo ""
echo "  Red Hat credentials are needed so the AAP EC2 can:"
echo "    • Register with subscription-manager (RHEL licence)"
echo "    • Download AAP 2.6 installer from access.redhat.com"
echo ""
echo "  Do you have a Red Hat account with an AAP entitlement?"
echo ""
echo "    1) Yes – I have one, open browser to log in"
echo "    2) No  – open browser to sign up for a free 60-day trial"
echo ""
read -rp "  Select [1/2]: " RH_CHOICE

case "${RH_CHOICE}" in
  1)
    echo ""
    echo "  Opening Red Hat portal..."
    open_browser "https://access.redhat.com"
    echo "  Log in and confirm you can see your AAP subscription."
    ;;
  2)
    echo ""
    echo "  Opening Red Hat free trial signup page..."
    open_browser "https://www.redhat.com/en/technologies/management/ansible/trial"
    echo "  Complete the form, verify your email, then return here."
    echo "  (Takes ~3 minutes. You do NOT need a credit card.)"
    ;;
esac

echo ""
pause
echo ""
echo "  Opening AAP 2.6 installer download page (save this tab)..."
open_browser "https://access.redhat.com/downloads/content/480"
echo ""
echo "  Opening subscription allocations page (you will need this for the manifest)..."
open_browser "https://access.redhat.com/management/subscription_allocations"
echo ""
echo "  Leave those browser tabs open – you will need them during AAP installation."
echo "  See aap/install/README.md for the exact download and install steps."
echo ""
read -rp  "  Red Hat username (your account email): " RHN_USER
read -rsp "  Red Hat password: "                      RHN_PASS; echo

export TF_VAR_rhn_username="${RHN_USER}"
export TF_VAR_rhn_password="${RHN_PASS}"
echo "  ✓ Red Hat credentials saved (used during AAP EC2 installation)"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 5 – Operator IP for firewall rules
# ═════════════════════════════════════════════════════════════════════════════
banner "Step 5 of 7 │ Access control – your public IP"
echo ""
echo "  Detecting your public IP address..."

DETECTED_IP=""
for svc in "https://ifconfig.me/ip" "https://api.ipify.org" "https://checkip.amazonaws.com"; do
  DETECTED_IP="$(curl -s --max-time 6 "${svc}" 2>/dev/null | tr -d '[:space:]')"
  [[ "${DETECTED_IP}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && break
  DETECTED_IP=""
done

if [[ -n "${DETECTED_IP}" ]]; then
  echo "  Detected: ${DETECTED_IP}"
  read -rp "  Use this for SSH / RDP / AAP UI access? [Y/n]: " CONFIRM_IP
  if [[ "${CONFIRM_IP,,}" == "n" ]]; then
    read -rp "  Enter your public IP manually: " OPERATOR_IP
  else
    OPERATOR_IP="${DETECTED_IP}"
  fi
else
  echo "  Could not detect automatically."
  open_browser "https://ifconfig.me"
  pause
  read -rp "  Enter your public IP: " OPERATOR_IP
fi

export TF_VAR_operator_cidr="${OPERATOR_IP}/32"
echo "  ✓ Firewall will allow inbound from: ${OPERATOR_IP}/32"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 6 – Demo passwords
# ═════════════════════════════════════════════════════════════════════════════
banner "Step 6 of 7 │ Demo passwords"
echo ""
echo "  Set passwords for the two demo components."
echo ""

# AAP admin password
while true; do
  read -rsp "  AAP admin password (≥8 chars, upper+lower+number+symbol): " AAP_PASS; echo
  if [[ ${#AAP_PASS} -ge 8 ]]; then break
  else echo "  Too short. Minimum 8 characters."; fi
done

# Windows VM admin password
while true; do
  read -rsp "  Windows VM password (≥12 chars, upper+lower+number+symbol): " WIN_PASS; echo
  if [[ ${#WIN_PASS} -ge 12 ]]; then break
  else echo "  Too short. Minimum 12 characters."; fi
done

export TF_VAR_aap_admin_password="${AAP_PASS}"
export TF_VAR_windows_admin_password="${WIN_PASS}"
export TF_VAR_aap_manifest_b64="placeholder"  # Added manually after Terraform (see aap/install/README.md)
echo "  ✓ Passwords set"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 7 – Terraform
# ═════════════════════════════════════════════════════════════════════════════
banner "Step 7 of 7 │ Deploy infrastructure"
echo ""
echo "  About to create:"
echo "    AWS   → EC2 m5.xlarge RHEL9     (AAP 2.6 controller + EDA)"
echo "    AWS   → VPC, subnet, EIP, SGs"
echo "    Azure → Windows Server 2019 B2s (patch target)"
echo "    Azure → VNet, NSG, public IP"
echo "    Azure → Log Analytics workspace + AUM maintenance config + Policy"
echo ""
echo "  Estimated infrastructure cost: ~\$2–3 while Terraform runs."
echo "  Teardown with: bash iac/destroy.sh"
echo ""
read -rp "  Proceed with deployment? [y/N]: " PROCEED
[[ "${PROCEED,,}" == "y" ]] || { echo "  Aborted."; exit 0; }

cd "${TF_DIR}"

echo ""
echo "── Terraform init ──────────────────────────────────────────────"
terraform init -upgrade

echo ""
echo "── Terraform plan ──────────────────────────────────────────────"
terraform plan -out=tfplan

echo ""
echo "── Terraform apply ─────────────────────────────────────────────"
terraform apply tfplan

# ═════════════════════════════════════════════════════════════════════════════
# Post-deploy
# ═════════════════════════════════════════════════════════════════════════════
AAP_IP="$(terraform output -raw aap_public_ip 2>/dev/null || echo 'check terraform output')"
WIN_IP="$(terraform output -raw azure_windows_public_ip 2>/dev/null || echo 'check terraform output')"
SSH_CMD="$(terraform output -raw aap_ssh_command 2>/dev/null || echo "ssh -i ${TF_DIR}/aap_ec2_key.pem ec2-user@${AAP_IP}")"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  DEPLOYMENT COMPLETE                                         ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  AAP EC2 public IP  : %-39s║\n" "${AAP_IP}"
printf "║  Azure Windows IP   : %-39s║\n" "${WIN_IP}"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  WHAT TO DO NEXT:                                            ║"
echo "║  1. Download AAP 2.6 bundle from browser tab you opened      ║"
echo "║  2. SCP bundle + manifest.zip to the EC2 (see below)         ║"
echo "║  3. SSH in and run: sudo bash /opt/aap-install/aap_install.sh║"
echo "║  4. See aap/install/README.md for full installation guide    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  SSH command (key file generated by Terraform):"
echo "  ${SSH_CMD}"
echo ""
echo "  SCP installer bundle:"
echo "  scp -i ${TF_DIR}/aap_ec2_key.pem \\"
echo "    ansible-automation-platform-setup-bundle-2.6-1-x86_64.tar.gz \\"
echo "    ec2-user@${AAP_IP}:/opt/aap-install/"
echo ""

# Open AAP URL (will 404 until AAP is installed – that is expected)
echo "  Opening AAP URL in browser (will be ready after AAP installation)..."
open_browser "https://${AAP_IP}"
echo ""
terraform output next_steps 2>/dev/null || true
