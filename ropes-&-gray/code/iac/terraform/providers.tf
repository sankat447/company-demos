terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
  # Auth resolved from environment:
  #   AWS_PROFILE + SSO  (recommended, set by deploy.sh)
  #   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (static keys)
}

provider "azurerm" {
  features {}
  # Auth resolved from environment:
  #   az login session  (ARM_SUBSCRIPTION_ID set by deploy.sh)
  #   ARM_* env vars for service principal
}

provider "random" {}
