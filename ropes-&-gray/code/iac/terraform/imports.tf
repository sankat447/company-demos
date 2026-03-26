# imports.tf
locals {
  sub = "62e011bd-876a-4f15-aa29-5267d77768d2"
  rg  = "rg-patch-demo"
  pfx = "patch-demo"
}

import {
  id = "/subscriptions/${local.sub}/resourceGroups/${local.rg}"
  to = azurerm_resource_group.demo[0]
}

import {
  id = "/subscriptions/${local.sub}/resourceGroups/${local.rg}/providers/Microsoft.Network/virtualNetworks/vnet-${local.pfx}"
  to = azurerm_virtual_network.demo
}

import {
  id = "/subscriptions/${local.sub}/resourceGroups/${local.rg}/providers/Microsoft.Network/virtualNetworks/vnet-${local.pfx}/subnets/snet-windows-targets"
  to = azurerm_subnet.windows
}

import {
  id = "/subscriptions/${local.sub}/resourceGroups/${local.rg}/providers/Microsoft.Network/publicIPAddresses/pip-win-target-${local.pfx}"
  to = azurerm_public_ip.windows_target
}

import {
  id = "/subscriptions/${local.sub}/resourceGroups/${local.rg}/providers/Microsoft.Insights/actionGroups/ag-patch-alerts-${local.pfx}"
  to = azurerm_monitor_action_group.patch_alerts
}

import {
  id = "/subscriptions/${local.sub}/resourceGroups/${local.rg}/providers/Microsoft.Maintenance/maintenanceConfigurations/mc-${local.pfx}-weekly-security"
  to = azurerm_maintenance_configuration.weekly_security
}

import {
  id = "${local.pfx}-aap-key"
  to = aws_key_pair.aap
}