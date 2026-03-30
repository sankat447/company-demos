# aws_aap.tf – Single node AAP 2.6 Containerized, fully automated via userdata

resource "aws_vpc" "aap" {
  cidr_block           = "10.10.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "${local.prefix}-aap-vpc" }
}

resource "aws_subnet" "aap_public" {
  vpc_id                  = aws_vpc.aap.id
  cidr_block              = "10.10.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.prefix}-aap-subnet" }
}

resource "aws_internet_gateway" "aap" {
  vpc_id = aws_vpc.aap.id
  tags   = { Name = "${local.prefix}-aap-igw" }
}

resource "aws_route_table" "aap_public" {
  vpc_id = aws_vpc.aap.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.aap.id
  }
  tags = { Name = "${local.prefix}-aap-rt" }
}

resource "aws_route_table_association" "aap_public" {
  subnet_id      = aws_subnet.aap_public.id
  route_table_id = aws_route_table.aap_public.id
}

resource "aws_security_group" "aap" {
  name        = "${local.prefix}-aap-sg"
  description = "AAP 2.6 Containerized: SSH, UI, EDA webhook"
  vpc_id      = aws_vpc.aap.id

  ingress {
    description = "SSH from operator"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.operator_cidr]
  }

  ingress {
    description = "AAP Gateway HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.operator_cidr]
  }

  ingress {
    description = "HTTP redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.operator_cidr]
  }

  ingress {
    description = "EDA webhook from Jira"
    from_port   = 8443
    to_port     = 8443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Jira EDA webhook rewrite"
    from_port   = 9443
    to_port     = 9443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.prefix}-aap-sg" }
}

data "aws_ami" "rhel9" {
  most_recent = true
  owners      = ["309956199498"]
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

locals {
  aap_userdata = <<-USERDATA
    #!/usr/bin/env bash
    set -euo pipefail
    exec > /var/log/aap-install.log 2>&1
    echo "=== AAP Containerized Install Start: $(date) ==="

    # ── 1. System prep ──────────────────────────────────────────────────────
    dnf install -y podman ansible-core wget tar gzip python3 python3-pip
    systemctl enable --now podman

    # ── 2. Download containerized bundle from Red Hat ───────────────────────
    # Get access token using offline token
    OFFLINE_TOKEN="${var.rhn_offline_token}"
    ACCESS_TOKEN=$(curl -s -X POST \
      https://sso.redhat.com/auth/realms/redhat-external/protocol/openid-connect/token \
      -d grant_type=refresh_token \
      -d client_id=cloud-services \
      -d refresh_token="$OFFLINE_TOKEN" | python3 -c \
      "import sys,json; print(json.load(sys.stdin)['access_token'])")

    mkdir -p /opt/aap-install
    cd /opt/aap-install

    curl -Lo aap-containerized.tar.gz \
      --progress-bar \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      "https://api.access.redhat.com/management/v1/images/cset/rhel---9/ansible-automation-platform-containerized-setup-bundle-2.6-5-x86_64.tar.gz" || {
        echo "API download failed - bundle must be uploaded manually"
        echo "Run: scp -i aap_ec2_key.pem ansible-automation-platform-containerized-setup-bundle-2.6-5-x86_64.tar.gz ec2-user@$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):/opt/aap-install/"
        exit 0
      }

    # ── 3. Extract ──────────────────────────────────────────────────────────
    tar xzf aap-containerized.tar.gz
    INSTALLER_DIR=$(ls -d ansible-automation-platform-containerized-setup-bundle-*/ | head -1)
    cd "$INSTALLER_DIR"

    # ── 4. Write inventory ──────────────────────────────────────────────────
    MYIP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)
    PUBIP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)

    cat > inventory << EOF
    [automationgateway]
    $MYIP ansible_connection=local

    [automationcontroller]
    $MYIP ansible_connection=local

    [automationeda]
    $MYIP ansible_connection=local

    [automationhub]
    $MYIP ansible_connection=local

    [database]
    $MYIP ansible_connection=local

    [all:vars]
    ansible_user=root

    # Passwords
    gateway_admin_password='${var.aap_admin_password}'
    gateway_pg_password='${var.aap_admin_password}'
    controller_admin_password='${var.aap_admin_password}'
    controller_pg_password='${var.aap_admin_password}'
    hub_admin_password='${var.aap_admin_password}'
    hub_pg_password='${var.aap_admin_password}'
    eda_admin_password='${var.aap_admin_password}'
    eda_pg_password='${var.aap_admin_password}'

    # Registry
    registry_username='${var.rhn_username}'
    registry_password='${var.rhn_password}'

    # External hostname (used for SSL cert)
    gateway_main_url=https://aap.iisdemolab.click
    EOF

    # ── 5. Run installer ────────────────────────────────────────────────────
    echo "=== Running AAP containerized installer: $(date) ==="
    ansible-playbook -i inventory ansible.containerized_installer.install \
      2>&1 | tee /var/log/aap-containerized-install.log

    echo "=== AAP Install Complete: $(date) ==="
    echo "AAP URL: https://$PUBIP"
    echo "AAP URL: https://aap.iisdemolab.click"
  USERDATA
}

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
    http_tokens   = "required"
  }

  tags = {
    Name       = "${local.prefix}-aap-controller"
    Role       = "aap-containerized"
    AAPVersion = "2.6"
  }

  lifecycle { ignore_changes = [ami] }
}

resource "aws_eip" "aap" {
  instance   = aws_instance.aap.id
  domain     = "vpc"
  tags       = { Name = "${local.prefix}-aap-eip" }
  depends_on = [aws_internet_gateway.aap]
}