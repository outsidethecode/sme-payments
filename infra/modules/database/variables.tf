variable "project_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "gcp_project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "network_id" {
  type = string
}

variable "private_services_connection" {
  description = "Dependency on private services connection"
}

variable "tier" {
  description = "Cloud SQL machine type (db-f1-micro, db-g1-small, db-custom-N-M)"
  type        = string
  default     = "db-f1-micro"
}

variable "disk_size_gb" {
  type    = number
  default = 10
}

variable "high_availability" {
  type    = bool
  default = false
}

variable "backup_retention_count" {
  type    = number
  default = 7
}

variable "db_name" {
  type    = string
  default = "taysiro"
}

variable "db_username" {
  type    = string
  default = "taysiro_user"
}

variable "db_password" {
  type      = string
  sensitive = true
}
