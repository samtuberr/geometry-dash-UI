variable "project_id" {
  description = "A new, billing-enabled project dedicated exclusively to geometrydash-ui production."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Provide a valid dedicated GCP project ID."
  }
}
variable "region" {
  type    = string
  default = "us-central1"
}
variable "github_repository" {
  description = "OWNER/REPO, with exact GitHub casing."
  type        = string
}
variable "github_repository_id" {
  description = "Immutable numeric repository ID from the GitHub API."
  type        = string
  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "Use GitHub's numeric repository ID, not the repository name."
  }
}
variable "github_owner_id" {
  description = "Immutable numeric repository owner ID from the GitHub API."
  type        = string
  validation {
    condition     = can(regex("^[0-9]+$", var.github_owner_id))
    error_message = "Use GitHub's numeric owner ID."
  }
}
variable "admin_members" {
  description = "Human IAP/OS Login administrators, e.g. user:you@example.com."
  type        = set(string)
  default     = []
}
variable "billing_account_id" {
  description = "Optional billing account ID for a project-scoped alerts-only budget."
  type        = string
  default     = ""
}
variable "monthly_budget_usd" {
  type    = number
  default = 35
  validation {
    condition     = var.monthly_budget_usd >= 1 && floor(var.monthly_budget_usd) == var.monthly_budget_usd
    error_message = "Set a positive whole-dollar alert budget."
  }
}
