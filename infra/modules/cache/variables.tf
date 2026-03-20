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

variable "memory_size_gb" {
  type    = number
  default = 1
}

variable "high_availability" {
  type    = bool
  default = false
}
