resource "google_monitoring_notification_channel" "email" {
  project      = var.project_id
  display_name = "geometrydash-ui production operator"
  type         = "email"
  labels       = { email_address = var.notification_email }
}
resource "google_monitoring_uptime_check_config" "https" {
  project          = var.project_id
  display_name     = "geometrydash-ui production HTTPS"
  timeout          = "10s"
  period           = "60s"
  selected_regions = ["USA", "EUROPE", "ASIA_PACIFIC"]
  monitored_resource {
    type   = "uptime_url"
    labels = { project_id = var.project_id, host = var.domain }
  }
  http_check {
    path         = "/healthz"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  content_matchers { content = "ok" }
}
resource "google_monitoring_alert_policy" "https" {
  project               = var.project_id
  display_name          = "geometrydash-ui production: HTTPS unavailable"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.name]
  conditions {
    display_name = "At least two check locations failing for 3 minutes"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.https.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "180s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
      trigger { count = 1 }
    }
  }
  documentation {
    content   = "See PRODUCTION_SETUP.md: check DNS/TLS, VM health and startup logs; use Production rollback for a bad release. A single VM cannot survive a zone outage."
    mime_type = "text/markdown"
  }
}
locals {
  host_alerts = {
    cpu = {
      metric    = "compute.googleapis.com/instance/cpu/utilization"
      threshold = 0.85
      extra     = ""
    }
    memory = {
      metric    = "agent.googleapis.com/memory/percent_used"
      threshold = 85
      extra     = " AND metric.label.state=\"used\""
    }
    disk = {
      metric    = "agent.googleapis.com/disk/percent_used"
      threshold = 80
      extra     = " AND metric.label.state=\"used\""
    }
  }
}
resource "google_monitoring_alert_policy" "host" {
  for_each              = local.host_alerts
  project               = var.project_id
  display_name          = "geometrydash-ui production: high ${each.key}"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.name]
  conditions {
    display_name = "${each.key} over threshold for 5 minutes"
    condition_threshold {
      filter          = "resource.type=\"gce_instance\" AND resource.label.instance_id=\"${google_compute_instance.production.instance_id}\" AND metric.type=\"${each.value.metric}\"${each.value.extra}"
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
      trigger { count = 1 }
    }
  }
}
resource "google_monitoring_alert_policy" "agent_missing" {
  project               = var.project_id
  display_name          = "geometrydash-ui production: Ops Agent metrics missing"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.name]
  conditions {
    display_name = "Memory metrics missing for 10 minutes"
    condition_absent {
      filter   = "resource.type=\"gce_instance\" AND resource.label.instance_id=\"${google_compute_instance.production.instance_id}\" AND metric.type=\"agent.googleapis.com/memory/percent_used\""
      duration = "600s"
      trigger { count = 1 }
    }
  }
}
resource "google_monitoring_alert_policy" "certificate" {
  project               = var.project_id
  display_name          = "geometrydash-ui production: TLS certificate expires within 14 days"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.name]
  conditions {
    display_name = "Certificate expiry"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/time_until_ssl_cert_expires\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.https.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 14
      duration        = "60s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MIN"
      }
    }
  }
}
resource "google_monitoring_dashboard" "production" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "geometrydash-ui production"
    gridLayout = {
      columns = "2"
      widgets = concat([
        { title = "Runbook", text = { format = "MARKDOWN", content = "**geometrydash-ui production**\n\nRunbook: PRODUCTION_SETUP.md in the repository.\n\nSingle VM; public HTTPS; IAP administration; blue/green releases.\n\nUse the uptime/CPU/memory/disk alert policies and GitHub workflow records during incidents." } }
        ], [for key, alert in local.host_alerts : {
          title = "Host ${key}"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = { timeSeriesFilter = {
                filter      = "resource.type=\"gce_instance\" AND resource.label.instance_id=\"${google_compute_instance.production.instance_id}\" AND metric.type=\"${alert.metric}\"${alert.extra}"
                aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" }
              } }
              plotType = "LINE"
            }]
          }
      }])
    }
  })
}
