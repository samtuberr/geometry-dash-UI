mock_provider "google" {}
variables {
  project_id         = "geometrydash-ui-isolated-test"
  domain             = "geometrydash-ui.example.com"
  notification_email = "operator@example.com"
}
run "production_isolation" {
  command = plan
  assert {
    condition     = google_compute_instance.production.project == "geometrydash-ui-isolated-test"
    error_message = "The VM must use the explicit dedicated production project."
  }
  assert {
    condition     = google_compute_instance.production.scheduling[0].provisioning_model == "STANDARD"
    error_message = "Production cannot use interruptible Spot capacity."
  }
  assert {
    condition     = google_compute_instance.production.metadata["enable-oslogin"] == "TRUE"
    error_message = "OS Login must remain enabled."
  }
  assert {
    condition     = google_compute_firewall.iap.source_ranges == toset(["35.235.240.0/20"])
    error_message = "SSH must only be reachable through IAP."
  }
  assert {
    condition     = one(google_compute_firewall.web.allow).ports == tolist(["80", "443"])
    error_message = "Public ingress must not expose SSH or blue/green container ports."
  }
  assert {
    condition     = google_compute_instance.production.deletion_protection
    error_message = "Production deletion protection is required by default."
  }
  assert {
    condition     = google_compute_instance.production.service_account[0].email == "geometrydash-ui-runtime@geometrydash-ui-isolated-test.iam.gserviceaccount.com"
    error_message = "The VM must not use a shared/default service account."
  }
  assert {
    condition     = google_monitoring_uptime_check_config.https.http_check[0].validate_ssl
    error_message = "External uptime checks must verify HTTPS certificates."
  }
}
run "invalid_domain" {
  command = plan
  variables { domain = "example.com;bad-command" }
  expect_failures = [var.domain]
}
run "zone_region_mismatch" {
  command = plan
  variables { zone = "europe-west1-b" }
  expect_failures = [var.zone]
}
