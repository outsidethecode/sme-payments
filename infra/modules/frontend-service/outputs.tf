output "service_url" {
  description = "Public URL of the frontend Cloud Run service"
  value       = google_cloud_run_v2_service.frontend.uri
}

output "service_name" {
  value = google_cloud_run_v2_service.frontend.name
}

output "artifact_registry_repo" {
  description = "Full Artifact Registry repository path for docker push"
  value       = "${var.region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.frontend.repository_id}"
}
