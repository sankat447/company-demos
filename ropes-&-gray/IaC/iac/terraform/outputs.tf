# outputs.tf  –  Surface IP addresses and credentials for Ansible inventory

output "aws_windows_public_ip" {
  description = "Public IP of the AWS Windows VM"
  value       = var.enable_aws ? aws_instance.demo_windows[0].public_ip : "N/A"
}

output "aws_windows_private_ip" {
  description = "Private IP of the AWS Windows VM"
  value       = var.enable_aws ? aws_instance.demo_windows[0].private_ip : "N/A"
}

output "azure_windows_public_ip" {
  description = "Public IP of the Azure Windows VM"
  value       = var.enable_azure ? azurerm_public_ip.demo[0].ip_address : "N/A"
}

output "azure_windows_private_ip" {
  description = "Private IP of the Azure Windows VM"
  value       = var.enable_azure ? azurerm_network_interface.demo[0].private_ip_address : "N/A"
}

output "windows_admin_username" {
  description = "Local admin username (same for both VMs)"
  value       = var.windows_admin_username
}

output "windows_admin_password" {
  description = "Local admin password (sensitive)"
  value       = var.windows_admin_password
  sensitive   = true
}

output "azure_resource_group" {
  description = "Azure resource group for Update Manager portal"
  value       = var.enable_azure ? azurerm_resource_group.demo[0].name : "N/A"
}

output "next_steps" {
  description = "What to do after deployment"
  value       = <<-EOF
    1. Copy VM IPs into ansible/inventory/demo_hosts.yml
    2. Test WinRM:  ansible windows -m win_ping -i ansible/inventory/
    3. Open Azure portal → Resource Group → Update Manager to see compliance
    4. Follow RUNBOOK.md for full deployment sequence
  EOF
}
