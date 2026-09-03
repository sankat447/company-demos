# =============================================================================
#  Bir Festival 2026 backend — all AWS objects. Every resource inherits the
#  ownership tags from the provider default_tags block (versions.tf), so the
#  whole stack is attributable to Project=bir-festival-2026 and nothing else.
# =============================================================================

# ---------- Identity: Cognito ----------
resource "aws_cognito_user_pool" "main" {
  name                = "${local.name}-users"
  username_attributes = ["phone_number"]
  # No auto_verified_attributes: verification is done by the custom-auth OTP
  # Lambda (create/verify challenge), NOT Cognito's built-in SMS. Setting
  # auto-verify on phone_number would force an SMS/SNS caller config we don't use.

  schema {
    name                = "phone_number"
    attribute_data_type = "String"
    required            = true
    mutable             = false
  }

  # Custom-auth OTP flow — the Lambda triggers below implement it.
  lambda_config {
    define_auth_challenge          = aws_lambda_function.custom_auth.arn
    create_auth_challenge          = aws_lambda_function.custom_auth.arn
    verify_auth_challenge_response = aws_lambda_function.custom_auth.arn
  }
}

resource "aws_cognito_user_pool_client" "app" {
  name            = "${local.name}-app"
  user_pool_id    = aws_cognito_user_pool.main.id
  generate_secret = false
  # Modern flow names only — mixing the legacy CUSTOM_AUTH_FLOW_ONLY with ALLOW_*
  # is rejected. ALLOW_CUSTOM_AUTH is the OTP path; refresh for token renewal.
  explicit_auth_flows           = ["ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
}

# The role groups the app gates on (ARCHITECTURE §4; CO-003/CO-004).
resource "aws_cognito_user_group" "roles" {
  for_each     = toset(["visitor", "partner", "volunteer", "organiser-lite", "admin-hospitality", "safety-officer"])
  name         = each.key
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Bir 2026 role: ${each.key}"
}

resource "aws_cognito_identity_pool" "main" {
  identity_pool_name               = "${local.name}_identity"
  allow_unauthenticated_identities = false

  cognito_identity_providers {
    client_id     = aws_cognito_user_pool_client.app.id
    provider_name = aws_cognito_user_pool.main.endpoint
  }
}

resource "aws_lambda_permission" "cognito_invoke" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.custom_auth.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

# ---------- Data: DynamoDB single-table (system of record) ----------
resource "aws_dynamodb_table" "main" {
  name         = "${local.name}-table"
  billing_mode = "PAY_PER_REQUEST" # festival-week spike; ~$0 idle
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  point_in_time_recovery { enabled = true }
}

# ---------- Storage: S3 (media + app-dist) ----------
resource "aws_s3_bucket" "media" {
  bucket = "${local.name}-media-${local.suffix}"
}
resource "aws_s3_bucket" "app_dist" {
  bucket = "${local.name}-appdist-${local.suffix}"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}
resource "aws_s3_bucket_public_access_block" "app_dist" {
  bucket                  = aws_s3_bucket.app_dist.id
  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

# Public read of the JWKS (offline verification) + published media/APK.
data "aws_iam_policy_document" "media_public" {
  statement {
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/.well-known/*", "${aws_s3_bucket.media.arn}/config/*", "${aws_s3_bucket.media.arn}/public/*"]
  }
}
resource "aws_s3_bucket_policy" "media" {
  bucket     = aws_s3_bucket.media.id
  policy     = data.aws_iam_policy_document.media_public.json
  depends_on = [aws_s3_bucket_public_access_block.media]
}

# ---------- Lambdas ----------
data "archive_file" "custom_auth" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/custom-auth"
  output_path = "${path.module}/.build/custom-auth.zip"
}
data "archive_file" "pass_signer" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/pass-signer"
  output_path = "${path.module}/.build/pass-signer.zip"
}
data "archive_file" "payment_webhook" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/payment-webhook"
  output_path = "${path.module}/.build/payment-webhook.zip"
}
data "archive_file" "health" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/health"
  output_path = "${path.module}/.build/health.zip"
}

resource "aws_iam_role" "lambda" {
  name = "${local.name}-lambda-role"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${local.name}-lambda-policy"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:*:*:*" },
      { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:BatchWriteItem"], Resource = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"] },
      { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = aws_ssm_parameter.pass_private_key.arn },
      { Effect = "Allow", Action = ["sns:Publish"], Resource = "*" }
    ]
  })
}

resource "aws_lambda_function" "custom_auth" {
  function_name    = "${local.name}-custom-auth"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.custom_auth.output_path
  source_code_hash = data.archive_file.custom_auth.output_base64sha256
  timeout          = 10
  environment { variables = { OTP_TTL_SECONDS = "300" } }
}

resource "aws_lambda_function" "pass_signer" {
  function_name    = "${local.name}-pass-signer"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.pass_signer.output_path
  source_code_hash = data.archive_file.pass_signer.output_base64sha256
  timeout          = 10
  environment { variables = { ISSUER_KID = var.issuer_kid, PRIVATE_KEY_PARAM = "/${local.name}/passes/private-key", TABLE = aws_dynamodb_table.main.name } }
}

resource "aws_lambda_function" "payment_webhook" {
  function_name    = "${local.name}-payment-webhook"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.payment_webhook.output_path
  source_code_hash = data.archive_file.payment_webhook.output_base64sha256
  timeout          = 10
  environment { variables = { TABLE = aws_dynamodb_table.main.name } }
}

resource "aws_lambda_function" "health" {
  function_name    = "${local.name}-health"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.health.output_path
  source_code_hash = data.archive_file.health.output_base64sha256
  timeout          = 5
}

# Payment webhook needs a public URL for Razorpay to POST to.
resource "aws_lambda_function_url" "payment_webhook" {
  function_name      = aws_lambda_function.payment_webhook.function_name
  authorization_type = "NONE"
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = toset(["custom-auth", "pass-signer", "payment-webhook", "health"])
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

# ---------- API: AppSync GraphQL ----------
resource "aws_appsync_graphql_api" "main" {
  name                = "${local.name}-api"
  authentication_type = "AMAZON_COGNITO_USER_POOLS"
  schema              = file("${path.module}/schema.graphql")

  user_pool_config {
    user_pool_id   = aws_cognito_user_pool.main.id
    aws_region     = var.aws_region
    default_action = "ALLOW"
  }

  additional_authentication_provider {
    authentication_type = "AWS_IAM"
  }
}

# DynamoDB data source (non-privileged reads/writes) + a health resolver so the
# API is verifiable the moment it deploys.
resource "aws_iam_role" "appsync_ddb" {
  name = "${local.name}-appsync-ddb"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "appsync.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy" "appsync_ddb" {
  name = "${local.name}-appsync-ddb"
  role = aws_iam_role.appsync_ddb.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"], Resource = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"] }]
  })
}
resource "aws_appsync_datasource" "ddb" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "TableDs"
  type             = "AMAZON_DYNAMODB"
  service_role_arn = aws_iam_role.appsync_ddb.arn
  dynamodb_config { table_name = aws_dynamodb_table.main.name }
}
# ---------- Resolvers ----------
# B1 (Highlights writes): createRegistration / cancelRegistration → DynamoDB.
# VTL unit resolvers on the DDB datasource; the app's idempotencyKey is the REG
# sort key so drains/replays reconcile. Privileged domains (lodging/ops) will
# use Lambda data sources that re-check the Cognito group — TODO in B2/B10.
resource "aws_appsync_resolver" "create_registration" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "createRegistration"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/create-registration.req.vtl")
  response_template = file("${path.module}/resolvers/create-registration.res.vtl")
}

resource "aws_appsync_resolver" "cancel_registration" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "cancelRegistration"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/cancel-registration.req.vtl")
  response_template = file("${path.module}/resolvers/cancel-registration.res.vtl")
}

# B2a (Lodging read): lodgingPool — admin-hospitality-guarded VTL query. The
# request template re-checks the Cognito group (IAM callers trusted).
resource "aws_appsync_resolver" "lodging_pool" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "lodgingPool"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/lodging-pool.req.vtl")
  response_template = file("${path.module}/resolvers/lodging-pool.res.vtl")
}

# ---------- SSM: ops params + pass signing key placeholder ----------
resource "aws_ssm_parameter" "fly_status_topic" {
  name  = "/${local.name}/ops/flyStatusTopic"
  type  = "String"
  value = "REPLACE_WITH_SNS_TOPIC_ARN"
}

# The ES256 private key. Provisioned as a placeholder SecureString; deploy.sh
# generates a real P-256 key, publishes the JWKS, and overwrites this value.
resource "aws_ssm_parameter" "pass_private_key" {
  name  = "/${local.name}/passes/private-key"
  type  = "SecureString"
  value = "PLACEHOLDER_ROTATE_ON_DEPLOY"
  lifecycle { ignore_changes = [value] } # deploy.sh owns the real value
}
