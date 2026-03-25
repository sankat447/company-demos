# main.tf – shared locals, SSH key generation

locals {
  prefix = var.demo_prefix
  tags   = var.common_tags
}

# ── SSH key pair for AAP EC2 ──────────────────────────────────────────────────
# Generates a fresh RSA key at deploy time; private key saved locally.
resource "tls_private_key" "aap_ssh" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "aap" {
  key_name   = "${local.prefix}-aap-key"
  public_key = tls_private_key.aap_ssh.public_key_openssh
  tags       = local.tags
}

# Save private key locally so you can SSH in to run the AAP installer
resource "local_sensitive_file" "aap_private_key" {
  content         = tls_private_key.aap_ssh.private_key_pem
  filename        = "${path.root}/aap_ec2_key.pem"
  file_permission = "0600"
}

resource "random_id" "suffix" {
  byte_length = 3
}
