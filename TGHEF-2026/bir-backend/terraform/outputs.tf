# Every output maps ONE-TO-ONE to a mobile-app stack-contract key.
# scripts/emit-stack-outputs.sh turns these into bir-mobile/config/stack-outputs.json.

output "account_id" { value = local.account }
output "region" { value = var.aws_region }

output "auth_user_pool_id" { value = aws_cognito_user_pool.main.id }
output "auth_user_pool_client_id" { value = aws_cognito_user_pool_client.app.id }
output "auth_identity_pool_id" { value = aws_cognito_identity_pool.main.id }

output "api_graphql_endpoint" { value = aws_appsync_graphql_api.main.uris["GRAPHQL"] }
output "api_graphql_realtime" { value = aws_appsync_graphql_api.main.uris["REALTIME"] }

output "dynamodb_table" { value = aws_dynamodb_table.main.name }

output "storage_media_bucket" { value = aws_s3_bucket.media.bucket }
output "storage_app_dist_bucket" { value = aws_s3_bucket.app_dist.bucket }
output "storage_cdn_domain" {
  value = var.enable_cdn ? aws_cloudfront_distribution.media[0].domain_name : aws_s3_bucket.media.bucket_regional_domain_name
}
output "storage_app_dist_domain" {
  value = var.enable_cdn ? aws_cloudfront_distribution.app_dist[0].domain_name : aws_s3_bucket.app_dist.bucket_regional_domain_name
}

output "health_function_name" { value = aws_lambda_function.health.function_name }
output "payment_webhook_url" { value = aws_lambda_function_url.payment_webhook.function_url }
output "passes_issuer_kid" { value = var.issuer_kid }
output "pass_private_key_param" { value = aws_ssm_parameter.pass_private_key.name }
