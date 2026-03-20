# ─── Pilot Environment ─────────────────────────────────────────
# Small but reliable (~$150-200/month)
# Single AZ for most resources, smallest viable instances
#
# Deploy: terraform apply -var-file=environments/pilot.tfvars

environment = "pilot"
aws_region  = "me-south-1" # Bahrain (closest to KSA)

# ── Networking ───────────────────────────────────────────────
az_count          = 2
nat_gateway_count = 1 # Single NAT to save cost

# ── Database ─────────────────────────────────────────────────
rds_instance_class    = "db.t4g.micro"  # 2 vCPU, 1 GB RAM — ~$15/mo
rds_allocated_storage = 20              # 20 GB gp3
rds_multi_az          = false           # Single AZ for pilot

# ── Cache ────────────────────────────────────────────────────
redis_node_type    = "cache.t4g.micro" # ~$13/mo
redis_num_replicas = 0                 # No replicas for pilot

# ── Backend ──────────────────────────────────────────────────
backend_cpu           = 512   # 0.5 vCPU
backend_memory        = 1024  # 1 GB
backend_desired_count = 1
backend_min_count     = 1
backend_max_count     = 2

# ── Frontend ─────────────────────────────────────────────────
frontend_cpu           = 256  # 0.25 vCPU
frontend_memory        = 512  # 0.5 GB
frontend_desired_count = 1
frontend_min_count     = 1
frontend_max_count     = 2

# ── Application ──────────────────────────────────────────────
settlement_rail = "SIMULATED" # No real bank for pilot
anchor_provider = "noop"      # No Sigstore for pilot
certificate_arn = ""          # HTTP only (no custom domain)

# ── CI/CD ────────────────────────────────────────────────────
create_github_oidc = true
# github_repo      = "your-org/sme-payments"  # Uncomment and set

# ── Notifications ────────────────────────────────────────────
# alert_email = "your-email@example.com"       # Uncomment and set

# ──────────────────────────────────────────────────────────────
# SECRETS — pass via CLI or terraform.tfvars.secret (gitignored):
#
#   terraform apply -var-file=environments/pilot.tfvars \
#     -var="db_password=YOUR_SECURE_PASSWORD" \
#     -var="jwt_secret=YOUR_JWT_SECRET" \
#     -var="platform_signing_key=YOUR_BASE64_KEY" \
#     -var="bank_webhook_secret=YOUR_WEBHOOK_SECRET"
#
# Or create: environments/pilot.secret.tfvars (DO NOT COMMIT)
# ──────────────────────────────────────────────────────────────
