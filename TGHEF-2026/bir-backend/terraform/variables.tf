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

variable "paytm_env" {
  description = "Paytm gateway environment: staging (securegw-stage) or prod (securegw)."
  type        = string
  default     = "staging"
}

variable "sms_enabled" {
  description = "B6: send real OTP over SNS SMS. Off for the demo/eval stack (fixed OTP, no SMS spend / India DLT). Turn on for production."
  type        = bool
  default     = false
}
variable "demo_otp" {
  description = "Fixed OTP used when SMS is disabled or for DEMO_NUMBERS (store review + test users)."
  type        = string
  default     = "000000"
}
variable "demo_numbers" {
  description = "Phone numbers that always receive the fixed demo OTP, even when SMS is enabled (test + store review)."
  type        = list(string)
  default     = ["+911100000007"]
}

variable "bedrock_model" {
  description = "B8: Bedrock model / inference-profile id for the AI endpoints."
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}
