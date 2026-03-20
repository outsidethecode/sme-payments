# ─── Database Module ───────────────────────────────────────────
# Cloud SQL for PostgreSQL 15 with private networking

resource "google_sql_database_instance" "main" {
  name             = "${var.project_prefix}-${var.environment}-pg"
  database_version = "POSTGRES_15"
  region           = var.region
  project          = var.gcp_project_id

  deletion_protection = var.environment == "production"

  settings {
    tier              = var.tier
    availability_type = var.high_availability ? "REGIONAL" : "ZONAL"
    disk_size         = var.disk_size_gb
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network_id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
      backup_retention_settings {
        retained_backups = var.backup_retention_count
      }
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "200"
    }

    insights_config {
      query_insights_enabled  = var.environment == "production"
      record_application_tags = true
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 4
    }
  }

  depends_on = [var.private_services_connection]
}

resource "google_sql_database" "main" {
  name     = var.db_name
  instance = google_sql_database_instance.main.name
  project  = var.gcp_project_id
}

resource "google_sql_user" "main" {
  name     = var.db_username
  instance = google_sql_database_instance.main.name
  password = var.db_password
  project  = var.gcp_project_id
}
