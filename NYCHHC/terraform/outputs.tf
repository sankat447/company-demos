output "ecr_repository_url" {
  description = "Push the copilot image here (deploy.sh uses this)."
  value       = aws_ecr_repository.copilot.repository_url
}

output "ecr_repository_name" {
  value = aws_ecr_repository.copilot.name
}

output "account_id" {
  value = local.account_id
}

output "region" {
  value = local.region
}

output "irsa_role_arn" {
  description = "IRSA role ARN (null unless enable_irsa=true)."
  value       = var.enable_irsa ? aws_iam_role.copilot[0].arn : null
}
