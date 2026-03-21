# ─── Frontend Service Module ───────────────────────────────────
# Cloud Run for Next.js frontend (standalone mode)

# Artifact Registry repo for frontend images
resource "google_artifact_registry_repository" "frontend" {
  location      = var.region
  repository_id = "${var.project_prefix}-frontend"
  format        = "DOCKER"
  project       = var.gcp_project_id

  labels = {
    environment = var.environment
    service     = "frontend"
  }
}

# Service account for Cloud Run frontend
resource "google_service_account" "frontend" {
  account_id   = "${var.project_prefix}-fe-${var.environment}"
  display_name = "Taysiro Frontend (${var.environment})"
  project      = var.gcp_project_id
}

# ─── Cloud Run Service ────────────────────────────────────────
resource "google_cloud_run_v2_service" "frontend" {
  name     = "${var.project_prefix}-frontend-${var.environment}"
  location = var.region
  project  = var.gcp_project_id

  template {
    service_account = google_service_account.frontend.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.frontend_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = true # scale to zero OK for frontend
      }

      startup_probe {
        http_get {
          path = "/"
          port = 3000
        }
        initial_delay_seconds = 3
        period_seconds        = 3
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/"
          port = 3000
        }
        period_seconds    = 30
        failure_threshold = 3
      }

      env {
        name  = "NODE_ENV"
        value = var.environment == "production" ? "production" : "development"
      }

      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = var.backend_service_url
      }

      env {
        name  = "HOSTNAME"
        value = "0.0.0.0"
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# Allow public access
resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  project  = var.gcp_project_id
  role     = "roles/run.invoker"
  member   = "allUsers"
}
