# Provider + version pins (mirror the company-demos platform: tf >=1.7, aws ~>5.50).
terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.50" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

# OWNERSHIP TAGS — every resource this stack creates carries these. They make
# (a) scoped teardown, (b) cost attribution, and (c) "is this ours?" checks
# unambiguous and DISTINCT from every other company-demos project. destroy.sh
# and cost-estimate.sh both key off Project=bir-festival-2026. Defined once here
# so BOTH providers below (default + us_east_1) stay in lockstep.
locals {
  project_tags = {
    Project     = "bir-festival-2026"
    Application = "bir-backend"
    Environment = "demo"
    ManagedBy   = "terraform"
    Owner       = var.owner_tag
    CostCenter  = "IIS-BIR-2026-DEMO"
    demo        = "bir-festival-2026"
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = local.project_tags
  }
}

# CloudFront ACM certs must live in us-east-1; kept for future custom domains.
# Carries the same ownership tags so anything created here is attributable too.
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile

  default_tags {
    tags = local.project_tags
  }
}
