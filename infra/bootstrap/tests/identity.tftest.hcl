mock_provider "google" {}
variables {
  project_id           = "geometrydash-ui-isolated-test"
  github_repository    = "example/geometrydash-ui"
  github_repository_id = "123456789"
  github_owner_id      = "987654321"
}
run "trusted_production_only" {
  command = plan
  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.repository_id == '123456789'") && strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.repository_owner_id == '987654321'")
    error_message = "Federation must restrict both immutable owner and repository IDs."
  }
  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.environment == 'production'") && strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.ref == 'refs/heads/main'")
    error_message = "Only main in the production GitHub environment may authenticate."
  }
  assert {
    condition     = google_storage_bucket.state["production"].public_access_prevention == "enforced" && google_storage_bucket.state["production"].versioning[0].enabled
    error_message = "Production state must be private and versioned."
  }
  assert {
    condition     = google_artifact_registry_repository.production.docker_config[0].immutable_tags
    error_message = "Published release tags must not be overwritten."
  }
  assert {
    condition     = length(google_service_account.ci) == 4 && length(google_storage_bucket.state) == 3
    error_message = "Keep separate publisher/deployer/Terraform/drift identities and independent administrative state."
  }
}
