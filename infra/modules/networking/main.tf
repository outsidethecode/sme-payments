# ─── Networking Module ─────────────────────────────────────────
# VPC + subnet + VPC Access Connector (for Cloud Run → Cloud SQL/Redis)

resource "google_compute_network" "main" {
  name                    = "${var.project_prefix}-${var.environment}-vpc"
  auto_create_subnetworks = false
  project                 = var.gcp_project_id
}

resource "google_compute_subnetwork" "main" {
  name          = "${var.project_prefix}-${var.environment}-subnet"
  ip_cidr_range = var.subnet_cidr
  region        = var.region
  network       = google_compute_network.main.id
  project       = var.gcp_project_id

  private_ip_google_access = true
}

# VPC Connector — allows Cloud Run to reach Cloud SQL + Memorystore
resource "google_vpc_access_connector" "main" {
  name          = "${var.project_prefix}-${var.environment}-conn"
  region        = var.region
  project       = var.gcp_project_id
  network       = google_compute_network.main.name
  ip_cidr_range = var.connector_cidr
  machine_type  = var.connector_machine_type

  min_instances = 2
  max_instances = var.environment == "production" ? 10 : 3
}

# Allow internal traffic (Cloud SQL, Redis)
resource "google_compute_firewall" "allow_internal" {
  name    = "${var.project_prefix}-${var.environment}-allow-internal"
  network = google_compute_network.main.name
  project = var.gcp_project_id

  allow {
    protocol = "tcp"
    ports    = ["5432", "6379"]
  }

  source_ranges = [var.subnet_cidr, var.connector_cidr]
}

# Reserve IP range for Cloud SQL private access
resource "google_compute_global_address" "private_services" {
  name          = "${var.project_prefix}-${var.environment}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
  project       = var.gcp_project_id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}
