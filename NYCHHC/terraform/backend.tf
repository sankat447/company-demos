# =============================================================================
#  Remote state — SAME bucket/lock as the platform, but an ISOLATED key.
#  This is what makes `destroy.sh` safe: `terraform destroy` can only ever see
#  resources in THIS state file (key nychhc/), never the platform's (key demo/).
#  The state bucket + lock table are created by the platform's
#  scripts/bootstrap-state.sh — we reuse them, we do not manage them.
# =============================================================================
terraform {
  backend "s3" {
    bucket         = "ai-demo-stack-tfstate"
    key            = "nychhc/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "ai-demo-stack-tflock"
    encrypt        = true
  }
}
