variable "aws_region" {
  description = "AWS region for the backend (matches the existing demo bucket)."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS SSO profile used to deploy."
  type        = string
  default     = "rhoai-demo"
}

variable "owner_tag" {
  description = "Owner email tag."
  type        = string
  default     = "skumar@iisl.com"
}

variable "name_prefix" {
  description = "Prefix for all resources this stack owns — keeps them distinct from every other company-demos project."
  type        = string
  default     = "bir-2026"
}

variable "enable_cdn" {
  description = "Provision CloudFront in front of the S3 buckets. Adds ~15 min to deploy; set false for a fast/cheap bring-up (S3 regional domains used instead)."
  type        = bool
  default     = true
}

variable "issuer_kid" {
  description = "Pass JWT signing key id — MUST match the mobile app's passes.issuerKid."
  type        = string
  default     = "bir-2026-01"
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the Lambdas (cost control)."
  type        = number
  default     = 14
}
