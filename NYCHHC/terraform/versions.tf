# Provider + version pins — mirror the platform (terraform >=1.7, aws ~>5.50).
terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  # Ownership tags — every demo-owned resource carries these so teardown and
  # cost attribution are unambiguous and distinct from the platform (Project=ai).
  default_tags {
    tags = {
      Project     = "nychhc"
      Environment = "demo"
      ManagedBy   = "terraform"
      Owner       = var.owner_tag
      CostCenter  = "IIS-NYCHHC-DEMO"
      demo        = "nychhc"
    }
  }
}
