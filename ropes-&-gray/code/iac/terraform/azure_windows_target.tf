# azure_windows_target.tf – Windows Server 2019 patch target VM
#
# This is the VM that AAP patches during the demo.
# Azure Update Manager monitors and manages its patch compliance.
# WinRM HTTPS is bootstrapped via custom script extension.

resource "azurerm_windows_virtual_machine" "target" {
  name                  = "vm-win-target"
  resource_group_name   = azurerm_resource_group.demo.name
  location              = azurerm_resource_group.demo.location
  size                  = var.windows_vm_size
  admin_username        = var.windows_admin_username
  admin_password        = var.windows_admin_password
  network_interface_ids = [azurerm_network_interface.windows_target.id]

  os_disk {
    name                 = "osdisk-win-target"
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 128
  }

  source_image_reference {
    publisher = "MicrosoftWindowsServer"
    offer     = "WindowsServer"
    sku       = "2019-Datacenter"
    version   = "latest"
  }

  # Required for Azure Update Manager to control patching
  patch_mode                = "AutomaticByPlatform"
  provision_vm_agent        = true
  enable_automatic_updates  = false   # AUM takes over scheduling

  # Hotpatch not available on 2019; set to false
  hotpatching_enabled = false

  # WinRM HTTPS listener bootstrapped via extension below
  winrm_listener {
    protocol        = "Https"
    certificate_url = ""   # Self-signed cert created by extension
  }

  tags = merge(local.tags, {
    Name         = "vm-win-target"
    OS           = "Windows Server 2019"
    AAPTarget    = "true"
    AUMManaged   = "true"
    PatchGroup   = "demo-security-updates"
  })

  depends_on = [azurerm_network_interface_security_group_association.windows_target]
}

# ── Custom Script Extension – configure WinRM HTTPS for Ansible ──────────────
# Creates a self-signed cert, enables WinRM HTTPS listener on 5986,
# opens the Windows Firewall, and sets a known local admin password.
resource "azurerm_virtual_machine_extension" "winrm_setup" {
  name                 = "WinRMSetup"
  virtual_machine_id   = azurerm_windows_virtual_machine.target.id
  publisher            = "Microsoft.Compute"
  type                 = "CustomScriptExtension"
  type_handler_version = "1.10"

  settings = jsonencode({
    commandToExecute = "powershell -ExecutionPolicy Unrestricted -Command \"${local.winrm_setup_cmd}\""
  })

  tags = local.tags
}

locals {
  winrm_setup_cmd = <<-PS
    $cert = New-SelfSignedCertificate -DnsName $env:COMPUTERNAME -CertStoreLocation Cert:\\LocalMachine\\My;
    $thumbprint = $cert.Thumbprint;
    winrm quickconfig -quiet;
    winrm set winrm/config/service '@{AllowUnencrypted=\"false\"}';
    winrm set winrm/config/service/auth '@{Basic=\"true\"}';
    New-Item -Path WSMan:\\LocalHost\\Listener -Transport HTTPS -Address * -CertificateThumbPrint $thumbprint -Force;
    netsh advfirewall firewall add rule name='WinRM HTTPS' dir=in localport=5986 protocol=TCP action=allow;
    Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -Name AutoAdminLogon -Value 0;
    Restart-Service winrm;
  PS
}

# ── VM Insights extension for Log Analytics integration ──────────────────────
resource "azurerm_virtual_machine_extension" "monitoring" {
  name                       = "MicrosoftMonitoringAgent"
  virtual_machine_id         = azurerm_windows_virtual_machine.target.id
  publisher                  = "Microsoft.EnterpriseCloud.Monitoring"
  type                       = "MicrosoftMonitoringAgent"
  type_handler_version       = "1.0"
  auto_upgrade_minor_version = true

  settings = jsonencode({
    workspaceId = azurerm_log_analytics_workspace.demo.workspace_id
  })

  protected_settings = jsonencode({
    workspaceKey = azurerm_log_analytics_workspace.demo.primary_shared_key
  })

  tags       = local.tags
  depends_on = [azurerm_windows_virtual_machine.target]
}
