# =============================================================================
#  State — LOCAL by design. bir-backend is a STANDALONE app (unlike the
#  ai-demo-stack demos that share a platform state bucket). Local state is the
#  strongest possible teardown guarantee: `terraform destroy` can only ever see
#  resources recorded in THIS file, so it is structurally impossible for it to
#  touch another company-demos project. The state lives beside this stack and is
#  gitignored. (To share state across a team, switch to an S3 backend with an
#  isolated key: bir-festival-2026/terraform.tfstate — bootstrap the bucket first.)
# =============================================================================
terraform {
  # local backend (default) — nothing to configure.
}
