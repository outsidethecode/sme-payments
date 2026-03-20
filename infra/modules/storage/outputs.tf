output "bucket_name" {
  value = google_storage_bucket.evidence.name
}

output "bucket_url" {
  value = google_storage_bucket.evidence.url
}
