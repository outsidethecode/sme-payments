output "service_url" {
  description = "Public URL of the backend Cloud Run service"
  value       = google_cloud_run_v2_service.backend.uri
}

output "service_name" {
  value = google_cloud_run_v2_service.backend.name
}

output "service_account_email" {
  value = google_service_account.backend.email
}

output "artifact_registry_repo" {
  description = "Full Artifact Registry repository path for docker push"
  value       = "${var.region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.backend.repository_id}"
}
