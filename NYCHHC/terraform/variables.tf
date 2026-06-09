variable "aws_region" {
  description = "AWS region (must match the platform)."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS SSO profile used to deploy (same as the platform)."
  type        = string
  default     = "rhoai-demo"
}

variable "owner_tag" {
  description = "Owner email tag."
  type        = string
  default     = "skumar@iisl.com"
}

variable "name_prefix" {
  description = "Prefix for all demo-owned resources. Keeps them distinct from platform (ai-demo-*)."
  type        = string
  default     = "nychhc-demo"
}

variable "ecr_repository_name" {
  description = "ECR repo for the copilot image. Demo-owned; removed on destroy."
  type        = string
  default     = "nychhc/copilot"
}

variable "ecr_image_retention_count" {
  description = "Keep this many recent tagged images."
  type        = number
  default     = 5
}

# ── IRSA (optional, OFF by default) ──────────────────────────────────────────
# The demo does NOT need IRSA: deploy.sh bootstraps a K8s Secret with Aurora
# creds from SSM, and Bedrock fallback rides Portkey's IRSA, not ours. Enable
# this only if a demo pod must call AWS (S3/SSM/Bedrock) directly.
variable "enable_irsa" {
  description = "Create a demo IRSA role for direct AWS access from the pod."
  type        = bool
  default     = false
}

variable "oidc_issuer_url" {
  description = "OCP cluster OIDC issuer URL (only needed when enable_irsa=true). deploy.sh discovers it via: oc get authentication cluster -o jsonpath='{.spec.serviceAccountIssuer}'."
  type        = string
  default     = ""
}

variable "namespace" {
  description = "Demo namespace (used for the IRSA trust subject)."
  type        = string
  default     = "nychhc-demo"
}

variable "service_account_name" {
  description = "Demo pod ServiceAccount (used for the IRSA trust subject)."
  type        = string
  default     = "nychhc-copilot-sa"
}

# Platform SSM prefix we READ (never manage). Aurora lives at /ai-demo/aurora/*.
variable "platform_ssm_prefix" {
  description = "Platform SSM prefix to grant read access to (IRSA only)."
  type        = string
  default     = "ai-demo"
}
