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

variable "vpc_connector_id" {
  type = string
}

# Container config
variable "backend_image" {
  description = "Full image URI (e.g. me-central2-docker.pkg.dev/project/repo/backend:latest)"
  type        = string
  default     = "gcr.io/cloudrun/placeholder" # replaced by CI/CD
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "min_instances" {
  description = "Min instances — 1 keeps @nestjs/schedule crons running"
  type        = number
  default     = 1
}

variable "max_instances" {
  type    = number
  default = 5
}

# Database
variable "database_url" {
  type      = string
  sensitive = true
}

# Redis
variable "redis_host" {
  type = string
}

variable "redis_port" {
  type    = number
  default = 6379
}

# Auth
variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "webauthn_origin" {
  description = "Origin for passkey verification (e.g. https://sme-frontend-xxx.run.app)"
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

# Bank / Crypto
variable "bank_webhook_secret" {
  type      = string
  sensitive = true
}

variable "platform_signing_key" {
  type      = string
  sensitive = true
}

variable "settlement_rail" {
  type    = string
  default = "SIMULATED"
}

# Storage
variable "evidence_bucket_name" {
  type = string
}

# Transparency
variable "anchor_provider" {
  type    = string
  default = "IN_TOTO"
}

variable "rekor_url" {
  type    = string
  default = "https://rekor.sigstore.dev"
}

# Timing
variable "escrow_confirm_delay_ms" {
  type    = string
  default = "5000"
}

variable "reconciliation_interval_minutes" {
  type    = string
  default = "30"
}

variable "integrity_check_interval_minutes" {
  type    = string
  default = "60"
}
