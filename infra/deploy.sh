#!/usr/bin/env bash
# ─── GCP Deploy Script ────────────────────────────────────────
# One-command deploy: infrastructure + Docker images + Cloud Run
#
# Usage:
#   ./infra/deploy.sh pilot              # Full deploy
#   ./infra/deploy.sh production         # Full deploy (production)
#   ./infra/deploy.sh pilot --infra-only # Only Terraform
#   ./infra/deploy.sh pilot --app-only   # Only Docker build + deploy
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Parse Arguments ───────────────────────────────────────────

ENV="${1:-}"
MODE="${2:-full}"

if [ -z "$ENV" ] || [[ ! "$ENV" =~ ^(pilot|production)$ ]]; then
  echo -e "${RED}Usage: $0 <pilot|production> [--infra-only|--app-only]${NC}"
  exit 1
fi

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Taysiro — Deploy: ${ENV}$(printf '%*s' $((33 - ${#ENV})) '')║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

TFVARS_FILE="environments/${ENV}.tfvars"
SECRET_FILE="environments/${ENV}.secret.tfvars"

# ── Read config ────────────────────────────────────────────────

GCP_PROJECT=$(grep 'gcp_project_id' "$SCRIPT_DIR/$TFVARS_FILE" | head -1 | awk -F'"' '{print $2}')
REGION=$(grep 'region' "$SCRIPT_DIR/$TFVARS_FILE" | head -1 | awk -F'"' '{print $2}')
REGION="${REGION:-me-central2}"
PREFIX=$(grep 'project_prefix' "$SCRIPT_DIR/$TFVARS_FILE" | head -1 | awk -F'"' '{print $2}')
PREFIX="${PREFIX:-taysiro}"

# Verify gcloud auth
gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 | grep -q "@" || {
  echo -e "${RED}gcloud not authenticated. Run ./infra/bootstrap.sh first.${NC}"
  exit 1
}

gcloud config set project "$GCP_PROJECT" --quiet 2>/dev/null

echo -e "Project:     ${BLUE}${GCP_PROJECT}${NC}"
echo -e "Region:      ${BLUE}${REGION}${NC}"
echo -e "Environment: ${BLUE}${ENV}${NC}"
echo ""

GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
BACKEND_REPO="${REGION}-docker.pkg.dev/${GCP_PROJECT}/${PREFIX}-backend"
FRONTEND_REPO="${REGION}-docker.pkg.dev/${GCP_PROJECT}/${PREFIX}-frontend"

# ── Step 1: Terraform Apply ──────────────────────────────────

if [[ "$MODE" != "--app-only" ]]; then
  echo -e "${YELLOW}━━━ Step 1: Terraform Apply ━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  cd "$SCRIPT_DIR"

  if [ ! -f "$SECRET_FILE" ]; then
    echo -e "${RED}Missing secret file: $SECRET_FILE${NC}"
    echo "Run ./infra/bootstrap.sh to generate it."
    exit 1
  fi

  terraform init -upgrade -input=false

  echo -e "${YELLOW}Planning infrastructure changes...${NC}"
  terraform plan \
    -var-file="$TFVARS_FILE" \
    -var-file="$SECRET_FILE" \
    -out=tfplan

  echo ""
  read -p "Apply these changes? (y/n) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    terraform apply tfplan
    rm -f tfplan
    echo -e "${GREEN}✓ Infrastructure deployed${NC}"
  else
    rm -f tfplan
    echo "Cancelled."
    exit 0
  fi

  cd "$PROJECT_ROOT"
  echo ""
fi

# ── Step 2: Build & Push Docker Images ────────────────────────

if [[ "$MODE" != "--infra-only" ]]; then
  echo -e "${YELLOW}━━━ Step 2: Build & Push Docker Images ━━━━━━━━━━━━━━━━━${NC}"

  # Configure Docker for Artifact Registry
  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

  # Get backend URL for frontend build
  BACKEND_URL=$(cd "$SCRIPT_DIR" && terraform output -raw backend_url 2>/dev/null || echo "")
  if [ -z "$BACKEND_URL" ]; then
    echo -e "${YELLOW}⚠ Backend URL not available yet (first deploy)${NC}"
    BACKEND_URL="https://placeholder.run.app"
  fi
  echo -e "Backend URL: ${BLUE}${BACKEND_URL}${NC}"
  echo ""

  # ── Build + push backend ──────────────────────────────────
  echo -e "${YELLOW}Building backend image...${NC}"
  docker build \
    -t "${BACKEND_REPO}/backend:latest" \
    -t "${BACKEND_REPO}/backend:${GIT_SHA}" \
    "$PROJECT_ROOT/backend"

  echo "Pushing backend image..."
  docker push "${BACKEND_REPO}/backend:latest"
  docker push "${BACKEND_REPO}/backend:${GIT_SHA}"
  echo -e "${GREEN}✓ Backend image pushed${NC}"
  echo ""

  # ── Build + push frontend ─────────────────────────────────
  echo -e "${YELLOW}Building frontend image...${NC}"
  docker build \
    --build-arg "NEXT_PUBLIC_API_URL=${BACKEND_URL}" \
    -t "${FRONTEND_REPO}/frontend:latest" \
    -t "${FRONTEND_REPO}/frontend:${GIT_SHA}" \
    "$PROJECT_ROOT/frontend"

  echo "Pushing frontend image..."
  docker push "${FRONTEND_REPO}/frontend:latest"
  docker push "${FRONTEND_REPO}/frontend:${GIT_SHA}"
  echo -e "${GREEN}✓ Frontend image pushed${NC}"
  echo ""

  # ── Step 3: Run Prisma Migrations ────────────────────────────

  echo -e "${YELLOW}━━━ Step 3: Database Migrations ━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  BACKEND_SERVICE="${PREFIX}-backend-${ENV}"

  # Run migrations via Cloud Run Jobs (one-off container)
  echo "Running Prisma migrations..."
  gcloud run jobs execute "${PREFIX}-migrate-${ENV}" \
    --region "$REGION" \
    --wait \
    2>/dev/null && echo -e "${GREEN}✓ Migrations complete${NC}" || {
      echo -e "${YELLOW}⚠ Migration job not found — running via gcloud run jobs create...${NC}"

      DB_URL=$(cd "$SCRIPT_DIR" && terraform output -raw database_connection 2>/dev/null || echo "")
      if [ -n "$DB_URL" ]; then
        echo "  Creating one-off migration job..."
        # On first deploy, run prisma migrate deploy manually:
        echo -e "  ${YELLOW}Run migrations manually:${NC}"
        echo -e "  gcloud run jobs create ${PREFIX}-migrate-${ENV} \\"
        echo -e "    --image ${BACKEND_REPO}/backend:latest \\"
        echo -e "    --region ${REGION} \\"
        echo -e "    --command npx \\"
        echo -e "    --args prisma,migrate,deploy \\"
        echo -e "    --vpc-connector <CONNECTOR_NAME> \\"
        echo -e "    --set-env-vars DATABASE_URL=<URL>"
      fi
    }
  echo ""

  # ── Step 4: Deploy New Revisions ─────────────────────────────

  echo -e "${YELLOW}━━━ Step 4: Deploy New Revisions ━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  echo "Deploying backend..."
  gcloud run services update "$BACKEND_SERVICE" \
    --image "${BACKEND_REPO}/backend:${GIT_SHA}" \
    --region "$REGION" \
    --quiet
  echo -e "${GREEN}✓ Backend deployed${NC}"

  FRONTEND_SERVICE="${PREFIX}-frontend-${ENV}"
  echo "Deploying frontend..."
  gcloud run services update "$FRONTEND_SERVICE" \
    --image "${FRONTEND_REPO}/frontend:${GIT_SHA}" \
    --region "$REGION" \
    --quiet
  echo -e "${GREEN}✓ Frontend deployed${NC}"
  echo ""
fi

# ── Summary ──────────────────────────────────────────────────

echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Deploy complete!                                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

cd "$SCRIPT_DIR"
FRONTEND_URL=$(terraform output -raw frontend_url 2>/dev/null || echo "pending...")
BACKEND_URL=$(terraform output -raw backend_url 2>/dev/null || echo "pending...")

echo -e "  Frontend: ${BLUE}${FRONTEND_URL}${NC}"
echo -e "  Backend:  ${BLUE}${BACKEND_URL}${NC}"
echo -e "  API:      ${BLUE}${BACKEND_URL}/api${NC}"
echo ""
