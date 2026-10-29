terraform {
  required_version = "= 1.16.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "8.8.1"
    }
  }
  # First apply is local. After creation, add backend.tf from the documented
  # template and run init -migrate-state into the BOOTSTRAP bucket, not prod state.
}
provider "google" {
  project = var.project_id
  region  = var.region
}
