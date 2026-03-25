# main.tf  –  top-level locals and shared resources

locals {
  prefix = var.demo_name_prefix
  common_tags = {
    Project     = "hybrid-patch-demo"
    Environment = "demo"
    ManagedBy   = "terraform"
  }
}

# Random suffix to avoid name collisions on re-deploy
resource "random_id" "suffix" {
  byte_length = 4
}
