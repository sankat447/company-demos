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

variable "anthropic_model" {
  description = "B8: Anthropic model id the AI endpoints call (Anthropic Messages API)."
  type        = string
  default     = "claude-haiku-4-5-20251001"
}

variable "ai_rate_limit_per_min" {
  description = "B8: max AI requests per user per minute (per-user cost/abuse guard on the /ai/* Lambda). Raise it to scale up for a busier festival; 0 disables the limit. See docs/AI_ENDPOINTS.md."
  type        = number
  default     = 15
}

variable "ai_kb_top_k" {
  description = "RAG: how many top-matching knowledge-base chunks the assistant retrieves per question. Raise it for a larger rules corpus. See docs/AI_ENDPOINTS.md."
  type        = number
  default     = 6
}

variable "fcm_sender_id" {
  description = "Firebase Cloud Messaging sender id for Android push. Owner-provided secret; REPLACE until a real Firebase project is wired to the Pinpoint GCM channel."
  type        = string
  default     = "REPLACE"
}
