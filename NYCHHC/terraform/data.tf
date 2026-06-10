# =============================================================================
#  Platform data sources — READ ONLY. We never manage these; they belong to the
#  ai-demo-stack-aws platform. This is how the demo "stands on" the stack.
# =============================================================================

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# The existing cluster OIDC provider (created by the platform's iam-irsa module).
# Referenced ONLY when enable_irsa=true — we look it up, we do NOT create one
# (creating a second provider for the same issuer would conflict).
data "aws_iam_openid_connect_provider" "ocp" {
  count = var.enable_irsa ? 1 : 0
  url   = var.oidc_issuer_url
}
