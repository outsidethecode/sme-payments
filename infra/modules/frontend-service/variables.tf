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

variable "frontend_image" {
  description = "Full image URI for frontend"
  type        = string
  default     = "gcr.io/cloudrun/placeholder"
}

variable "backend_service_url" {
  description = "Backend Cloud Run URL (NEXT_PUBLIC_API_URL)"
  type        = string
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "256Mi"
}

variable "min_instances" {
  description = "0 = scale to zero (saves cost for pilot)"
  type        = number
  default     = 0
}

variable "max_instances" {
  type    = number
  default = 3
}
