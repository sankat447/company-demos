# aws_aap.tf – AAP 2.6 two-node: Controller + EDA on separate RHEL9 EC2s

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

resource "aws_security_group" "aap" {
  name        = "${local.prefix}-aap-sg"
  description = "AAP 2.6: SSH, Controller UI, EDA webhook, internal cluster"
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
    description = "Internal cluster traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.10.0.0/16"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.prefix}-aap-sg" })
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
  base_userdata = <<-USERDATA
    #!/usr/bin/env bash
    set -euo pipefail
    exec > /var/log/aap-userdata.log 2>&1
    echo "=== AAP node staging: $(date) ==="
    dnf install -y python3 python3-pip tar gzip wget unzip jq
    mkdir -p /opt/aap-install
    chown ec2-user:ec2-user /opt/aap-install
    echo "=== Staging complete ==="
  USERDATA
}

# Node 1 – Controller + Gateway + Database (m5.xlarge)
resource "aws_instance" "aap" {
  ami                    = data.aws_ami.rhel9.id
  instance_type          = var.aap_instance_type
  subnet_id              = aws_subnet.aap_public.id
  vpc_security_group_ids = [aws_security_group.aap.id]
  key_name               = aws_key_pair.aap.key_name
  user_data              = local.base_userdata

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

  tags = merge(local.tags, {
    Name       = "${local.prefix}-aap-controller"
    Role       = "aap-controller-gateway-db"
    AAPVersion = "2.6"
  })

  lifecycle { ignore_changes = [ami] }
}

# Node 2 – EDA Controller (t3.large)
resource "aws_instance" "aap_eda" {
  ami                    = data.aws_ami.rhel9.id
  instance_type          = "t3.large"
  subnet_id              = aws_subnet.aap_public.id
  vpc_security_group_ids = [aws_security_group.aap.id]
  key_name               = aws_key_pair.aap.key_name
  user_data              = local.base_userdata

  root_block_device {
    volume_size           = 60
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  tags = merge(local.tags, {
    Name       = "${local.prefix}-aap-eda"
    Role       = "aap-eda-controller"
    AAPVersion = "2.6"
  })

  lifecycle { ignore_changes = [ami] }
}

resource "aws_eip" "aap" {
  instance   = aws_instance.aap.id
  domain     = "vpc"
  tags       = merge(local.tags, { Name = "${local.prefix}-aap-eip" })
  depends_on = [aws_internet_gateway.aap]
}

resource "aws_eip" "aap_eda" {
  instance   = aws_instance.aap_eda.id
  domain     = "vpc"
  tags       = merge(local.tags, { Name = "${local.prefix}-aap-eda-eip" })
  depends_on = [aws_internet_gateway.aap]
}