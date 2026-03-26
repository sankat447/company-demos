# azure_update_manager.tf – Azure Update Manager, Log Analytics, monitoring
#
# CSP subscription compatible version:
#   - Log Analytics Workspace (kept – base logging)
#   - AUM Maintenance Configuration (weekly Saturday window)
#   - AUM VM assignment
#   - Monitor action group for alerts
#
# Removed (CSP permission/registration restrictions):
#   - azurerm_log_analytics_solution  (needs Microsoft.OperationsManagement)
#   - azurerm_monitor_scheduled_query_rules_alert_v2 (needs Update table from solution)
#   - azurerm_resource_group_policy_assignment (needs Authorization/policyAssignments/write)

# ── Log Analytics Workspace ───────────────────────────────────────────────────
resource "azurerm_log_analytics_workspace" "demo" {
  name                = "law-${local.prefix}-${random_id.suffix.hex}"
  resource_group_name = local.rg_name
  location            = local.rg_location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

# ── Diagnostic settings: VM metrics → Log Analytics ───────────────────────────
resource "azurerm_monitor_diagnostic_setting" "vm_diag" {
  name                       = "diag-win-target"
  target_resource_id         = azurerm_windows_virtual_machine.target.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.demo.id

  enabled_metric {
    category = "AllMetrics"
  }
}

# ── Azure Update Manager: Maintenance Configuration ───────────────────────────
# Saturday 02:00-04:00 UTC – client's preferred out-of-hours window
resource "azurerm_maintenance_configuration" "weekly_security" {
  name                = "mc-${local.prefix}-weekly-security"
  resource_group_name = local.rg_name
  location            = local.rg_location
  scope               = "InGuestPatch"

  # Required when scope = InGuestPatch
  in_guest_user_patch_mode = "User"

  install_patches {
    windows {
      classifications_to_include = [
        "Critical",
        "Security",
        "UpdateRollup",
      ]
      kb_numbers_to_exclude = []
    }
    reboot = "IfRequired"
  }

  window {
    start_date_time      = "2025-01-04 02:00"
    expiration_date_time = "2030-12-31 04:00"
    duration             = "02:00"
    time_zone            = "UTC"
    recur_every          = "Week Saturday"
  }

  visibility = "Custom"
  tags       = local.tags
}

# ── AUM: assign Windows VM to the maintenance window ─────────────────────────
resource "azurerm_maintenance_assignment_virtual_machine" "target" {
  location                     = local.rg_location
  maintenance_configuration_id = azurerm_maintenance_configuration.weekly_security.id
  virtual_machine_id           = azurerm_windows_virtual_machine.target.id
}

# ── Azure Monitor Action Group (for future alerts) ────────────────────────────
resource "azurerm_monitor_action_group" "patch_alerts" {
  name                = "ag-patch-alerts-${local.prefix}"
  resource_group_name = local.rg_name
  short_name          = "patchalert"
  tags                = local.tags

  email_receiver {
    name                    = "demo-engineer"
    email_address           = "skumar@iisl.com"
    use_common_alert_schema = true
  }
}
