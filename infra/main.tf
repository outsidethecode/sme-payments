# ─── Enable Required APIs ─────────────────────────────────────
locals {
  required_apis = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "vpcaccess.googleapis.com",
    "servicenetworking.googleapis.com",
    "compute.googleapis.com",
    "monitoring.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.required_apis)
  project            = var.gcp_project_id
  service            = each.value
  disable_on_destroy = false
}

# ─── Networking ───────────────────────────────────────────────
module "networking" {
  source = "./modules/networking"

  project_prefix = var.project_prefix
  environment    = var.environment
  gcp_project_id = var.gcp_project_id
  region         = var.region

  depends_on = [google_project_service.apis]
}

# ─── Database (Cloud SQL PostgreSQL 15) ───────────────────────
module "database" {
  source = "./modules/database"

  project_prefix              = var.project_prefix
  environment                 = var.environment
  gcp_project_id              = var.gcp_project_id
  region                      = var.region
  network_id                  = module.networking.network_id
  private_services_connection = module.networking.private_services_connection
  tier                        = var.db_tier
  high_availability           = var.db_high_availability
  db_password                 = var.db_password

  depends_on = [google_project_service.apis]
}

# ─── Cache (Memorystore Redis 7) ─────────────────────────────
module "cache" {
  source = "./modules/cache"

  project_prefix    = var.project_prefix
  environment       = var.environment
  gcp_project_id    = var.gcp_project_id
  region            = var.region
  network_id        = module.networking.network_id
  memory_size_gb    = var.redis_memory_gb
  high_availability = var.redis_high_availability

  depends_on = [google_project_service.apis]
}

# ─── Storage (Evidence Bucket) ────────────────────────────────
module "storage" {
  source = "./modules/storage"

  project_prefix = var.project_prefix
  environment    = var.environment
  gcp_project_id = var.gcp_project_id
  region         = var.region

  depends_on = [google_project_service.apis]
}

# ─── Backend (Cloud Run — NestJS) ─────────────────────────────
module "backend" {
  source = "./modules/backend-service"

  project_prefix       = var.project_prefix
  environment          = var.environment
  gcp_project_id       = var.gcp_project_id
  region               = var.region
  vpc_connector_id     = module.networking.vpc_connector_id
  database_url         = module.database.database_url
  redis_host           = module.cache.host
  redis_port           = module.cache.port
  jwt_secret           = var.jwt_secret
  bank_webhook_secret  = var.bank_webhook_secret
  platform_signing_key = var.platform_signing_key
  settlement_rail      = var.settlement_rail
  evidence_bucket_name = module.storage.bucket_name
  cpu                  = var.backend_cpu
  memory               = var.backend_memory
  min_instances        = var.backend_min_instances
  max_instances        = var.backend_max_instances

  webauthn_origin  = var.webauthn_origin
  webauthn_rp_id   = var.webauthn_rp_id
  webauthn_rp_name = var.webauthn_rp_name

  depends_on = [google_project_service.apis]
}

# ─── Frontend (Cloud Run — Next.js) ──────────────────────────
module "frontend" {
  source = "./modules/frontend-service"

  project_prefix      = var.project_prefix
  environment         = var.environment
  gcp_project_id      = var.gcp_project_id
  region              = var.region
  backend_service_url = module.backend.service_url
  cpu                 = var.frontend_cpu
  memory              = var.frontend_memory
  min_instances       = var.frontend_min_instances
  max_instances       = var.frontend_max_instances

  depends_on = [google_project_service.apis]
}

# ─── Monitoring ───────────────────────────────────────────────
module "monitoring" {
  source = "./modules/monitoring"

  project_prefix         = var.project_prefix
  environment            = var.environment
  gcp_project_id         = var.gcp_project_id
  alert_email            = var.alert_email
  backend_service_name   = module.backend.service_name
  database_instance_name = module.database.instance_name

  depends_on = [google_project_service.apis]
}
