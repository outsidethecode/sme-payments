output "instance_name" {
  value = google_sql_database_instance.main.name
}

output "connection_name" {
  description = "Cloud SQL connection name (project:region:instance)"
  value       = google_sql_database_instance.main.connection_name
}

output "private_ip" {
  value = google_sql_database_instance.main.private_ip_address
}

output "database_url" {
  description = "Prisma-compatible connection string"
  value       = "postgresql://${var.db_username}:${var.db_password}@${google_sql_database_instance.main.private_ip_address}:5432/${var.db_name}?connection_limit=20"
  sensitive   = true
}
