# ─── Backend Service Module ────────────────────────────────────
# Cloud Run for NestJS backend

# Artifact Registry repo for backend images
resource "google_artifact_registry_repository" "backend" {
  location      = var.region
  repository_id = "${var.project_prefix}-backend"
  format        = "DOCKER"
  project       = var.gcp_project_id

  labels = {
    environment = var.environment
    service     = "backend"
  }
}

# Service account for Cloud Run backend
resource "google_service_account" "backend" {
  account_id   = "${var.project_prefix}-backend-${var.environment}"
  display_name = "Taysiro Backend (${var.environment})"
  project      = var.gcp_project_id
}

# Backend needs access to Cloud SQL
resource "google_project_iam_member" "backend_sql" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# Backend needs access to Cloud Storage
resource "google_project_iam_member" "backend_storage" {
  project = var.gcp_project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# Backend needs access to Secret Manager
resource "google_project_iam_member" "backend_secrets" {
  project = var.gcp_project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# ─── Secrets ──────────────────────────────────────────────────
resource "google_secret_manager_secret" "database_url" {
  secret_id = "${var.project_prefix}-${var.environment}-database-url"
  project   = var.gcp_project_id

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = var.database_url
}

resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "${var.project_prefix}-${var.environment}-jwt-secret"
  project   = var.gcp_project_id

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.jwt_secret.id
  secret_data = var.jwt_secret
}

resource "google_secret_manager_secret" "bank_webhook_secret" {
  secret_id = "${var.project_prefix}-${var.environment}-bank-webhook-secret"
  project   = var.gcp_project_id

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_version" "bank_webhook_secret" {
  secret      = google_secret_manager_secret.bank_webhook_secret.id
  secret_data = var.bank_webhook_secret
}

resource "google_secret_manager_secret" "platform_signing_key" {
  secret_id = "${var.project_prefix}-${var.environment}-platform-signing-key"
  project   = var.gcp_project_id

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_version" "platform_signing_key" {
  secret      = google_secret_manager_secret.platform_signing_key.id
  secret_data = var.platform_signing_key
}

# ─── Cloud Run Service ────────────────────────────────────────
resource "google_cloud_run_v2_service" "backend" {
  name     = "${var.project_prefix}-backend-${var.environment}"
  location = var.region
  project  = var.gcp_project_id

  template {
    service_account = google_service_account.backend.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.backend_image

      ports {
        container_port = 3001
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = var.environment != "production"
      }

      startup_probe {
        http_get {
          path = "/api/health"
          port = 3001
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/api/health"
          port = 3001
        }
        period_seconds    = 30
        failure_threshold = 3
      }

      # ─── Environment Variables ──────────────────────────
      env {
        name  = "NODE_ENV"
        value = var.environment == "production" ? "production" : "development"
      }

      env {
        name  = "BACKEND_PORT"
        value = "3001"
      }

      env {
        name  = "REDIS_HOST"
        value = var.redis_host
      }

      env {
        name  = "REDIS_PORT"
        value = tostring(var.redis_port)
      }

      env {
        name  = "WEBAUTHN_ORIGIN"
        value = var.webauthn_origin
      }

      env {
        name  = "WEBAUTHN_RP_ID"
        value = var.webauthn_rp_id
      }

      env {
        name  = "WEBAUTHN_RP_NAME"
        value = var.webauthn_rp_name
      }

      env {
        name  = "SETTLEMENT_RAIL"
        value = var.settlement_rail
      }

      env {
        name  = "UPLOAD_DIR"
        value = "/tmp/uploads"
      }

      env {
        name  = "EVIDENCE_BUCKET"
        value = var.evidence_bucket_name
      }

      env {
        name  = "ANCHOR_PROVIDER"
        value = var.anchor_provider
      }

      env {
        name  = "REKOR_URL"
        value = var.rekor_url
      }

      env {
        name  = "ESCROW_CONFIRM_DELAY_MS"
        value = var.escrow_confirm_delay_ms
      }

      env {
        name  = "RECONCILIATION_INTERVAL_MINUTES"
        value = var.reconciliation_interval_minutes
      }

      env {
        name  = "INTEGRITY_CHECK_INTERVAL_MINUTES"
        value = var.integrity_check_interval_minutes
      }

      # ─── Secrets (from Secret Manager) ──────────────────
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "BANK_WEBHOOK_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.bank_webhook_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "PLATFORM_SIGNING_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.platform_signing_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_project_iam_member.backend_sql,
    google_project_iam_member.backend_storage,
    google_project_iam_member.backend_secrets,
  ]
}

# Allow public access (API is auth-protected at app level)
resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  name     = google_cloud_run_v2_service.backend.name
  location = var.region
  project  = var.gcp_project_id
  role     = "roles/run.invoker"
  member   = "allUsers"
}
