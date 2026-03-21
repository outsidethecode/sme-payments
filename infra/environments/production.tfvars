# ─── Production Environment (GCP Dammam, KSA) ─────────────────
# Full HA, regional redundancy (~$250-400/month)
#
# When ready for production:
#   1. Create a new GCP project
#   2. Update gcp_project_id below
#   3. terraform workspace new production
#   4. terraform apply -var-file=environments/production.tfvars \
#                      -var-file=environments/production.secret.tfvars

gcp_project_id = "REPLACE_WITH_PRODUCTION_PROJECT_ID"
environment    = "production"
region         = "me-central2" # Dammam, KSA
project_prefix = "taysiro"

# ── Database (Cloud SQL PostgreSQL 15) ───────────────────────
db_tier              = "db-custom-2-7680" # 2 vCPU, 7.5 GB RAM
db_high_availability = true               # Regional HA with auto-failover

# ── Cache (Memorystore Redis 7) ──────────────────────────────
redis_memory_gb         = 2    # 2 GB Standard HA
redis_high_availability = true # Replica for failover

# ── Backend (Cloud Run — NestJS) ─────────────────────────────
backend_cpu           = "2"     # 2 vCPU
backend_memory        = "1Gi"   # 1 GB
backend_min_instances = 2       # Always-on for HA + crons
backend_max_instances = 10

# ── Frontend (Cloud Run — Next.js) ───────────────────────────
frontend_cpu           = "1"      # 1 vCPU
frontend_memory        = "512Mi"  # 512 MB
frontend_min_instances = 2        # Always-on for production
frontend_max_instances = 5

# ── Application ──────────────────────────────────────────────
settlement_rail = "KSA_BANK" # Real banking rails

# ── Notifications ────────────────────────────────────────────
alert_email = "ops@yourcompany.com"

# ──────────────────────────────────────────────────────────────
# SECRETS — pass via environments/production.secret.tfvars (gitignored)
