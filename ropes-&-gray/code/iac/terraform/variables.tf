# ── AWS ───────────────────────────────────────────────────────────────────────
variable "aws_region" {
  description = "AWS region for AAP EC2 instance"
  type        = string
  default     = "us-east-1"
}

variable "aap_instance_type" {
  description = "EC2 instance type for AAP 2.6 all-in-one (minimum m5.xlarge)"
  type        = string
  default     = "m5.xlarge"   # 4 vCPU, 16 GB RAM – AAP 2.6 minimum for all-in-one
}

variable "aap_volume_size_gb" {
  description = "Root volume size for AAP EC2 (GB) – AAP requires ≥100 GB"
  type        = number
  default     = 100
}

variable "operator_cidr" {
  description = "Your public IP in CIDR notation – used for SSH/UI access to AAP (e.g. 1.2.3.4/32)"
  type        = string
}

variable "aap_admin_password" {
  description = "AAP admin portal password"
  type        = string
  sensitive   = true
  default     = "!!SDemo12345"
}

variable "rhn_username" {
  description = "Red Hat Network (access.redhat.com) username for RHEL subscription"
  type        = string
  sensitive   = true
  default     = ""
}

variable "rhn_password" {
  description = "Red Hat Network password"
  type        = string
  sensitive   = true
  default     = ""
}

variable "aap_manifest_b64" {
  description = "Base64-encoded AAP subscription manifest (from access.redhat.com)"
  type        = string
  sensitive   = true
  default     = "placeholder"
}

# ── Azure ─────────────────────────────────────────────────────────────────────
variable "azure_subscription_id" {
  description = "Azure subscription ID"
  type        = string
  default     = ""
}

variable "azure_location" {
  description = "Azure region (e.g. uksouth, eastus, westeurope)"
  type        = string
  default     = "uksouth"
}

variable "use_existing_resource_group" {
  description = "Set to true to use an existing resource group instead of creating one (needed on CSP subscriptions where you don't have subscription-level write access)"
  type        = bool
  default     = false
}

variable "existing_resource_group_name" {
  description = "Name of an existing resource group to deploy Azure resources into (only used when use_existing_resource_group = true)"
  type        = string
  default     = ""
}

variable "windows_vm_size" {
  description = "Azure VM size for Windows patch target"
  type        = string
  default     = "Standard_B2s"
}

variable "windows_vm_size_aws" {
  description = "AWS EC2 instance type for Windows patch target"
  type        = string
  default     = "t3.medium"   # 2 vCPU, 4 GB - sufficient for demo target
}

variable "deploy_azure" {
  description = "Set to false to skip all Azure resources (use when Azure permissions are unavailable)"
  type        = bool
  default     = false   # Defaulting to false until RG permissions are granted
}

variable "windows_admin_username" {
  description = "Local admin username for the Azure Windows VM"
  type        = string
  default     = "demoAdmin"
}

variable "windows_admin_password" {
  description = "Local admin password for the Azure Windows VM"
  type        = string
  sensitive   = true
  default     = "!!SDemo12345"
}

# ── Shared ────────────────────────────────────────────────────────────────────
variable "demo_prefix" {
  description = "Name prefix for all demo resources"
  type        = string
  default     = "patch-demo"
}

variable "common_tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default = {
    Project     = "hybrid-patch-demo"
    Environment = "demo"
    ManagedBy   = "terraform"
    Owner       = "sa-team"
  }
}
