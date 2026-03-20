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

variable "subnet_cidr" {
  type    = string
  default = "10.0.0.0/20"
}

variable "connector_cidr" {
  description = "CIDR for VPC Access Connector (/28 required)"
  type        = string
  default     = "10.8.0.0/28"
}

variable "connector_machine_type" {
  type    = string
  default = "e2-micro"
}
