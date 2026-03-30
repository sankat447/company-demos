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
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

# AWS provider – auth from deploy.sh env vars (SSO profile or static keys)
provider "aws" {
  region = var.aws_region

  # local.tags is already merged on every AWS resource, so default_tags
  # simply re-uses the same map.  Terraform deduplicates identical values.
  default_tags {
    tags = local.tags
  }
}

# Azure provider – auth from deploy.sh env vars (az login or ARM_ vars)
provider "azurerm" {
  # CSP/reseller subscriptions often lack permission to register Resource Providers.
  # Setting "none" tells Terraform to skip auto-registration and use only
  # providers that are already registered on the subscription.
  resource_provider_registrations = "none"

  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
    virtual_machine {
      delete_os_disk_on_deletion     = true
      skip_shutdown_and_force_delete = false
    }
  }
  subscription_id = var.azure_subscription_id
}

provider "random" {}
provider "tls" {}
