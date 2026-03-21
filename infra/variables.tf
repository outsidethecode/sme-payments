# ─── Root Variables ────────────────────────────────────────────

variable "gcp_project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region (me-central2 = Dammam, KSA)"
  type        = string
  default     = "me-central2"
}

variable "environment" {
  description = "Environment name: pilot | production"
  type        = string
  validation {
    condition     = contains(["pilot", "production"], var.environment)
    error_message = "Environment must be 'pilot' or 'production'."
  }
}

variable "project_prefix" {
  description = "Prefix for all resource names"
  type        = string
  default     = "taysiro"
}

# ─── Database ─────────────────────────────────────────────────
variable "db_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
}

variable "db_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "db_high_availability" {
  type    = bool
  default = false
}

# ─── Cache ────────────────────────────────────────────────────
variable "redis_memory_gb" {
  type    = number
  default = 1
}

variable "redis_high_availability" {
  type    = bool
  default = false
}

# ─── Backend Service ─────────────────────────────────────────
variable "backend_cpu" {
  type    = string
  default = "1"
}

variable "backend_memory" {
  type    = string
  default = "512Mi"
}

variable "backend_min_instances" {
  description = "1 = keep alive for @nestjs/schedule crons"
  type        = number
  default     = 1
}

variable "backend_max_instances" {
  type    = number
  default = 5
}

# ─── Frontend Service ────────────────────────────────────────
variable "frontend_cpu" {
  type    = string
  default = "1"
}

variable "frontend_memory" {
  type    = string
  default = "256Mi"
}

variable "frontend_min_instances" {
  description = "0 = scale to zero (saves cost)"
  type        = number
  default     = 0
}

variable "frontend_max_instances" {
  type    = number
  default = 3
}

# ─── Secrets (pass via TF_VAR_ or .tfvars) ───────────────────
variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "bank_webhook_secret" {
  type      = string
  sensitive = true
}

variable "platform_signing_key" {
  type      = string
  sensitive = true
}

# ─── App Config ───────────────────────────────────────────────
variable "settlement_rail" {
  type    = string
  default = "SIMULATED"
}

variable "alert_email" {
  description = "Email for monitoring alerts"
  type        = string
}
variable "webauthn_origin" {
  description = "Frontend origin URL for CORS and WebAuthn (e.g. https://taysiro-frontend-pilot-xxx.run.app)"
  type        = string
}

variable "webauthn_rp_id" {
  description = "WebAuthn Relying Party ID — the frontend hostname (no protocol)"
  type        = string
}

variable "webauthn_rp_name" {
  description = "WebAuthn Relying Party display name"
  type        = string
  default     = "Taysiro"
}