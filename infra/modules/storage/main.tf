# ─── Storage Module ────────────────────────────────────────────
# Cloud Storage bucket for evidence attachments

resource "google_storage_bucket" "evidence" {
  name     = "${var.project_prefix}-evidence-${var.environment}-${var.gcp_project_id}"
  location = var.region
  project  = var.gcp_project_id

  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  force_destroy               = var.environment != "production"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type          = "SetStorageClass"
      storage_class = "COLDLINE"
    }
  }

  # Financial records — never expire

  labels = {
    environment = var.environment
    project     = var.project_prefix
  }
}
