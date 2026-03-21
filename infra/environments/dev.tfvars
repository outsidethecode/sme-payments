# ─── Dev Environment (GCP Doha, Qatar — nearest to KSA) ─────
gcp_project_id = "taysiro-dev"
environment    = "pilot"
region         = "me-central1"
project_prefix = "taysiro"

# ── Database
db_tier              = "db-f1-micro"
db_high_availability = false

# ── Cache
redis_memory_gb         = 1
redis_high_availability = false

# ── Backend (min 1 for cron jobs)
backend_cpu           = "1"
backend_memory        = "512Mi"
backend_min_instances = 1
backend_max_instances = 3

# ── Frontend (scale to zero)
frontend_cpu           = "1"
frontend_memory        = "256Mi"
frontend_min_instances = 0
frontend_max_instances = 2

# ── App
settlement_rail = "SIMULATED"
alert_email     = "apps@taysiro.com"
webauthn_origin = "https://taysiro-frontend-pilot-795382313267.me-central1.run.app"
webauthn_rp_id  = "taysiro-frontend-pilot-795382313267.me-central1.run.app"