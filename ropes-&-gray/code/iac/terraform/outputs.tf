output "aap_public_ip" {
  value = aws_eip.aap.public_ip
}

output "aap_controller_url" {
  value = "https://aap.iisdemolab.click"
}

output "aap_eda_webhook_url" {
  value = "https://aap.iisdemolab.click:8443/api/eda/v1/external_event_stream/jira-patch/"
}

output "aap_ssh_controller" {
  value = "ssh -i ${path.root}/aap_ec2_key.pem ec2-user@${aws_eip.aap.public_ip}"
}

output "aap_private_key_path" {
  value = "${path.root}/aap_ec2_key.pem"
}

output "azure_windows_public_ip" {
  value = azurerm_public_ip.windows_target.ip_address
}

output "azure_windows_private_ip" {
  value = azurerm_network_interface.windows_target.private_ip_address
}

output "azure_resource_group" {
  value = local.rg_name
}

output "azure_log_analytics_workspace" {
  value = azurerm_log_analytics_workspace.demo.workspace_id
}

output "azure_maintenance_config" {
  value = azurerm_maintenance_configuration.weekly_security.name
}

output "windows_admin_username" {
  value = var.windows_admin_username
}

output "windows_admin_password" {
  value     = var.windows_admin_password
  sensitive = true
}