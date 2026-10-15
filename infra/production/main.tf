locals {
  labels           = { app = "geometrydash-ui", environment = "production", managed_by = "terraform" }
  runtime          = "geometrydash-ui-runtime@${var.project_id}.iam.gserviceaccount.com"
  image_repository = "${var.region}-docker.pkg.dev/${var.project_id}/geometrydash-ui-production/web"
  host_files = {
    "/etc/geometrydash-ui/config.json" = base64encode(jsonencode({
      domain = var.domain, acme_email = var.notification_email, image_repository = local.image_repository
    }))
    "/usr/local/lib/geometrydash-ui/release.py"           = filebase64("${path.module}/../../ops/host/release.py")
    "/usr/local/lib/geometrydash-ui/smoke.py"             = filebase64("${path.module}/../../ops/smoke.py")
    "/usr/local/lib/geometrydash-ui/configure-web.py"     = filebase64("${path.module}/../../ops/host/configure-web.py")
    "/etc/google-cloud-ops-agent/config.yaml"             = filebase64("${path.module}/../../ops/host/ops-agent.yaml")
    "/etc/systemd/system/geometrydash-ui-recover.service" = filebase64("${path.module}/../../ops/host/geometrydash-ui-recover.service")
    "/etc/logrotate.d/geometrydash-ui"                    = filebase64("${path.module}/../../ops/host/geometrydash-ui-logrotate")
    "/etc/apt/apt.conf.d/20auto-upgrades"                 = filebase64("${path.module}/../../ops/host/20auto-upgrades")
  }
}
resource "google_compute_network" "production" {
  project                 = var.project_id
  name                    = "geometrydash-ui-production"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}
resource "google_compute_subnetwork" "production" {
  project                  = var.project_id
  name                     = "geometrydash-ui-production"
  region                   = var.region
  network                  = google_compute_network.production.id
  ip_cidr_range            = "10.42.0.0/24"
  private_ip_google_access = true
}
resource "google_compute_address" "production" {
  project      = var.project_id
  name         = "geometrydash-ui-production"
  region       = var.region
  address_type = "EXTERNAL"
}
# Public HTTPS and HTTP ACME/redirect are intentional; no SSH/container port here.
# trivy:ignore:GCP-0027
resource "google_compute_firewall" "web" {
  project                 = var.project_id
  name                    = "geometrydash-ui-production-web"
  network                 = google_compute_network.production.name
  direction               = "INGRESS"
  source_ranges           = ["0.0.0.0/0"]
  target_service_accounts = [local.runtime]
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
}
resource "google_compute_firewall" "iap" {
  project                 = var.project_id
  name                    = "geometrydash-ui-production-iap"
  network                 = google_compute_network.production.name
  direction               = "INGRESS"
  source_ranges           = ["35.235.240.0/20"]
  target_service_accounts = [local.runtime]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}
# Trial profile uses one public IP for inbound HTTPS/outbound packages, avoiding
# a load balancer/NAT charge. SSH remains IAP-only and containers bind localhost.
# trivy:ignore:GCP-0031
resource "google_compute_instance" "production" {
  project             = var.project_id
  name                = "geometrydash-ui-production"
  zone                = var.zone
  machine_type        = var.machine_type
  labels              = local.labels
  deletion_protection = var.deletion_protection
  boot_disk {
    initialize_params {
      image  = "projects/debian-cloud/global/images/family/debian-12"
      size   = var.disk_size_gb
      type   = "pd-balanced"
      labels = local.labels
    }
  }
  network_interface {
    subnetwork = google_compute_subnetwork.production.id
    access_config { nat_ip = google_compute_address.production.address }
  }
  service_account {
    email  = local.runtime
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }
  metadata = {
    enable-oslogin         = "TRUE"
    block-project-ssh-keys = "TRUE"
    startup-script = templatefile("${path.module}/../../ops/host/startup.sh.tftpl", {
      payload = base64encode(jsonencode(local.host_files))
    })
  }
  scheduling {
    provisioning_model  = "STANDARD"
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
  }
  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }
  allow_stopping_for_update = true
}

# FUTURE DEV/STAGING: no resources or modules are active for those environments.
# Use separate Terraform roots, GCP projects, state and runtime identities.
# FUTURE HA: replace the singleton with a two-zone regional MIG + HTTPS LB after
# measuring cost/quota. This VM has recovery and release rollback, not host HA.
