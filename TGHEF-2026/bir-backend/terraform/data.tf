data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Unique, stable suffix so global names (S3) never collide with other projects
# or a prior deploy. Derived from account+region+prefix → deterministic.
resource "random_id" "suffix" {
  byte_length = 4
  keepers = {
    account = data.aws_caller_identity.current.account_id
    region  = var.aws_region
    prefix  = var.name_prefix
  }
}

locals {
  account = data.aws_caller_identity.current.account_id
  suffix  = random_id.suffix.hex
  name    = var.name_prefix
}
