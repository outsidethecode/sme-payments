# ─── Production Environment ────────────────────────────────────
# Full HA, Multi-AZ, larger instances (~$800-1000/month)
#
# When ready to go to production:
#   1. Copy this file
#   2. Update secrets
#   3. terraform workspace new production
#   4. terraform apply -var-file=environments/production.tfvars

environment = "production"
aws_region  = "me-south-1"

# ── Networking ───────────────────────────────────────────────
az_count          = 2
nat_gateway_count = 2 # HA: one NAT per AZ

# ── Database ─────────────────────────────────────────────────
rds_instance_class    = "db.r6g.large"  # 2 vCPU, 16 GB RAM
rds_allocated_storage = 100             # 100 GB gp3
rds_multi_az          = true            # Automatic failover

# ── Cache ────────────────────────────────────────────────────
redis_node_type    = "cache.r6g.large"
redis_num_replicas = 1                  # 1 replica for failover

# ── Backend ──────────────────────────────────────────────────
backend_cpu           = 1024  # 1 vCPU
backend_memory        = 2048  # 2 GB
backend_desired_count = 2
backend_min_count     = 2
backend_max_count     = 8

# ── Frontend ─────────────────────────────────────────────────
frontend_cpu           = 512
frontend_memory        = 1024
frontend_desired_count = 2
frontend_min_count     = 2
frontend_max_count     = 4

# ── Application ──────────────────────────────────────────────
settlement_rail = "KSA_BANK"   # Real banking rails
anchor_provider = "rekor"      # Sigstore anchoring enabled
# certificate_arn = "arn:aws:acm:me-south-1:ACCOUNT:certificate/CERT-ID"

# ── CI/CD ────────────────────────────────────────────────────
create_github_oidc = true
# github_repo      = "your-org/sme-payments"

# ── Notifications ────────────────────────────────────────────
# alert_email = "ops@yourcompany.com"

# ──────────────────────────────────────────────────────────────
# SECRETS — same pattern as pilot, use separate secret values
# ──────────────────────────────────────────────────────────────
