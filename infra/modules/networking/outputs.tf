output "network_name" {
  value = google_compute_network.main.name
}

output "network_id" {
  value = google_compute_network.main.id
}

output "subnet_name" {
  value = google_compute_subnetwork.main.name
}

output "vpc_connector_id" {
  value = google_vpc_access_connector.main.id
}

output "private_services_connection" {
  value = google_service_networking_connection.private_services
}
