terraform {
  required_version = "= 1.16.6"
  required_providers {
    github = { source = "integrations/github", version = "= 6.13.0" }
  }
  backend "gcs" { prefix = "github" }
}
provider "github" {
  owner = var.owner
  # GITHUB_TOKEN is supplied locally for setup; never place it in tfvars/state.
}
variable "owner" { type = string }
variable "repository" { type = string }
variable "project_number" { type = string }
variable "production" {
  type = object({
    project_id         = string
    region             = string
    zone               = string
    domain             = string
    notification_email = string
    machine_type       = optional(string, "e2-small")
    disk_size_gb       = optional(number, 20)
  })
}
variable "enable_gcp_deployments" {
  description = "Set true only after bootstrap, VM/DNS setup and GitHub protections are ready."
  type        = bool
  default     = false
}
variable "manage_branch_protection" {
  type    = bool
  default = true
}
variable "reviewer_user_ids" {
  description = "Optional GitHub numeric user IDs; availability depends on repo visibility/plan."
  type        = list(number)
  default     = []
}
resource "github_repository_environment" "production" {
  repository          = var.repository
  environment         = "production"
  can_admins_bypass   = false
  prevent_self_review = false # Allows a solo maintainer to approve their manual run.
  dynamic "reviewers" {
    for_each = length(var.reviewer_user_ids) > 0 ? [1] : []
    content { users = var.reviewer_user_ids }
  }
  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}
resource "github_repository_environment_deployment_policy" "main" {
  repository     = var.repository
  environment    = github_repository_environment.production.environment
  branch_pattern = "main"
}
resource "github_actions_variable" "enabled" {
  repository    = var.repository
  variable_name = "ENABLE_GCP_DEPLOYMENTS"
  value         = tostring(var.enable_gcp_deployments)
}
locals {
  variables = {
    GCP_PROJECT_ID     = var.production.project_id
    GCP_REGION         = var.production.region
    GCP_ZONE           = var.production.zone
    PROD_VM            = "geometrydash-ui-production"
    PROD_DOMAIN        = var.production.domain
    NOTIFICATION_EMAIL = var.production.notification_email
    MACHINE_TYPE       = var.production.machine_type
    DISK_SIZE_GB       = tostring(var.production.disk_size_gb)
    TF_STATE_BUCKET    = "${var.production.project_id}-tf-production"
    WIF_PROVIDER       = "projects/${var.project_number}/locations/global/workloadIdentityPools/geometrydash-ui-github/providers/github"
    PUBLISHER_SA       = "geometrydash-ui-publisher@${var.production.project_id}.iam.gserviceaccount.com"
    DEPLOYER_SA        = "geometrydash-ui-deployer@${var.production.project_id}.iam.gserviceaccount.com"
    TERRAFORM_SA       = "geometrydash-ui-terraform@${var.production.project_id}.iam.gserviceaccount.com"
    DRIFT_SA           = "geometrydash-ui-drift@${var.production.project_id}.iam.gserviceaccount.com"
  }
}
resource "github_actions_environment_variable" "production" {
  for_each      = local.variables
  repository    = var.repository
  environment   = github_repository_environment.production.environment
  variable_name = each.key
  value         = each.value
}
# Signing is not forced on the solo-maintainer setup. Main still requires checks
# and PRs. Adopt organization signing requirements when the team grows.
# trivy:ignore:GIT-0004
resource "github_branch_protection" "main" {
  count               = var.manage_branch_protection ? 1 : 0
  repository_id       = var.repository
  pattern             = "main"
  enforce_admins      = true
  allows_deletions    = false
  allows_force_pushes = false
  required_status_checks {
    strict   = true
    contexts = ["Application checks", "Infrastructure checks", "Release logic tests"]
  }
  required_pull_request_reviews {
    required_approving_review_count = 0
    dismiss_stale_reviews           = true
  }
}

# FUTURE DEV/STAGING: deliberately commented out; no GitHub environments exist.
# resource "github_repository_environment" "staging" {
#   repository  = var.repository
#   environment = "staging"
# }
# resource "github_repository_environment" "dev" {
#   repository  = var.repository
#   environment = "dev"
# }
