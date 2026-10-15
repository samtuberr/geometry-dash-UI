variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "us-central1"
}
variable "zone" {
  type    = string
  default = "us-central1-a"
  validation {
    condition     = startswith(var.zone, "${var.region}-")
    error_message = "The VM zone must belong to the selected region."
  }
}
variable "machine_type" {
  type    = string
  default = "e2-small"
}
variable "disk_size_gb" {
  type    = number
  default = 20
  validation {
    condition     = var.disk_size_gb >= 20 && floor(var.disk_size_gb) == var.disk_size_gb
    error_message = "Use at least 20 GiB for the OS, two images, logs and retained browser assets."
  }
}
variable "domain" {
  description = "A DNS hostname you control, with an A record pointing to the output IPv4."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.domain))
    error_message = "Use a lowercase DNS hostname, without scheme, path, wildcard or port."
  }
}
variable "notification_email" {
  description = "Monitoring alerts and certificate registration email."
  type        = string
  validation {
    condition     = can(regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", var.notification_email))
    error_message = "Provide a valid notification email."
  }
}
variable "deletion_protection" {
  type    = bool
  default = true
}
