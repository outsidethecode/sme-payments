# ─── Monitoring Module ─────────────────────────────────────────
# Cloud Monitoring alert policies + notification channels

# Email notification channel
resource "google_monitoring_notification_channel" "email" {
  display_name = "${var.project_prefix} ${var.environment} Alerts"
  type         = "email"
  project      = var.gcp_project_id

  labels = {
    email_address = var.alert_email
  }
}

# ─── Cloud Run Backend — High Error Rate ──────────────────────
resource "google_monitoring_alert_policy" "backend_errors" {
  display_name = "[${var.environment}] Backend 5xx Error Rate > 5%"
  project      = var.gcp_project_id
  combiner     = "OR"

  conditions {
    display_name = "Backend error rate"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.backend_service_name}\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }
}

# ─── Cloud Run Backend — High Latency ────────────────────────
resource "google_monitoring_alert_policy" "backend_latency" {
  display_name = "[${var.environment}] Backend P95 Latency > 2s"
  project      = var.gcp_project_id
  combiner     = "OR"

  conditions {
    display_name = "Backend latency"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.backend_service_name}\" AND metric.type = \"run.googleapis.com/request_latencies\""
      comparison      = "COMPARISON_GT"
      threshold_value = 2000
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }
}

# ─── Cloud SQL — High CPU ────────────────────────────────────
resource "google_monitoring_alert_policy" "database_cpu" {
  display_name = "[${var.environment}] Cloud SQL CPU > 80%"
  project      = var.gcp_project_id
  combiner     = "OR"

  conditions {
    display_name = "Database CPU utilization"

    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND resource.labels.database_id = \"${var.gcp_project_id}:${var.database_instance_name}\" AND metric.type = \"cloudsql.googleapis.com/database/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }
}

# ─── Cloud SQL — Storage > 80% ───────────────────────────────
resource "google_monitoring_alert_policy" "database_storage" {
  display_name = "[${var.environment}] Cloud SQL Storage > 80%"
  project      = var.gcp_project_id
  combiner     = "OR"

  conditions {
    display_name = "Database storage utilization"

    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND resource.labels.database_id = \"${var.gcp_project_id}:${var.database_instance_name}\" AND metric.type = \"cloudsql.googleapis.com/database/disk/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }
}

# ─── Redis — Memory > 80% ────────────────────────────────────
resource "google_monitoring_alert_policy" "redis_memory" {
  display_name = "[${var.environment}] Redis Memory > 80%"
  project      = var.gcp_project_id
  combiner     = "OR"

  conditions {
    display_name = "Redis memory utilization"

    condition_threshold {
      filter          = "resource.type = \"redis_instance\" AND metric.type = \"redis.googleapis.com/stats/memory/usage_ratio\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }
}
