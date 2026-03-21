# ─── Pilot Environment (GCP Dammam, KSA) ─────────────────────
# Small but reliable (~$60-80/month with scale-to-zero)
# Cloud Run + Cloud SQL + Memorystore in me-central1
#
# Deploy: terraform apply -var-file=environments/pilot.tfvars

gcp_project_id = "taysiro-dev"
environment    = "pilot"
region         = "me-central1" # Doha, Qatar — nearest to KSA (switch to me-central2 Dammam for prod)
project_prefix = "taysiro"

# ── Database (Cloud SQL PostgreSQL 15) ───────────────────────
db_tier              = "db-f1-micro" # Shared-core, ~$8/mo
db_high_availability = false         # Single zone for pilot

# ── Cache (Memorystore Redis 7) ──────────────────────────────
redis_memory_gb         = 1     # 1 GB Basic tier, ~$35/mo
redis_high_availability = false # No replica for pilot

# ── Backend (Cloud Run — NestJS) ─────────────────────────────
backend_cpu           = "1"      # 1 vCPU
backend_memory        = "512Mi"  # 512 MB
backend_min_instances = 1        # Keep alive for @nestjs/schedule crons
backend_max_instances = 3

# ── Frontend (Cloud Run — Next.js) ───────────────────────────
frontend_cpu           = "1"      # 1 vCPU
frontend_memory        = "256Mi"  # 256 MB
frontend_min_instances = 0        # Scale to zero (saves ~$15/mo)
frontend_max_instances = 2

# ── Application ──────────────────────────────────────────────
settlement_rail = "SIMULATED" # No real bank for pilot

# ── Notifications ────────────────────────────────────────────
alert_email = "your-email@example.com" # Replace with your email

# ──────────────────────────────────────────────────────────────
# SECRETS — pass via environments/pilot.secret.tfvars (gitignored):
#   db_password
#   jwt_secret
#   platform_signing_key
#   bank_webhook_secret
