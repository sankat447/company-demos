output "aap_public_ip" {
  value = aws_eip.aap.public_ip
}

output "aap_eda_public_ip" {
  value = aws_eip.aap_eda.public_ip
}

output "aap_controller_private_ip" {
  value = aws_instance.aap.private_ip
}

output "aap_eda_private_ip" {
  value = aws_instance.aap_eda.private_ip
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

output "aap_ssh_eda" {
  value = "ssh -i ${path.root}/aap_ec2_key.pem ec2-user@${aws_eip.aap_eda.public_ip}"
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

output "aap_inventory" {
  description = "Ready-to-use AAP installer inventory - paste into /opt/aap-install/inventory on controller"
  value = <<-EOF
    [automationgateway]
    ${aws_instance.aap.private_ip} ansible_connection=local

    [automationcontroller]
    ${aws_instance.aap.private_ip} ansible_connection=local

    [automationeda]
    ${aws_instance.aap_eda.private_ip} ansible_user=ec2-user ansible_ssh_private_key_file=/home/ec2-user/.ssh/id_rsa

    [database]
    ${aws_instance.aap.private_ip} ansible_connection=local

    [all:vars]
    admin_password='!!SDemo12345'
    pg_host='${aws_instance.aap.private_ip}'
    pg_port=5432
    pg_database='awx'
    pg_username='awx'
    pg_password='!!SDemo12345'
    gateway_admin_password='!!SDemo12345'
    gateway_pg_host='${aws_instance.aap.private_ip}'
    gateway_pg_port=5432
    gateway_pg_database='gateway'
    gateway_pg_username='gateway'
    gateway_pg_password='!!SDemo12345'
    registry_url='registry.redhat.io'
    registry_username='skumar@iisl.com'
    registry_password='!!SDemo12345'
    automationedacontroller_admin_password='!!SDemo12345'
    automationedacontroller_pg_host='${aws_instance.aap.private_ip}'
    automationedacontroller_pg_port=5432
    automationedacontroller_pg_database='eda'
    automationedacontroller_pg_username='eda'
    automationedacontroller_pg_password='!!SDemo12345'
    redis_mode=standalone
  EOF
}