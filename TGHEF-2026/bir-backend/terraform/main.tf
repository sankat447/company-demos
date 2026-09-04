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

  # Self-expiring rows (AI rate-limit counters, and any future ephemeral rows
  # that set a `ttl` epoch-seconds attribute). Rows without `ttl` are unaffected.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

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
data "archive_file" "commit_allocation" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/commit-allocation"
  output_path = "${path.module}/.build/commit-allocation.zip"
}
data "archive_file" "lodging_occupancy" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/lodging-occupancy"
  output_path = "${path.module}/.build/lodging-occupancy.zip"
}
data "archive_file" "issue_badge" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/issue-badge"
  output_path = "${path.module}/.build/issue-badge.zip"
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
      # pass-signer key + Paytm merchant credentials (B5) live under /${local.name}/
      { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = "arn:aws:ssm:*:*:parameter/${local.name}/*" },
      # B5: the payment webhook mints passes (invoke pass-signer) and fans out via
      # the server-only confirmOrder mutation (AppSync IAM).
      { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = "arn:aws:lambda:*:*:function:${local.name}-pass-signer" },
      { Effect = "Allow", Action = ["appsync:GraphQL"], Resource = "${aws_appsync_graphql_api.main.arn}/*" },
      # B8: AI endpoints read the Anthropic API key from SSM (SecureString);
      # ssm:GetParameter above already covers /${local.name}/*. No Bedrock IAM —
      # the AI Lambda calls the Anthropic API directly over HTTPS.
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
  environment {
    variables = {
      OTP_TTL_SECONDS = "300"
      # B6: real OTP over SNS SMS. Off on the demo stack (fixed DEMO_OTP, no SMS
      # spend / India DLT). Flip SMS_ENABLED=true for production. DEMO_NUMBERS
      # always get the fixed code (store review + test users) even when SMS is on.
      SMS_ENABLED  = var.sms_enabled ? "true" : "false"
      DEMO_OTP     = var.demo_otp
      DEMO_NUMBERS = join(",", var.demo_numbers)
    }
  }
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
  timeout          = 15
  environment {
    variables = {
      TABLE            = aws_dynamodb_table.main.name
      PAYTM_MID_PARAM  = aws_ssm_parameter.paytm_mid.name
      PAYTM_KEY_PARAM  = aws_ssm_parameter.paytm_key.name
      PAYTM_ENV        = var.paytm_env
      APPSYNC_ENDPOINT = aws_appsync_graphql_api.main.uris["GRAPHQL"]
      PASS_SIGNER_FN   = aws_lambda_function.pass_signer.function_name
      APP_RETURN_URL   = "bir://pay/return"
    }
  }
}

# B5: createOrder — prices server-side + calls Paytm Initiate Transaction.
data "archive_file" "create_order" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/create-order"
  output_path = "${path.module}/.build/create-order.zip"
}
resource "aws_lambda_function" "create_order" {
  function_name    = "${local.name}-create-order"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.create_order.output_path
  source_code_hash = data.archive_file.create_order.output_base64sha256
  timeout          = 15
  environment {
    variables = {
      TABLE           = aws_dynamodb_table.main.name
      PAYTM_MID_PARAM = aws_ssm_parameter.paytm_mid.name
      PAYTM_KEY_PARAM = aws_ssm_parameter.paytm_key.name
      PAYTM_ENV       = var.paytm_env
      CALLBACK_URL    = "${aws_apigatewayv2_stage.pay.invoke_url}/pay/webhook"
    }
  }
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

# B2b: privileged commitAllocation resolver — re-checks the group, re-validates
# §3 against source-of-truth rooms/pool, persists + audits. Reuses the lambda
# role (DynamoDB Query/PutItem already granted).
resource "aws_lambda_function" "commit_allocation" {
  function_name    = "${local.name}-commit-allocation"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.commit_allocation.output_path
  source_code_hash = data.archive_file.commit_allocation.output_base64sha256
  timeout          = 15
  environment { variables = { TABLE = aws_dynamodb_table.main.name } }
}

resource "aws_lambda_function" "lodging_occupancy" {
  function_name    = "${local.name}-lodging-occupancy"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.lodging_occupancy.output_path
  source_code_hash = data.archive_file.lodging_occupancy.output_base64sha256
  timeout          = 15
  environment { variables = { TABLE = aws_dynamodb_table.main.name } }
}

resource "aws_lambda_function" "issue_badge" {
  function_name    = "${local.name}-issue-badge"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.issue_badge.output_path
  source_code_hash = data.archive_file.issue_badge.output_base64sha256
  timeout          = 10
  environment { variables = { TABLE = aws_dynamodb_table.main.name, ISSUER_KID = var.issuer_kid, PRIVATE_KEY_PARAM = "/${local.name}/passes/private-key" } }
}

# Payment webhook needs a public URL for Razorpay to POST to.
resource "aws_lambda_function_url" "payment_webhook" {
  function_name      = aws_lambda_function.payment_webhook.function_name
  authorization_type = "NONE"
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = toset(["custom-auth", "pass-signer", "payment-webhook", "health", "commit-allocation", "lodging-occupancy", "issue-badge", "register-device", "ai", "set-fly-status"])
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

# B2b: AppSync → Lambda data source for the privileged commitAllocation.
resource "aws_iam_role" "appsync_lambda" {
  name = "${local.name}-appsync-lambda"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "appsync.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy" "appsync_lambda" {
  name = "${local.name}-appsync-lambda"
  role = aws_iam_role.appsync_lambda.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = [aws_lambda_function.commit_allocation.arn, aws_lambda_function.lodging_occupancy.arn, aws_lambda_function.issue_badge.arn, aws_lambda_function.register_device.arn, aws_lambda_function.set_fly_status.arn] }]
  })
}
resource "aws_appsync_datasource" "commit_lambda" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "CommitAllocationLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn
  lambda_config { function_arn = aws_lambda_function.commit_allocation.arn }
}
resource "aws_appsync_resolver" "commit_allocation" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "commitAllocation"
  data_source       = aws_appsync_datasource.commit_lambda.name
  request_template  = file("${path.module}/resolvers/commit-allocation.req.vtl")
  response_template = file("${path.module}/resolvers/commit-allocation.res.vtl")
}

# B2c: room inventory read + CRUD (VTL on DDB, admin-hospitality guarded).
resource "aws_appsync_resolver" "lodging_rooms" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "lodgingRooms"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/lodging-rooms.req.vtl")
  response_template = file("${path.module}/resolvers/lodging-rooms.res.vtl")
}
resource "aws_appsync_resolver" "save_room" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "saveRoom"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/save-room.req.vtl")
  response_template = file("${path.module}/resolvers/save-room.res.vtl")
}
resource "aws_appsync_resolver" "retire_room" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "retireRoom"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/retire-room.req.vtl")
  response_template = file("${path.module}/resolvers/retire-room.res.vtl")
}

# B3: Volunteer domain (CO-004) — all VTL-direct on the table. Roster is a
# member-facing GetItem keyed by the caller's own sub; attendance + incidents
# are idempotent PutItems (the app's outbox key is the sort key).
resource "aws_appsync_resolver" "volunteer_roster" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "volunteerRoster"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/volunteer-roster.req.vtl")
  response_template = file("${path.module}/resolvers/volunteer-roster.res.vtl")
}
resource "aws_appsync_resolver" "record_attendance" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "recordAttendance"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/record-attendance.req.vtl")
  response_template = file("${path.module}/resolvers/record-attendance.res.vtl")
}
resource "aws_appsync_resolver" "report_incident" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "reportIncident"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/report-incident.req.vtl")
  response_template = file("${path.module}/resolvers/report-incident.res.vtl")
}

# B4: Partner consoles (CO-004) — VTL-direct GetItems keyed by the caller's own
# sub, partner-group guarded. analytics / allocations are stored as native lists
# and coerced to the AWSJSON scalar on output (the client parses them).
resource "aws_appsync_resolver" "stall_console" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "stallConsole"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/stall-console.req.vtl")
  response_template = file("${path.module}/resolvers/stall-console.res.vtl")
}
resource "aws_appsync_resolver" "hospitality_console" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "hospitalityConsole"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/hospitality-console.req.vtl")
  response_template = file("${path.module}/resolvers/hospitality-console.res.vtl")
}

# B4 GUI: hospitality guest check-in persistence — write (idempotent PutItem to
# CHKIN#<sub>) + read-back (Query the partition), so the board survives reload
# and other devices. Partner-group guarded.
resource "aws_appsync_resolver" "partner_checkin" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "partnerCheckIn"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/partner-checkin.req.vtl")
  response_template = file("${path.module}/resolvers/partner-checkin.res.vtl")
}
resource "aws_appsync_resolver" "partner_checkins" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "partnerCheckIns"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/partner-checkins.req.vtl")
  response_template = file("${path.module}/resolvers/partner-checkins.res.vtl")
}

# B2c: occupancy board + participant badge — Lambda-backed (compute / ES256 sign).
resource "aws_appsync_datasource" "occupancy_lambda" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "LodgingOccupancyLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn
  lambda_config { function_arn = aws_lambda_function.lodging_occupancy.arn }
}
resource "aws_appsync_resolver" "lodging_occupancy" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "lodgingOccupancy"
  data_source       = aws_appsync_datasource.occupancy_lambda.name
  request_template  = file("${path.module}/resolvers/lambda-invoke.req.vtl")
  response_template = file("${path.module}/resolvers/lambda-invoke.res.vtl")
}
resource "aws_appsync_datasource" "badge_lambda" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "IssueBadgeLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn
  lambda_config { function_arn = aws_lambda_function.issue_badge.arn }
}
resource "aws_appsync_resolver" "issue_badge" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "issueBadge"
  data_source       = aws_appsync_datasource.badge_lambda.name
  request_template  = file("${path.module}/resolvers/lambda-invoke.req.vtl")
  response_template = file("${path.module}/resolvers/lambda-invoke.res.vtl")
}

# ---------- SSM: ops params + pass signing key placeholder ----------
resource "aws_ssm_parameter" "fly_status_topic" {
  name  = "/${local.name}/ops/flyStatusTopic"
  type  = "String"
  value = aws_sns_topic.fly_status.arn # B10: real fly-status fan-out topic
}

# The ES256 private key. Provisioned as a placeholder SecureString; deploy.sh
# generates a real P-256 key, publishes the JWKS, and overwrites this value.
resource "aws_ssm_parameter" "pass_private_key" {
  name  = "/${local.name}/passes/private-key"
  type  = "SecureString"
  value = "PLACEHOLDER_ROTATE_ON_DEPLOY"
  lifecycle { ignore_changes = [value] } # deploy.sh owns the real value
}

# B8: the Anthropic API key the AI Lambda uses. Placeholder SecureString — the
# operator sets the real value out-of-band (never in the repo or client):
#   aws ssm put-parameter --name /${local.name}/ai/anthropic-key \
#     --type SecureString --overwrite --value <ANTHROPIC_API_KEY>
resource "aws_ssm_parameter" "anthropic_key" {
  name  = "/${local.name}/ai/anthropic-key"
  type  = "SecureString"
  value = "REPLACE_WITH_ANTHROPIC_API_KEY"
  lifecycle { ignore_changes = [value] } # operator owns the real value
}

# =====================================================================
# B5: Payments — Paytm gateway, order REST API, order resolvers.
# =====================================================================

# Merchant credentials. Placeholders — set the real values out-of-band:
#   aws ssm put-parameter --name /<name>/payments/paytm-mid  --type String       --overwrite --value <MID>
#   aws ssm put-parameter --name /<name>/payments/paytm-key  --type SecureString --overwrite --value <MERCHANT_KEY>
# The merchant key NEVER lives in the repo, contract, or client.
resource "aws_ssm_parameter" "paytm_mid" {
  name  = "/${local.name}/payments/paytm-mid"
  type  = "String"
  value = "REPLACE_PAYTM_MID"
  lifecycle { ignore_changes = [value] }
}
resource "aws_ssm_parameter" "paytm_key" {
  name  = "/${local.name}/payments/paytm-key"
  type  = "SecureString"
  value = "REPLACE_PAYTM_MERCHANT_KEY"
  lifecycle { ignore_changes = [value] }
}

# HTTP API for the payment REST paths (payments.orderPath = /pay/order).
resource "aws_apigatewayv2_api" "pay" {
  name          = "${local.name}-pay"
  protocol_type = "HTTP"
}

# Cognito JWT authorizer — the app sends its ID token (aud = app client id).
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.pay.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito"
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.app.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

resource "aws_apigatewayv2_integration" "create_order" {
  api_id                 = aws_apigatewayv2_api.pay.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_order.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_integration" "pay_webhook" {
  api_id                 = aws_apigatewayv2_api.pay.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.payment_webhook.invoke_arn
  payload_format_version = "2.0"
}

# POST /pay/order — Cognito-authorized (the buyer creates their own order).
resource "aws_apigatewayv2_route" "create_order" {
  api_id             = aws_apigatewayv2_api.pay.id
  route_key          = "POST /pay/order"
  target             = "integrations/${aws_apigatewayv2_integration.create_order.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}
# POST /pay/webhook — public (Paytm's server-to-server callback; verified by checksum).
resource "aws_apigatewayv2_route" "pay_webhook" {
  api_id    = aws_apigatewayv2_api.pay.id
  route_key = "POST /pay/webhook"
  target    = "integrations/${aws_apigatewayv2_integration.pay_webhook.id}"
}

resource "aws_apigatewayv2_stage" "pay" {
  api_id      = aws_apigatewayv2_api.pay.id
  name        = "v1"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw_create_order" {
  statement_id  = "AllowApiGwCreateOrder"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_order.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.pay.execution_arn}/*/*"
}
resource "aws_lambda_permission" "apigw_pay_webhook" {
  statement_id  = "AllowApiGwPayWebhook"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.payment_webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.pay.execution_arn}/*/*"
}

# Order resolvers (VTL-direct). getOrder = owner read; confirmOrder = server-only
# fan-out (IAM), the @aws_subscribe trigger for onOrderConfirmed.
resource "aws_appsync_resolver" "get_order" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "getOrder"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/get-order.req.vtl")
  response_template = file("${path.module}/resolvers/get-order.res.vtl")
}
resource "aws_appsync_resolver" "confirm_order" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "confirmOrder"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/confirm-order.req.vtl")
  response_template = file("${path.module}/resolvers/confirm-order.res.vtl")
}

# B6: revocations feed — the delta the offline gate verifier pulls, and the
# ops-guarded mutation that writes revocations (both VTL-direct on the table).
resource "aws_appsync_resolver" "revocations_delta" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "revocationsDelta"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/revocations-delta.req.vtl")
  response_template = file("${path.module}/resolvers/revocations-delta.res.vtl")
}
resource "aws_appsync_resolver" "revoke_pass" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "revokePass"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/revoke-pass.req.vtl")
  response_template = file("${path.module}/resolvers/revoke-pass.res.vtl")
}

# =====================================================================
# B8: AI endpoints — one Lambda -> Bedrock, behind /ai/* on the HTTP API.
# =====================================================================
data "archive_file" "ai" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/ai"
  output_path = "${path.module}/.build/ai.zip"
}
resource "aws_lambda_function" "ai" {
  function_name    = "${local.name}-ai"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.ai.output_path
  source_code_hash = data.archive_file.ai.output_base64sha256
  timeout          = 30
  memory_size      = 256
  environment { variables = { ANTHROPIC_MODEL = var.anthropic_model, ANTHROPIC_KEY_PARAM = aws_ssm_parameter.anthropic_key.name, TABLE = aws_dynamodb_table.main.name, AI_RATE_PER_MIN = tostring(var.ai_rate_limit_per_min) } }
}
resource "aws_apigatewayv2_integration" "ai" {
  api_id                 = aws_apigatewayv2_api.pay.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ai.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "ai" {
  for_each           = toset(["/ai/assistant", "/ai/planner", "/ai/translate", "/ai/queue"])
  api_id             = aws_apigatewayv2_api.pay.id
  route_key          = "POST ${each.value}"
  target             = "integrations/${aws_apigatewayv2_integration.ai.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}
resource "aws_lambda_permission" "apigw_ai" {
  statement_id  = "AllowApiGwAi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ai.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.pay.execution_arn}/*/*"
}

# =====================================================================
# B9: Push + geo services.
#   - registerDevice (AppSync -> Lambda) records the user's push token + prefs
#     in the backend's own DynamoDB device registry (DEVICE#<sub>); the SNS
#     fan-out (B10) consumes it. We do NOT use Pinpoint's engagement endpoint
#     APIs — AWS is retiring them (Forbidden already, sunset 2026-10-30). A
#     Pinpoint app is still created so push.pinpointAppId is a real id for the
#     contract; FCM sender id (var.fcm_sender_id) is an owner-provided secret.
#   - Amazon Location: a geofence collection (venue arrivals) + a tracker
#     (park-&-shuttle live ETA). Names match the contract's geo.* fields.
# =====================================================================
resource "aws_pinpoint_app" "bir" {
  name = local.name
}

data "archive_file" "register_device" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/register-device"
  output_path = "${path.module}/.build/register-device.zip"
}
resource "aws_lambda_function" "register_device" {
  function_name    = "${local.name}-register-device"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.register_device.output_path
  source_code_hash = data.archive_file.register_device.output_base64sha256
  timeout          = 10
  environment { variables = { TABLE = aws_dynamodb_table.main.name } }
}
resource "aws_appsync_datasource" "register_device_lambda" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "RegisterDeviceLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn
  lambda_config { function_arn = aws_lambda_function.register_device.arn }
}
resource "aws_appsync_resolver" "register_device" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "registerDevice"
  data_source       = aws_appsync_datasource.register_device_lambda.name
  request_template  = file("${path.module}/resolvers/lambda-invoke.req.vtl")
  response_template = file("${path.module}/resolvers/lambda-invoke.res.vtl")
}

resource "aws_location_geofence_collection" "venues" {
  collection_name = "${local.name}-venues"
}
resource "aws_location_tracker" "shuttles" {
  tracker_name = "${local.name}-shuttles"
}

# =====================================================================
# B10: Ops resolvers — recordScan (gate audit), setFlyStatus (safety-officer,
# refund auto-queue + SNS fan-out), flyStatus (public read).
# =====================================================================
resource "aws_sns_topic" "fly_status" {
  name = "${local.name}-fly-status"
}

# recordScan + flyStatus are plain DynamoDB resolvers.
resource "aws_appsync_resolver" "record_scan" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "recordScan"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/record-scan.req.vtl")
  response_template = file("${path.module}/resolvers/record-scan.res.vtl")
}
resource "aws_appsync_resolver" "fly_status" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "flyStatus"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/fly-status.req.vtl")
  response_template = file("${path.module}/resolvers/fly-status.res.vtl")
}

# setFlyStatus is Lambda-backed (multi-write + refund queue + SNS publish).
data "archive_file" "set_fly_status" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/set-fly-status"
  output_path = "${path.module}/.build/set-fly-status.zip"
}
resource "aws_lambda_function" "set_fly_status" {
  function_name    = "${local.name}-set-fly-status"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.set_fly_status.output_path
  source_code_hash = data.archive_file.set_fly_status.output_base64sha256
  timeout          = 15
  environment { variables = { TABLE = aws_dynamodb_table.main.name, FLY_TOPIC_ARN = aws_sns_topic.fly_status.arn } }
}
resource "aws_appsync_datasource" "set_fly_status_lambda" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "SetFlyStatusLambda"
  type             = "AWS_LAMBDA"
  service_role_arn = aws_iam_role.appsync_lambda.arn
  lambda_config { function_arn = aws_lambda_function.set_fly_status.arn }
}
resource "aws_appsync_resolver" "set_fly_status" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "setFlyStatus"
  data_source       = aws_appsync_datasource.set_fly_status_lambda.name
  request_template  = file("${path.module}/resolvers/lambda-invoke.req.vtl")
  response_template = file("${path.module}/resolvers/lambda-invoke.res.vtl")
}

# =====================================================================
# Live-transition gap resolvers: schema fields the client calls that had no
# resolver (would runtime-fail with mocks off). All VTL-direct on the table.
#   myRegistrations (B1) · ticketTiers (P3.1) · scheduleDelta (P2.4) ·
#   castVote (P3.2) · reportSos (P3.3)
# =====================================================================
resource "aws_appsync_resolver" "my_registrations" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "myRegistrations"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/my-registrations.req.vtl")
  response_template = file("${path.module}/resolvers/my-registrations.res.vtl")
}
resource "aws_appsync_resolver" "ticket_tiers" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "ticketTiers"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/ticket-tiers.req.vtl")
  response_template = file("${path.module}/resolvers/ticket-tiers.res.vtl")
}
resource "aws_appsync_resolver" "schedule_delta" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Query"
  field             = "scheduleDelta"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/schedule-delta.req.vtl")
  response_template = file("${path.module}/resolvers/schedule-delta.res.vtl")
}
resource "aws_appsync_resolver" "cast_vote" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "castVote"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/cast-vote.req.vtl")
  response_template = file("${path.module}/resolvers/cast-vote.res.vtl")
}
resource "aws_appsync_resolver" "report_sos" {
  api_id            = aws_appsync_graphql_api.main.id
  type              = "Mutation"
  field             = "reportSos"
  data_source       = aws_appsync_datasource.ddb.name
  request_template  = file("${path.module}/resolvers/report-sos.req.vtl")
  response_template = file("${path.module}/resolvers/report-sos.res.vtl")
}
