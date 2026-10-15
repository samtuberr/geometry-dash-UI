output "public_ipv4" { value = google_compute_address.production.address }
output "url" { value = "https://${var.domain}" }
output "vm_name" { value = google_compute_instance.production.name }
output "zone" { value = var.zone }
output "image_repository" { value = local.image_repository }
output "startup_script_sha256" { value = sha256(google_compute_instance.production.metadata["startup-script"]) }
