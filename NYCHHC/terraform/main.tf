# =============================================================================
#  Demo-owned AWS resources. EVERYTHING here is created by deploy.sh and removed
#  by destroy.sh via this isolated state. Nothing here mutates platform infra.
# =============================================================================

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
}

# ── ECR repository for the copilot image ─────────────────────────────────────
# The one AWS-owned resource the demo needs. force_delete=true so `terraform
# destroy` removes it even with images present (clean, scoped teardown).
resource "aws_ecr_repository" "copilot" {
  name                 = var.ecr_repository_name
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = var.ecr_repository_name }
}

resource "aws_ecr_lifecycle_policy" "copilot" {
  repository = aws_ecr_repository.copilot.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last ${var.ecr_image_retention_count} tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "0", "1", "latest"]
          countType     = "imageCountMoreThan"
          countNumber   = var.ecr_image_retention_count
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
    ]
  })
}

# ── Optional IRSA role (enable_irsa=false by default) ────────────────────────
# Only created if a demo pod must call AWS directly. Trust federates the EXISTING
# cluster OIDC provider, scoped to this demo's namespace + ServiceAccount.
resource "aws_iam_role" "copilot" {
  count = var.enable_irsa ? 1 : 0
  name  = "${var.name_prefix}-irsa"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.ocp[0].arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${replace(var.oidc_issuer_url, "https://", "")}:sub" = "system:serviceaccount:${var.namespace}:${var.service_account_name}"
          "${replace(var.oidc_issuer_url, "https://", "")}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })

  tags = { Name = "${var.name_prefix}-irsa" }
}

resource "aws_iam_role_policy" "copilot_ssm_read" {
  count = var.enable_irsa ? 1 : 0
  name  = "${var.name_prefix}-ssm-read"
  role  = aws_iam_role.copilot[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
      # Read platform Aurora params + our own /nychhc/* — never write.
      Resource = [
        "arn:aws:ssm:${local.region}:${local.account_id}:parameter/${var.platform_ssm_prefix}/aurora/*",
        "arn:aws:ssm:${local.region}:${local.account_id}:parameter/nychhc/*",
      ]
    }]
  })
}
