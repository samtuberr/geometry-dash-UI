locals {
  labels = { app = "geometrydash-ui", environment = "production", managed_by = "terraform" }
  services = toset([
    "serviceusage.googleapis.com", "compute.googleapis.com", "storage.googleapis.com",
    "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com",
    "iap.googleapis.com", "oslogin.googleapis.com", "artifactregistry.googleapis.com",
    "logging.googleapis.com", "monitoring.googleapis.com", "cloudbilling.googleapis.com",
    "billingbudgets.googleapis.com", "cloudresourcemanager.googleapis.com",
  ])
  ci_accounts = toset(["publisher", "deployer", "terraform", "drift"])
  workflow_access = {
    publisher_release = { account = "publisher", workflow = "release.yml" }
    deployer_release  = { account = "deployer", workflow = "release.yml" }
    deployer_rollback = { account = "deployer", workflow = "rollback.yml" }
    terraform_infra   = { account = "terraform", workflow = "infra.yml" }
    drift_infra       = { account = "drift", workflow = "drift.yml" }
  }
  operator_roles  = toset(["roles/compute.osAdminLogin", "roles/compute.viewer", "roles/iap.tunnelResourceAccessor", "roles/serviceusage.serviceUsageConsumer"])
  operators       = setunion(var.admin_members, toset(["serviceAccount:geometrydash-ui-deployer@${var.project_id}.iam.gserviceaccount.com"]))
  operator_grants = { for pair in setproduct(local.operators, local.operator_roles) : "${pair[0]}|${pair[1]}" => { member = pair[0], role = pair[1] } }
}

data "google_project" "this" { project_id = var.project_id }

resource "google_project_service" "api" {
  for_each           = local.services
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

resource "google_storage_bucket" "state" {
  for_each                    = toset(["bootstrap", "production", "github"])
  project                     = var.project_id
  name                        = "${var.project_id}-tf-${each.key}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  versioning { enabled = true }
  lifecycle_rule {
    condition { num_newer_versions = 20 }
    action { type = "Delete" }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.api]
}

resource "google_artifact_registry_repository" "production" {
  project       = var.project_id
  location      = var.region
  repository_id = "geometrydash-ui-production"
  format        = "DOCKER"
  labels        = local.labels
  # No automatic deletion: current and rollback digests must remain available.
  docker_config { immutable_tags = true }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.api]
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "geometrydash-ui-runtime"
  display_name = "geometrydash-ui production VM runtime"
  depends_on   = [google_project_service.api]
}
resource "google_service_account" "ci" {
  for_each     = local.ci_accounts
  project      = var.project_id
  account_id   = "geometrydash-ui-${each.key}"
  display_name = "geometrydash-ui production ${each.key}"
  depends_on   = [google_project_service.api]
}
resource "google_project_iam_member" "runtime" {
  for_each = toset(["roles/logging.logWriter", "roles/monitoring.metricWriter"])
  project  = var.project_id
  role     = each.key
  member   = google_service_account.runtime.member
}
resource "google_artifact_registry_repository_iam_member" "runtime" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.production.name
  role       = "roles/artifactregistry.reader"
  member     = google_service_account.runtime.member
}
resource "google_artifact_registry_repository_iam_member" "publisher" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.production.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.ci["publisher"].member
}
resource "google_project_iam_member" "publisher_api_usage" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = google_service_account.ci["publisher"].member
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "geometrydash-ui-github"
  display_name              = "geometrydash-ui trusted production workflows"
  depends_on                = [google_project_service.api]
}
resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
    "attribute.environment"         = "assertion.environment"
    "attribute.event_name"          = "assertion.event_name"
    "attribute.workflow"            = "assertion.workflow_ref.extract('/.github/workflows/{name}@')"
  }
  attribute_condition = join(" && ", [
    "assertion.repository_id == '${var.github_repository_id}'",
    "assertion.repository_owner_id == '${var.github_owner_id}'",
    "assertion.ref == 'refs/heads/main'",
    "assertion.environment == 'production'",
    "assertion.event_name in ['workflow_dispatch', 'schedule']",
    "assertion.workflow_ref in ${jsonencode([for workflow in ["release.yml", "rollback.yml", "infra.yml", "drift.yml"] : "${var.github_repository}/.github/workflows/${workflow}@refs/heads/main"])}",
  ])
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}
resource "google_service_account_iam_member" "federation" {
  for_each           = local.workflow_access
  service_account_id = google_service_account.ci[each.value.account].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.workflow/${each.value.workflow}"
}

resource "google_project_iam_member" "operators" {
  for_each   = local.operator_grants
  project    = var.project_id
  role       = each.value.role
  member     = each.value.member
  depends_on = [google_service_account.ci]
  dynamic "condition" {
    for_each = each.value.role == "roles/iap.tunnelResourceAccessor" ? [1] : []
    content {
      title      = "ssh-only"
      expression = "destination.port == 22"
    }
  }
}
resource "google_service_account_iam_member" "operators_runtime" {
  for_each           = local.operators
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = each.key
  depends_on         = [google_service_account.ci]
}

# The infrastructure identity administers Compute and Monitoring in this NEW
# project only. It cannot change project IAM, WIF, registry IAM or bootstrap state.
resource "google_project_iam_member" "terraform" {
  for_each = toset(["roles/compute.admin", "roles/monitoring.editor", "roles/serviceusage.serviceUsageConsumer"])
  project  = var.project_id
  role     = each.key
  member   = google_service_account.ci["terraform"].member
}
resource "google_service_account_iam_member" "terraform_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.ci["terraform"].member
}
resource "google_storage_bucket_iam_member" "terraform_state" {
  bucket = google_storage_bucket.state["production"].name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.ci["terraform"].member
}
resource "google_project_iam_member" "drift" {
  for_each = toset(["roles/compute.viewer", "roles/monitoring.viewer", "roles/serviceusage.serviceUsageConsumer"])
  project  = var.project_id
  role     = each.key
  member   = google_service_account.ci["drift"].member
}
resource "google_storage_bucket_iam_member" "drift_state" {
  bucket = google_storage_bucket.state["production"].name
  role   = "roles/storage.objectViewer"
  member = google_service_account.ci["drift"].member
}

resource "google_logging_project_bucket_config" "default" {
  project        = var.project_id
  location       = "global"
  bucket_id      = "_Default"
  retention_days = 7
  depends_on     = [google_project_service.api]
}
resource "google_billing_budget" "production" {
  count           = var.billing_account_id == "" ? 0 : 1
  billing_account = var.billing_account_id
  display_name    = "geometrydash-ui production — alerts only"
  budget_filter {
    projects               = ["projects/${data.google_project.this.number}"]
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }
  dynamic "threshold_rules" {
    for_each = [0.5, 0.8, 1.0]
    content { threshold_percent = threshold_rules.value }
  }
  depends_on = [google_project_service.api]
}

# FUTURE DEV/STAGING: intentionally inactive. Create a separate project, state,
# registry, identities and federation boundary before adding those environments.
# Do not point another environment at any production bucket or service account.
