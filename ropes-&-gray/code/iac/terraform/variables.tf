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
  description = "AAP admin portal password (min 8 chars, complex)"
  type        = string
  sensitive   = true
  default     = "AapAdm1n!Demo"   # Override via TF_VAR_aap_admin_password
}

variable "rhn_username" {
  description = "Red Hat Network (access.redhat.com) username for RHEL subscription"
  type        = string
  sensitive   = true
  default     = ""   # Set via TF_VAR_rhn_username or deploy.sh prompt
}

variable "rhn_password" {
  description = "Red Hat Network password"
  type        = string
  sensitive   = true
  default     = ""   # Set via TF_VAR_rhn_password or deploy.sh prompt
}

variable "aap_manifest_b64" {
  description = "Base64-encoded AAP subscription manifest (from access.redhat.com)"
  type        = string
  sensitive   = true
  default     = ""   # Required for AAP licensing – see aap/install/README.md
}

# ── Azure ─────────────────────────────────────────────────────────────────────
variable "azure_subscription_id" {
  description = "Azure subscription ID"
  type        = string
  default     = ""   # Set via TF_VAR_azure_subscription_id or deploy.sh prompt
}

variable "azure_location" {
  description = "Azure region (e.g. uksouth, eastus, westeurope)"
  type        = string
  default     = "uksouth"
}

variable "windows_vm_size" {
  description = "Azure VM size for Windows patch target"
  type        = string
  default     = "Standard_B2s"   # 2 vCPU, 4 GB – sufficient for demo target
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
  default     = "DemoP@ssw0rd2024!"
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
