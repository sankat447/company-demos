# azure_update_manager.tf – Azure Update Manager, Log Analytics, monitoring
#
# Builds the full Azure-native update management layer:
#   - Log Analytics Workspace (VM diagnostics + patch audit logs)
#   - Azure Monitor diagnostic settings
#   - AUM Maintenance Configuration (weekly window – Saturday 02:00 UTC)
#   - AUM assignment linking the Windows VM to the maintenance window
#   - Azure Policy assignment: enforce periodic assessment on VMs

# ── Log Analytics Workspace ───────────────────────────────────────────────────
resource "azurerm_log_analytics_workspace" "demo" {
  name                = "law-${local.prefix}-${random_id.suffix.hex}"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location
  sku                 = "PerGB2018"
  retention_in_days   = 30   # Minimum; free tier includes 5 GB/month ingestion
  tags                = local.tags
}

# ── Log Analytics solution: Update Management view ────────────────────────────
resource "azurerm_log_analytics_solution" "updates" {
  solution_name         = "Updates"
  resource_group_name   = azurerm_resource_group.demo.name
  location              = azurerm_resource_group.demo.location
  workspace_resource_id = azurerm_log_analytics_workspace.demo.id
  workspace_name        = azurerm_log_analytics_workspace.demo.name

  plan {
    publisher = "Microsoft"
    product   = "OMSGallery/Updates"
  }
}

# ── Diagnostic settings: VM metrics + logs → Log Analytics ───────────────────
resource "azurerm_monitor_diagnostic_setting" "vm_diag" {
  name               = "diag-win-target"
  target_resource_id = azurerm_windows_virtual_machine.target.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.demo.id

  metric {
    category = "AllMetrics"
    enabled  = true
  }
}

# ── Azure Update Manager: Maintenance Configuration ───────────────────────────
# Saturday 02:00–04:00 UTC – matches client's preferred out-of-hours window
resource "azurerm_maintenance_configuration" "weekly_security" {
  name                = "mc-${local.prefix}-weekly-security"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location
  scope               = "InGuestPatch"

  install_patches {
    windows {
      classifications_to_include = [
        "Critical",
        "Security",
        "UpdateRollup",
        "FeaturePack",   # Visible in AUM – can deselect to show granularity
        "ServicePack",
        "Definition",
      ]
      kb_numbers_to_exclude = []   # Can add specific KBs to block
    }

    reboot = "IfRequired"
  }

  window {
    start_date_time      = "2025-01-04 02:00"   # First Saturday of demo window
    expiration_date_time = "2030-12-31 04:00"
    duration             = "02:00"               # 2-hour window
    time_zone            = "UTC"
    recur_every          = "Week Saturday"
  }

  visibility = "Custom"
  tags       = local.tags
}

# ── AUM: assign Windows VM to the maintenance window ─────────────────────────
resource "azurerm_maintenance_assignment_virtual_machine" "target" {
  location                     = azurerm_resource_group.demo.location
  maintenance_configuration_id = azurerm_maintenance_configuration.weekly_security.id
  virtual_machine_id           = azurerm_windows_virtual_machine.target.id
}

# ── Azure Monitor Alert: patch compliance drop ────────────────────────────────
resource "azurerm_monitor_action_group" "patch_alerts" {
  name                = "ag-patch-alerts-${local.prefix}"
  resource_group_name = azurerm_resource_group.demo.name
  short_name          = "patchalert"
  tags                = local.tags

  # Add email notification for demo – replace with real address
  email_receiver {
    name                    = "demo-engineer"
    email_address           = "demo-engineer@yourcompany.com"
    use_common_alert_schema = true
  }
}

# Alert fires when a VM has been non-compliant for >48 hours
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "patch_compliance" {
  name                = "alert-patch-noncompliant-${local.prefix}"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location

  evaluation_frequency = "PT6H"
  window_duration      = "PT48H"
  scopes               = [azurerm_log_analytics_workspace.demo.id]
  severity             = 2   # Warning

  criteria {
    query                   = <<-KQL
      Update
      | where UpdateState == "Needed" and Optional == false
      | where TimeGenerated > ago(48h)
      | summarize PendingCount = count() by Computer
      | where PendingCount > 5
    KQL
    time_aggregation_method = "Count"
    threshold               = 1
    operator                = "GreaterThanOrEqual"

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.patch_alerts.id]
  }

  tags = local.tags
}

# ── Azure Policy: enforce periodic assessment on VMs ─────────────────────────
# This is what James can point to: "policy ensures every VM is assessed automatically"
resource "azurerm_resource_group_policy_assignment" "periodic_assessment" {
  name                 = "enforce-patch-assessment"
  resource_group_id    = azurerm_resource_group.demo.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/59efceea-0c96-497e-a4a1-4eb2290dac15"

  description  = "Enforce periodic patch assessment on all VMs in the demo resource group"
  display_name = "Enforce periodic assessment – ${local.prefix}"

  non_compliance_message {
    content = "This VM must have Azure Update Manager periodic assessment enabled."
  }
}
