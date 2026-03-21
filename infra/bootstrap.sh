#!/usr/bin/env bash
# ─── GCP Bootstrap Script ─────────────────────────────────────
# Run this ONCE before your first terraform apply.
# Verifies prerequisites, sets up gcloud, generates secrets.
#
# Usage: ./infra/bootstrap.sh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Taysiro — GCP Bootstrap                              ║${NC}"
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

check_command "gcloud" || MISSING=1
check_command "terraform" || MISSING=1
check_command "docker" || MISSING=1
check_command "node" || MISSING=1

echo ""

if [ "$MISSING" -eq 1 ]; then
  echo -e "${RED}Missing prerequisites. Install them first:${NC}"
  echo ""
  echo "  brew install --cask google-cloud-sdk  # gcloud CLI"
  echo "  brew install terraform                # Terraform"
  echo "  brew install --cask docker            # Docker Desktop"
  echo "  brew install node                     # Node.js"
  echo ""
  exit 1
fi

# ── Check gcloud Configuration ─────────────────────────────────

echo -e "${YELLOW}Checking gcloud CLI configuration...${NC}"
if gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 | grep -q "@"; then
  ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
  PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
  echo -e "  ${GREEN}✓${NC} gcloud authenticated"
  echo -e "  Account: ${BLUE}${ACCOUNT}${NC}"
  echo -e "  Project: ${BLUE}${PROJECT:-not set}${NC}"
else
  echo -e "  ${RED}✗${NC} gcloud not authenticated"
  echo ""
  echo -e "${YELLOW}Let's set it up:${NC}"
  echo ""
  read -p "Run 'gcloud auth login' now? (y/n) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    gcloud auth login
    gcloud auth application-default login
    echo ""
  else
    echo "Run 'gcloud auth login' manually, then re-run this script."
    exit 1
  fi
fi

# ── Set / Verify Project ───────────────────────────────────────

PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
if [ -z "$PROJECT" ]; then
  echo ""
  echo -e "${YELLOW}No GCP project selected. Available projects:${NC}"
  gcloud projects list --format="table(projectId,name)"
  echo ""
  read -p "Enter your GCP Project ID: " PROJECT
  gcloud config set project "$PROJECT"
fi

echo -e "  ${GREEN}✓${NC} Using project: ${BLUE}${PROJECT}${NC}"
echo ""

# ── Enable Required APIs ──────────────────────────────────────

echo -e "${YELLOW}Enabling required GCP APIs (this may take a minute)...${NC}"

APIS=(
  "run.googleapis.com"
  "sqladmin.googleapis.com"
  "redis.googleapis.com"
  "secretmanager.googleapis.com"
  "artifactregistry.googleapis.com"
  "vpcaccess.googleapis.com"
  "servicenetworking.googleapis.com"
  "compute.googleapis.com"
  "monitoring.googleapis.com"
  "cloudresourcemanager.googleapis.com"
)

for api in "${APIS[@]}"; do
  gcloud services enable "$api" --quiet 2>/dev/null && \
    echo -e "  ${GREEN}✓${NC} $api" || \
    echo -e "  ${YELLOW}⚠${NC} $api (may already be enabled)"
done
echo ""

# ── Generate Secrets ───────────────────────────────────────────

SECRET_FILE="infra/environments/pilot.secret.tfvars"

if [ -f "$SECRET_FILE" ]; then
  echo -e "${GREEN}✓${NC} Secret file already exists: ${SECRET_FILE}"
else
  echo -e "${YELLOW}Generating secrets file...${NC}"

  JWT_SECRET=$(openssl rand -hex 32)

  TEMP_KEY=$(mktemp)
  openssl ecparam -genkey -name prime256v1 -noout -out "$TEMP_KEY" 2>/dev/null
  PLATFORM_KEY=$(openssl pkcs8 -topk8 -nocrypt -in "$TEMP_KEY" -outform DER | base64)
  rm -f "$TEMP_KEY"

  DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
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

# ── Update pilot.tfvars with project ID ───────────────────────

PILOT_FILE="infra/environments/pilot.tfvars"
if grep -q "REPLACE_WITH_YOUR_PROJECT_ID" "$PILOT_FILE" 2>/dev/null; then
  sed -i '' "s/REPLACE_WITH_YOUR_PROJECT_ID/${PROJECT}/" "$PILOT_FILE"
  echo -e "  ${GREEN}✓${NC} Updated pilot.tfvars with project ID: ${PROJECT}"
fi

# ── Add to .gitignore ──────────────────────────────────────────

if ! grep -q "*.secret.tfvars" .gitignore 2>/dev/null; then
  echo "" >> .gitignore
  echo "# Terraform secrets & state" >> .gitignore
  echo "*.secret.tfvars" >> .gitignore
  echo ".terraform/" >> .gitignore
  echo "*.tfstate*" >> .gitignore
  echo "tfplan" >> .gitignore
  echo -e "  ${GREEN}✓${NC} Added Terraform patterns to .gitignore"
fi

# ── Configure Docker for Artifact Registry ─────────────────────

echo -e "${YELLOW}Configuring Docker for Artifact Registry...${NC}"
gcloud auth configure-docker me-central1-docker.pkg.dev --quiet 2>/dev/null
  echo -e "  ${GREEN}✓${NC} Docker configured for me-central1-docker.pkg.dev"
echo ""

# ── Create Terraform State Bucket ──────────────────────────────

STATE_BUCKET="taysiro-tfstate-${PROJECT}"
echo -e "${YELLOW}Creating Terraform state bucket...${NC}"
if gsutil ls "gs://${STATE_BUCKET}" &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} State bucket already exists: ${STATE_BUCKET}"
else
  gsutil mb -l me-central1 "gs://${STATE_BUCKET}" 2>/dev/null && \
    echo -e "  ${GREEN}✓${NC} Created state bucket: ${STATE_BUCKET}" || \
    echo -e "  ${YELLOW}⚠${NC} Could not create state bucket (create manually)"

  gsutil versioning set on "gs://${STATE_BUCKET}" 2>/dev/null
fi
echo ""

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
echo -e "  GCP Project:  ${BLUE}${PROJECT}${NC}"
echo -e "  Region:       ${BLUE}me-central1 (Doha, Qatar)${NC}"
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
echo -e "  Estimated time: ~8-12 minutes for first deploy"
echo -e "  Estimated cost: ~\$60-80/month (Cloud Run scales to zero)"
echo ""
