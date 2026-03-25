variable "enable_aws" {
  description = "Create AWS demo resources"
  type        = bool
  default     = false
}

variable "enable_azure" {
  description = "Create Azure demo resources"
  type        = bool
  default     = false
}

variable "aws_region" {
  description = "AWS region for demo VMs"
  type        = string
  default     = ""
}

variable "azure_location" {
  description = "Azure region for demo VMs (e.g. uksouth, eastus)"
  type        = string
  default     = ""
}

variable "allowed_cidr" {
  description = "Your public IP in CIDR notation for RDP/WinRM access (e.g. 1.2.3.4/32)"
  type        = string
  default     = "0.0.0.0/0"  # Restrict before real use
}

variable "demo_name_prefix" {
  description = "Prefix for all demo resource names"
  type        = string
  default     = "hybrid-patch-demo"
}

variable "windows_admin_username" {
  description = "Local administrator username for Windows VMs"
  type        = string
  default     = "demoAdmin"
}

variable "windows_admin_password" {
  description = "Local administrator password for Windows VMs (min 12 chars, complex)"
  type        = string
  sensitive   = true
  default     = "DemoP@ssw0rd2024!"   # Override in tfvars or TF_VAR_ env
}
