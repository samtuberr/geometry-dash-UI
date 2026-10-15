terraform {
  required_version = "= 1.16.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 8.7.0"
    }
  }
  backend "gcs" { prefix = "production" }
}
provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}
