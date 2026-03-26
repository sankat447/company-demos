#!/usr/bin/env bash
# import_state.sh – Import all existing resources into Terraform state
# Run this whenever Terraform state is lost but resources still exist in AWS/Azure.
# Safe to run multiple times – skips resources already in state.
set -euo pipefail

SUB="62e011bd-876a-4f15-aa29-5267d77768d2"
RG="rg-patch-demo"
PREFIX="patch-demo"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Import existing resources into Terraform state            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Helper: import only if not already in state
import_if_missing() {
  local resource="$1"
  local id="$2"
  if terraform state show "${resource}" &>/dev/null 2>&1; then
    echo "  ✓ Already in state: ${resource}"
  else
    echo "  → Importing: ${resource}"
    terraform import "${resource}" "${id}" && \
      echo "  ✓ Imported: ${resource}" || \
      echo "  ! Failed (may not exist yet): ${resource}"
  fi
}

echo "── AWS resources ──────────────────────────────────────────────"

# Get current EIPs from AWS to find the right allocation IDs
AAP_EIP_ID=$(aws ec2 describe-addresses \
  --filters "Name=tag:Name,Values=${PREFIX}-aap-eip" \
  --query 'Addresses[0].AllocationId' --output text 2>/dev/null || echo "")

AAP_INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=${PREFIX}-aap-controller" \
             "Name=instance-state-name,Values=running,stopped,pending" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo "")

AAP_SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${PREFIX}-aap-sg" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "")

AAP_VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=${PREFIX}-aap-vpc" \
  --query 'Vpcs[0].VpcId' --output text 2>/dev/null || echo "")

AAP_SUBNET_ID=$(aws ec2 describe-subnets \
  --filters "Name=tag:Name,Values=${PREFIX}-aap-subnet" \
  --query 'Subnets[0].SubnetId' --output text 2>/dev/null || echo "")

AAP_IGW_ID=$(aws ec2 describe-internet-gateways \
  --filters "Name=tag:Name,Values=${PREFIX}-aap-igw" \
  --query 'InternetGateways[0].InternetGatewayId' --output text 2>/dev/null || echo "")

AAP_RT_ID=$(aws ec2 describe-route-tables \
  --filters "Name=tag:Name,Values=${PREFIX}-aap-rt" \
  --query 'RouteTables[0].RouteTableId' --output text 2>/dev/null || echo "")

AAP_RT_ASSOC_ID=$(aws ec2 describe-route-tables \
  --filters "Name=tag:Name,Values=${PREFIX}-aap-rt" \
  --query 'RouteTables[0].Associations[0].RouteTableAssociationId' --output text 2>/dev/null || echo "")

[[ "${AAP_VPC_ID}"       != "None" && -n "${AAP_VPC_ID}" ]]       && import_if_missing "aws_vpc.aap"                      "${AAP_VPC_ID}"
[[ "${AAP_IGW_ID}"       != "None" && -n "${AAP_IGW_ID}" ]]       && import_if_missing "aws_internet_gateway.aap"         "${AAP_IGW_ID}"
[[ "${AAP_SUBNET_ID}"    != "None" && -n "${AAP_SUBNET_ID}" ]]    && import_if_missing "aws_subnet.aap_public"            "${AAP_SUBNET_ID}"
[[ "${AAP_SG_ID}"        != "None" && -n "${AAP_SG_ID}" ]]        && import_if_missing "aws_security_group.aap"           "${AAP_SG_ID}"
[[ "${AAP_RT_ID}"        != "None" && -n "${AAP_RT_ID}" ]]        && import_if_missing "aws_route_table.aap_public"       "${AAP_RT_ID}"
[[ "${AAP_RT_ASSOC_ID}"  != "None" && -n "${AAP_RT_ASSOC_ID}" ]]  && import_if_missing "aws_route_table_association.aap_public" "${AAP_RT_ASSOC_ID}"
[[ "${AAP_INSTANCE_ID}"  != "None" && -n "${AAP_INSTANCE_ID}" ]]  && import_if_missing "aws_instance.aap"                "${AAP_INSTANCE_ID}"
[[ "${AAP_EIP_ID}"       != "None" && -n "${AAP_EIP_ID}" ]]       && import_if_missing "aws_eip.aap"                     "${AAP_EIP_ID}"

import_if_missing "aws_key_pair.aap" "${PREFIX}-aap-key"

echo ""
echo "── Azure resources ────────────────────────────────────────────"

BASE="subscriptions/${SUB}/resourceGroups/${RG}/providers"

import_if_missing "azurerm_resource_group.demo[0]" \
  "/subscriptions/${SUB}/resourceGroups/${RG}"

import_if_missing "azurerm_log_analytics_workspace.demo" \
  "/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.OperationalInsights/workspaces/law-${PREFIX}-$(terraform output -raw azure_log_analytics_workspace 2>/dev/null | cut -d/ -f11 || echo '')" 2>/dev/null || true

import_if_missing "azurerm_virtual_network.demo" \
  "/${BASE}/Microsoft.Network/virtualNetworks/vnet-${PREFIX}"

import_if_missing "azurerm_public_ip.windows_target" \
  "/${BASE}/Microsoft.Network/publicIPAddresses/pip-win-target-${PREFIX}"

import_if_missing "azurerm_network_security_group.windows_target" \
  "/${BASE}/Microsoft.Network/networkSecurityGroups/nsg-win-target-${PREFIX}"

import_if_missing "azurerm_monitor_action_group.patch_alerts" \
  "/${BASE}/Microsoft.Insights/actionGroups/ag-patch-alerts-${PREFIX}"

# Subnet (depends on VNet being imported first)
import_if_missing "azurerm_subnet.windows" \
  "/${BASE}/Microsoft.Network/virtualNetworks/vnet-${PREFIX}/subnets/snet-windows-targets"

# NIC (may or may not exist yet)
import_if_missing "azurerm_network_interface.windows_target" \
  "/${BASE}/Microsoft.Network/networkInterfaces/nic-win-target-${PREFIX}" 2>/dev/null || true

# Log Analytics workspace – get actual name from Azure
LAW_NAME=$(az monitor log-analytics workspace list \
  --resource-group "${RG}" \
  --query '[0].name' -o tsv 2>/dev/null || echo "")
if [[ -n "${LAW_NAME}" && "${LAW_NAME}" != "None" ]]; then
  import_if_missing "azurerm_log_analytics_workspace.demo" \
    "/${BASE}/Microsoft.OperationalInsights/workspaces/${LAW_NAME}"
fi

echo ""
echo "── Import complete. Running terraform plan to check state ──────"
terraform plan -out=tfplan 2>&1 | tail -20
echo ""
echo "  If plan looks correct (only additions, no unexpected changes):"
echo "  terraform apply tfplan"
