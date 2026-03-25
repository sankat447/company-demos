# aws_aap.tf – AAP 2.6 all-in-one on RHEL 9 (EC2 m5.xlarge)
#
# What this builds:
#   VPC → public subnet → IGW → security group (SSH + AAP UI + EDA webhook)
#   EC2 RHEL 9 instance with:
#     - 100 GB GP3 root volume
#     - userdata that stages the AAP installer and your manifest
#     - Elastic IP for stable addressing
#
# AAP installation itself runs AFTER Terraform via:
#   ssh ec2-user@<EIP> "bash /opt/aap-install/aap_install.sh"
# See aap/install/README.md for full steps.
#
# AAP 2.6 all-in-one includes:
#   - Automation Controller (job templates, workflow engine)
#   - EDA Controller (Event-Driven Ansible – Jira webhook receiver)
#   - Private Automation Hub (EE + collection registry)

# ── VPC ───────────────────────────────────────────────────────────────────────
resource "aws_vpc" "aap" {
  cidr_block           = "10.10.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = merge(local.tags, { Name = "${local.prefix}-aap-vpc" })
}

resource "aws_subnet" "aap_public" {
  vpc_id                  = aws_vpc.aap.id
  cidr_block              = "10.10.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true
  tags                    = merge(local.tags, { Name = "${local.prefix}-aap-subnet" })
}

resource "aws_internet_gateway" "aap" {
  vpc_id = aws_vpc.aap.id
  tags   = merge(local.tags, { Name = "${local.prefix}-aap-igw" })
}

resource "aws_route_table" "aap_public" {
  vpc_id = aws_vpc.aap.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.aap.id
  }
  tags = merge(local.tags, { Name = "${local.prefix}-aap-rt" })
}

resource "aws_route_table_association" "aap_public" {
  subnet_id      = aws_subnet.aap_public.id
  route_table_id = aws_route_table.aap_public.id
}

# ── Security group ────────────────────────────────────────────────────────────
resource "aws_security_group" "aap" {
  name        = "${local.prefix}-aap-sg"
  description = "AAP 2.6: SSH, Controller UI, EDA webhook"
  vpc_id      = aws_vpc.aap.id

  # SSH – operator access for installation and troubleshooting
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.operator_cidr]
  }

  # AAP Controller HTTPS UI
  ingress {
    description = "AAP Controller HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.operator_cidr]
  }

  # EDA Controller webhook receiver
  # Jira Automation POSTs here to trigger rulebooks
  ingress {
    description = "EDA webhook receiver"
    from_port   = 8443
    to_port     = 8443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]   # Must accept from Atlassian Cloud IPs (no fixed range)
  }

  # HTTP – redirect to HTTPS
  ingress {
    description = "HTTP redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.operator_cidr]
  }

  # Receptor mesh (AAP internal, needed if scaling to worker nodes later)
  ingress {
    description = "Receptor mesh"
    from_port   = 27199
    to_port     = 27199
    protocol    = "tcp"
    cidr_blocks = ["10.10.0.0/16"]
  }

  egress {
    description = "All outbound – WinRM to Azure, RHN registration, yum updates"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.prefix}-aap-sg" })
}

# ── RHEL 9 AMI (latest, Red Hat official) ────────────────────────────────────
data "aws_ami" "rhel9" {
  most_recent = true
  owners      = ["309956199498"]   # Red Hat official account

  filter {
    name   = "name"
    values = ["RHEL-9.*_HVM-*-x86_64-*-Hourly2-GP3"]
  }
  filter {
    name   = "state"
    values = ["available"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

# ── EC2 userdata – stage installer and write config files ─────────────────────
locals {
  aap_userdata = <<-USERDATA
    #!/usr/bin/env bash
    set -euo pipefail
    exec > /var/log/aap-userdata.log 2>&1

    echo "=== AAP staging: $(date) ==="

    # Required packages for AAP installer
    dnf install -y python3 python3-pip tar gzip wget unzip jq

    # Directory structure for installer artifacts
    mkdir -p /opt/aap-install
    chown ec2-user:ec2-user /opt/aap-install

    # Write AAP installer inventory template
    cat > /opt/aap-install/inventory.ini << 'INVENTORY'
    ${local.aap_inventory}
    INVENTORY

    # Write manifest placeholder (replace after Terraform with actual manifest)
    echo "${var.aap_manifest_b64}" | base64 -d > /opt/aap-install/manifest.zip 2>/dev/null || \
      echo "WARNING: aap_manifest_b64 not set – add manifest.zip to /opt/aap-install/ before running installer"

    # Copy installation script
    cat > /opt/aap-install/aap_install.sh << 'INSTALLSCRIPT'
    #!/usr/bin/env bash
    # See aap/install/README.md for full guidance
    # Run as: bash /opt/aap-install/aap_install.sh
    set -euo pipefail
    exec > /var/log/aap-install.log 2>&1

    RHN_USER="${rhn_user_placeholder}"
    RHN_PASS="${rhn_pass_placeholder}"
    AAP_VERSION="2.6"
    AAP_INSTALLER="ansible-automation-platform-setup-bundle-$${AAP_VERSION}-1-x86_64.tar.gz"

    echo "=== Step 1: Subscribe to Red Hat ==="
    subscription-manager register --username="$RHN_USER" --password="$RHN_PASS" --auto-attach
    subscription-manager repos --enable=ansible-automation-platform-2.6-for-rhel-9-x86_64-rpms

    echo "=== Step 2: Download AAP installer ==="
    cd /opt/aap-install
    if [[ ! -f "$AAP_INSTALLER" ]]; then
      echo "Downloading AAP $AAP_VERSION installer from access.redhat.com..."
      echo "Log in to https://access.redhat.com/downloads and download:"
      echo "  Ansible Automation Platform $AAP_VERSION Setup Bundle"
      echo "Upload it to /opt/aap-install/ and re-run this script."
      exit 1
    fi

    echo "=== Step 3: Extract installer ==="
    tar xzf "$AAP_INSTALLER"
    INSTALLER_DIR=$(ls -d ansible-automation-platform-setup-bundle-*/ | head -1)
    cp inventory.ini "$INSTALLER_DIR/inventory"
    cp manifest.zip "$INSTALLER_DIR/manifest.zip"

    echo "=== Step 4: Run installer ==="
    cd "$INSTALLER_DIR"
    ./setup.sh -e bundle_install=true

    echo "=== Installation complete ==="
    echo "AAP Controller: https://$(hostname -I | awk '{print $1}')"
    echo "EDA Controller: https://$(hostname -I | awk '{print $1}'):8443"
    INSTALLSCRIPT
    chmod +x /opt/aap-install/aap_install.sh
    chown ec2-user:ec2-user /opt/aap-install/aap_install.sh

    echo "=== Userdata complete. SSH in and run: bash /opt/aap-install/aap_install.sh ==="
  USERDATA

  aap_inventory = <<-INV
    [automationcontroller]
    localhost ansible_connection=local

    [automationeda]
    localhost ansible_connection=local

    [automationhub]
    localhost ansible_connection=local

    [database]
    localhost ansible_connection=local

    [all:vars]
    admin_password='${var.aap_admin_password}'

    pg_host=''
    pg_port=5432
    pg_database='awx'
    pg_username='awx'
    pg_password='${var.aap_admin_password}'

    registry_url='registry.redhat.io'
    registry_username=''
    registry_password=''

    # EDA configuration
    automationedacontroller_admin_password='${var.aap_admin_password}'
    automationedacontroller_pg_host=''
    automationedacontroller_pg_port=5432
    automationedacontroller_pg_database='eda'
    automationedacontroller_pg_username='eda'
    automationedacontroller_pg_password='${var.aap_admin_password}'

    # Hub configuration
    automationhub_admin_password='${var.aap_admin_password}'
    automationhub_pg_host=''
    automationhub_pg_port=5432
    automationhub_pg_database='automationhub'
    automationhub_pg_username='automationhub'
    automationhub_pg_password='${var.aap_admin_password}'
  INV
}

# ── EC2 instance ─────────────────────────────────────────────────────────────
resource "aws_instance" "aap" {
  ami                    = data.aws_ami.rhel9.id
  instance_type          = var.aap_instance_type
  subnet_id              = aws_subnet.aap_public.id
  vpc_security_group_ids = [aws_security_group.aap.id]
  key_name               = aws_key_pair.aap.key_name
  user_data              = local.aap_userdata

  root_block_device {
    volume_size           = var.aap_volume_size_gb
    volume_type           = "gp3"
    iops                  = 3000
    throughput            = 125
    encrypted             = true
    delete_on_termination = true
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"   # IMDSv2 enforced
  }

  tags = merge(local.tags, {
    Name = "${local.prefix}-aap-controller"
    Role = "aap-all-in-one"
    AAPVersion = "2.6"
  })

  lifecycle {
    ignore_changes = [ami]   # Don't replace on AMI updates during demo
  }
}

# ── Elastic IP – stable address for Jira webhook config ──────────────────────
resource "aws_eip" "aap" {
  instance = aws_instance.aap.id
  domain   = "vpc"
  tags     = merge(local.tags, { Name = "${local.prefix}-aap-eip" })

  depends_on = [aws_internet_gateway.aap]
}
