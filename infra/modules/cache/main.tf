# ─── Cache Module ──────────────────────────────────────────────
# Memorystore for Redis (managed Redis in VPC)

resource "google_redis_instance" "main" {
  name           = "${var.project_prefix}-${var.environment}-redis"
  tier           = var.high_availability ? "STANDARD_HA" : "BASIC"
  memory_size_gb = var.memory_size_gb
  region         = var.region
  project        = var.gcp_project_id

  redis_version = "REDIS_7_0"

  authorized_network = var.network_id

  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 5
        minutes = 0
      }
    }
  }

  labels = {
    environment = var.environment
    project     = var.project_prefix
  }
}
