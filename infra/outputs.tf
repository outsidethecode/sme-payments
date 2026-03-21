# ─── Outputs ──────────────────────────────────────────────────

output "backend_url" {
  description = "Backend Cloud Run URL"
  value       = module.backend.service_url
}

output "frontend_url" {
  description = "Frontend Cloud Run URL"
  value       = module.frontend.service_url
}

output "backend_image_repo" {
  description = "Push backend Docker images here"
  value       = module.backend.artifact_registry_repo
}

output "frontend_image_repo" {
  description = "Push frontend Docker images here"
  value       = module.frontend.artifact_registry_repo
}

output "database_connection" {
  description = "Cloud SQL connection name (for cloud-sql-proxy)"
  value       = module.database.connection_name
}

output "evidence_bucket" {
  value = module.storage.bucket_name
}

output "redis_host" {
  value = module.cache.host
}
