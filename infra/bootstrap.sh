#!/usr/bin/env bash
# ─── Bootstrap Script ──────────────────────────────────────────
# Run this ONCE before your first terraform apply.
# It verifies prerequisites and helps you configure AWS CLI.
#
# Usage: ./infra/bootstrap.sh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   SME Payments — AWS Bootstrap                         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Check Prerequisites ────────────────────────────────────────

check_command() {
  if command -v "$1" &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} $1 found: $(command -v "$1")"
    return 0
  else
    echo -e "  ${RED}✗${NC} $1 not found"
    return 1
  fi
}

echo -e "${YELLOW}Checking prerequisites...${NC}"
MISSING=0

check_command "aws" || MISSING=1
check_command "terraform" || MISSING=1
check_command "docker" || MISSING=1
check_command "node" || MISSING=1

echo ""

if [ "$MISSING" -eq 1 ]; then
  echo -e "${RED}Missing prerequisites. Install them first:${NC}"
  echo ""
  echo "  brew install awscli        # AWS CLI"
  echo "  brew install terraform     # Terraform"
  echo "  brew install --cask docker # Docker Desktop"
  echo "  brew install node          # Node.js (if not installed)"
  echo ""
  exit 1
fi

# ── Check AWS CLI Configuration ────────────────────────────────

echo -e "${YELLOW}Checking AWS CLI configuration...${NC}"
if aws sts get-caller-identity &> /dev/null; then
  ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
  USER_ARN=$(aws sts get-caller-identity --query 'Arn' --output text)
  echo -e "  ${GREEN}✓${NC} AWS CLI configured"
  echo -e "  Account: ${BLUE}${ACCOUNT_ID}${NC}"
  echo -e "  User:    ${BLUE}${USER_ARN}${NC}"
else
  echo -e "  ${RED}✗${NC} AWS CLI not configured"
  echo ""
  echo -e "${YELLOW}Let's set it up. You'll need:${NC}"
  echo "  1. AWS Access Key ID"
  echo "  2. AWS Secret Access Key"
  echo "  3. Region: me-south-1 (Bahrain)"
  echo ""
  echo "To get access keys:"
  echo "  → AWS Console → IAM → Users → Your User → Security Credentials → Create Access Key"
  echo ""
  read -p "Run 'aws configure' now? (y/n) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    aws configure
    echo ""
    if aws sts get-caller-identity &> /dev/null; then
      ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
      echo -e "  ${GREEN}✓${NC} AWS CLI configured successfully (Account: ${ACCOUNT_ID})"
    else
      echo -e "  ${RED}✗${NC} Configuration failed. Please check your credentials."
      exit 1
    fi
  else
    echo "Run 'aws configure' manually, then re-run this script."
    exit 1
  fi
fi
echo ""

# ── Check Bahrain Region Opt-In ────────────────────────────────

echo -e "${YELLOW}Checking me-south-1 (Bahrain) region access...${NC}"
if aws ec2 describe-availability-zones --region me-south-1 &> /dev/null; then
  echo -e "  ${GREEN}✓${NC} me-south-1 region is enabled"
else
  echo -e "  ${RED}✗${NC} me-south-1 region is NOT enabled"
  echo ""
  echo "  The Bahrain region must be opted-in manually:"
  echo "  → AWS Console → Account Settings → Regions → me-south-1 → Enable"
  echo "  (Takes a few minutes to activate)"
  echo ""
  read -p "Continue with a different region? (y/n) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi
echo ""

# ── Generate Secrets ───────────────────────────────────────────

SECRET_FILE="infra/environments/pilot.secret.tfvars"

if [ -f "$SECRET_FILE" ]; then
  echo -e "${GREEN}✓${NC} Secret file already exists: ${SECRET_FILE}"
else
  echo -e "${YELLOW}Generating secrets file...${NC}"

  # Generate random JWT secret
  JWT_SECRET=$(openssl rand -hex 32)

  # Generate ECDSA P-256 key pair for platform signing
  TEMP_KEY=$(mktemp)
  openssl ecparam -genkey -name prime256v1 -noout -out "$TEMP_KEY" 2>/dev/null
  PLATFORM_KEY=$(openssl pkcs8 -topk8 -nocrypt -in "$TEMP_KEY" -outform DER | base64)
  rm -f "$TEMP_KEY"

  # Generate random DB password
  DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')

  # Generate webhook secret
  WEBHOOK_SECRET=$(openssl rand -hex 16)

  cat > "$SECRET_FILE" << EOF
# ─── SECRETS (auto-generated) ──────────────────────────────────
# DO NOT COMMIT THIS FILE
# Regenerate with: ./infra/bootstrap.sh

db_password          = "${DB_PASSWORD}"
jwt_secret           = "${JWT_SECRET}"
platform_signing_key = "${PLATFORM_KEY}"
bank_webhook_secret  = "${WEBHOOK_SECRET}"
EOF

  echo -e "  ${GREEN}✓${NC} Created ${SECRET_FILE}"
  echo -e "  ${YELLOW}⚠${NC}  This file contains sensitive values — DO NOT commit to git"
fi
echo ""

# ── Add to .gitignore ──────────────────────────────────────────

if ! grep -q "*.secret.tfvars" .gitignore 2>/dev/null; then
  echo "" >> .gitignore
  echo "# Terraform secrets" >> .gitignore
  echo "*.secret.tfvars" >> .gitignore
  echo ".terraform/" >> .gitignore
  echo "*.tfstate*" >> .gitignore
  echo -e "  ${GREEN}✓${NC} Added Terraform patterns to .gitignore"
fi

# ── Initialize Terraform ───────────────────────────────────────

echo -e "${YELLOW}Initializing Terraform...${NC}"
cd infra
terraform init
echo -e "  ${GREEN}✓${NC} Terraform initialized"
echo ""

# ── Summary ────────────────────────────────────────────────────

echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Bootstrap complete!                                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Next steps:"
echo ""
echo -e "  ${BLUE}1.${NC} Review the pilot config:"
echo -e "     ${YELLOW}cat infra/environments/pilot.tfvars${NC}"
echo ""
echo -e "  ${BLUE}2.${NC} Preview what will be created:"
echo -e "     ${YELLOW}cd infra && terraform plan -var-file=environments/pilot.tfvars -var-file=environments/pilot.secret.tfvars${NC}"
echo ""
echo -e "  ${BLUE}3.${NC} Deploy everything:"
echo -e "     ${YELLOW}./infra/deploy.sh pilot${NC}"
echo ""
echo -e "  Estimated time: ~10-15 minutes for first deploy"
echo -e "  Estimated cost: ~\$150-200/month"
echo ""
