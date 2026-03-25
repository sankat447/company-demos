# aws.tf  –  AWS demo infrastructure: VPC + Windows Server 2019 VM
# All resources guarded by count = var.enable_aws ? 1 : 0

# ── Networking ─────────────────────────────────────────────────────────────────
resource "aws_vpc" "demo" {
  count      = var.enable_aws ? 1 : 0
  cidr_block = "10.10.0.0/16"
  tags       = merge(local.common_tags, { Name = "${local.prefix}-vpc" })
}

resource "aws_subnet" "demo" {
  count                   = var.enable_aws ? 1 : 0
  vpc_id                  = aws_vpc.demo[0].id
  cidr_block              = "10.10.1.0/24"
  map_public_ip_on_launch = true
  tags                    = merge(local.common_tags, { Name = "${local.prefix}-subnet" })
}

resource "aws_internet_gateway" "demo" {
  count  = var.enable_aws ? 1 : 0
  vpc_id = aws_vpc.demo[0].id
  tags   = merge(local.common_tags, { Name = "${local.prefix}-igw" })
}

resource "aws_route_table" "demo" {
  count  = var.enable_aws ? 1 : 0
  vpc_id = aws_vpc.demo[0].id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.demo[0].id
  }
  tags = merge(local.common_tags, { Name = "${local.prefix}-rt" })
}

resource "aws_route_table_association" "demo" {
  count          = var.enable_aws ? 1 : 0
  subnet_id      = aws_subnet.demo[0].id
  route_table_id = aws_route_table.demo[0].id
}

# ── Security group: RDP (3389) + WinRM-HTTPS (5986) ──────────────────────────
resource "aws_security_group" "demo" {
  count       = var.enable_aws ? 1 : 0
  name        = "${local.prefix}-sg"
  description = "Demo: RDP + WinRM access from operator IP"
  vpc_id      = aws_vpc.demo[0].id

  ingress {
    description = "RDP"
    from_port   = 3389
    to_port     = 3389
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr]
  }

  ingress {
    description = "WinRM HTTPS (Ansible)"
    from_port   = 5986
    to_port     = 5986
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.prefix}-sg" })
}

# ── Key pair (generated locally; store private key securely) ──────────────────
resource "aws_key_pair" "demo" {
  count      = var.enable_aws ? 1 : 0
  key_name   = "${local.prefix}-key-${random_id.suffix.hex}"
  public_key = file("~/.ssh/id_rsa.pub")   # Ensure this exists before running

  tags = local.common_tags
}

# ── AMI: Windows Server 2019 (latest, Amazon-owned) ──────────────────────────
data "aws_ami" "windows_2019" {
  count       = var.enable_aws ? 1 : 0
  most_recent = true
  owners      = ["801119661308"]  # Amazon Windows AMIs

  filter {
    name   = "name"
    values = ["Windows_Server-2019-English-Full-Base-*"]
  }
  filter {
    name   = "state"
    values = ["available"]
  }
}

# ── WinRM bootstrap user data ─────────────────────────────────────────────────
# Configures WinRM over HTTPS so Ansible can connect immediately after boot.
locals {
  winrm_userdata = <<-USERDATA
    <powershell>
    # Enable WinRM HTTPS
    winrm quickconfig -q
    winrm set winrm/config/winrs '@{MaxMemoryPerShellMB="1024"}'
    winrm set winrm/config '@{MaxTimeoutms="1800000"}'
    winrm set winrm/config/service '@{AllowUnencrypted="false"}'
    winrm set winrm/config/service/auth '@{Basic="true"}'

    # Create self-signed cert and HTTPS listener
    $cert = New-SelfSignedCertificate -DnsName $env:COMPUTERNAME -CertStoreLocation Cert:\LocalMachine\My
    $thumbprint = $cert.Thumbprint
    New-Item -Path WSMan:\LocalHost\Listener -Transport HTTPS -Address * -CertificateThumbPrint $thumbprint -Force

    # Open WinRM port in Windows Firewall
    netsh advfirewall firewall add rule name="WinRM HTTPS" dir=in localport=5986 protocol=TCP action=allow

    # Set local admin password
    $password = ConvertTo-SecureString "${var.windows_admin_password}" -AsPlainText -Force
    Set-LocalUser -Name "${var.windows_admin_username}" -Password $password

    # Restart WinRM
    Restart-Service winrm
    </powershell>
  USERDATA
}

# ── EC2 Windows Instance ──────────────────────────────────────────────────────
resource "aws_instance" "demo_windows" {
  count                  = var.enable_aws ? 1 : 0
  ami                    = data.aws_ami.windows_2019[0].id
  instance_type          = "t3.medium"    # t3.micro is too small for Windows patching
  subnet_id              = aws_subnet.demo[0].id
  vpc_security_group_ids = [aws_security_group.demo[0].id]
  key_name               = aws_key_pair.demo[0].key_name
  user_data              = local.winrm_userdata

  root_block_device {
    volume_size = 50
    volume_type = "gp3"
    encrypted   = true
  }

  tags = merge(local.common_tags, {
    Name    = "${local.prefix}-win-aws"
    OS      = "Windows Server 2019"
    AnsibleGroup = "windows_aws"
  })

  # Allow userdata to finish before Terraform proceeds
  depends_on = [aws_internet_gateway.demo]
}
