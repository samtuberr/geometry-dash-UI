output "workload_identity_provider" { value = google_iam_workload_identity_pool_provider.github.name }
output "production_state_bucket" { value = google_storage_bucket.state["production"].name }
output "bootstrap_state_bucket" { value = google_storage_bucket.state["bootstrap"].name }
output "github_state_bucket" { value = google_storage_bucket.state["github"].name }
output "image_repository" { value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.production.repository_id}/web" }
output "service_accounts" { value = { for key, account in google_service_account.ci : key => account.email } }
output "runtime_service_account" { value = google_service_account.runtime.email }
