# ─── GCP Provider ─────────────────────────────────────────────
# Dammam, KSA (me-central2) — full data residency in Saudi Arabia

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Remote state — uncomment after bootstrap creates the bucket
  # backend "gcs" {
  #   bucket = "taysiro-tfstate-<PROJECT_ID>"
  #   prefix = "terraform/state"
  # }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.region
}
