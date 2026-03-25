output "aap_public_ip" {
  description = "Elastic IP of AAP controller (stable – use this in Jira webhook config)"
  value       = aws_eip.aap.public_ip
}

output "aap_controller_url" {
  description = "AAP Controller UI URL"
  value       = "https://${aws_eip.aap.public_ip}"
}

output "aap_eda_webhook_url" {
  description = "EDA webhook receiver URL (configure this in Jira Automation rule)"
  value       = "https://${aws_eip.aap.public_ip}:8443/api/eda/v1/external_event_stream/jira-patch/"
}

output "aap_ssh_command" {
  description = "SSH command to log into AAP EC2 and run the installer"
  value       = "ssh -i ${path.root}/aap_ec2_key.pem ec2-user@${aws_eip.aap.public_ip}"
}

output "aap_private_key_path" {
  description = "Path to generated SSH private key (already chmod 0600)"
  value       = "${path.root}/aap_ec2_key.pem"
}

output "azure_windows_public_ip" {
  description = "Public IP of Azure Windows patch target"
  value       = azurerm_public_ip.windows_target.ip_address
}

output "azure_windows_private_ip" {
  description = "Private IP of Azure Windows patch target"
  value       = azurerm_network_interface.windows_target.private_ip_address
}

output "azure_resource_group" {
  description = "Azure resource group name"
  value       = azurerm_resource_group.demo.name
}

output "azure_log_analytics_workspace" {
  description = "Log Analytics workspace ID (for KQL queries)"
  value       = azurerm_log_analytics_workspace.demo.workspace_id
}

output "azure_maintenance_config" {
  description = "AUM maintenance configuration name"
  value       = azurerm_maintenance_configuration.weekly_security.name
}

output "windows_admin_username" {
  description = "Windows local admin username"
  value       = var.windows_admin_username
}

output "windows_admin_password" {
  description = "Windows local admin password"
  value       = var.windows_admin_password
  sensitive   = true
}

output "next_steps" {
  description = "Post-deploy checklist"
  value = <<-EOF

    ════════════════════════════════════════════════════
     Post-deploy checklist
    ════════════════════════════════════════════════════

    1. INSTALL AAP 2.6
       ${path.root}/aap_ec2_key.pem already created (chmod 0600)
       SSH in:
         ssh -i ${path.root}/aap_ec2_key.pem ec2-user@${aws_eip.aap.public_ip}
       Then run:
         sudo bash /opt/aap-install/aap_install.sh
       See: aap/install/README.md

    2. UPDATE ANSIBLE INVENTORY
       Edit ansible/inventory/azure_hosts.yml
       Replace AZURE_WIN_IP with: ${azurerm_public_ip.windows_target.ip_address}

    3. TEST WINRM (from AAP controller or workstation)
       ansible windows -m win_ping -i ansible/inventory/azure_hosts.yml

    4. CONFIGURE JIRA WEBHOOK
       EDA Webhook URL: https://${aws_eip.aap.public_ip}:8443/api/eda/v1/external_event_stream/jira-patch/
       See: jira/webhook_eda_config.md

    5. AZURE PORTAL VERIFY
       Open: https://portal.azure.com
       Navigate to: ${azurerm_resource_group.demo.name} → Update Manager
       Confirm VM appears in compliance view

    ════════════════════════════════════════════════════
  EOF
}
