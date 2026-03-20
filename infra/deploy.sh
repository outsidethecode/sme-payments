#!/usr/bin/env bash
# ─── Deploy Script ─────────────────────────────────────────────
# One-command deploy: infrastructure + Docker images + ECS services
#
# Usage:
#   ./infra/deploy.sh pilot          # Deploy pilot environment
#   ./infra/deploy.sh production     # Deploy production environment
#   ./infra/deploy.sh pilot --infra-only  # Only Terraform (no Docker build)
#   ./infra/deploy.sh pilot --app-only    # Only Docker build + push (no Terraform)
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
MODE="${2:-full}" # full | --infra-only | --app-only

if [ -z "$ENV" ] || [[ ! "$ENV" =~ ^(pilot|production)$ ]]; then
  echo -e "${RED}Usage: $0 <pilot|production> [--infra-only|--app-only]${NC}"
  exit 1
fi

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   SME Payments — Deploy: ${ENV}$(printf '%*s' $((27 - ${#ENV})) '')║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

TFVARS_FILE="environments/${ENV}.tfvars"
SECRET_FILE="environments/${ENV}.secret.tfvars"

# ── Verify Prerequisites ─────────────────────────────────────

aws sts get-caller-identity > /dev/null 2>&1 || {
  echo -e "${RED}AWS CLI not configured. Run ./infra/bootstrap.sh first.${NC}"
  exit 1
}

ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
REGION=$(grep 'aws_region' "$SCRIPT_DIR/$TFVARS_FILE" | head -1 | awk -F'"' '{print $2}')
REGION="${REGION:-me-south-1}"

echo -e "Account:     ${BLUE}${ACCOUNT_ID}${NC}"
echo -e "Region:      ${BLUE}${REGION}${NC}"
echo -e "Environment: ${BLUE}${ENV}${NC}"
echo ""

# ── Step 1: Terraform Apply ──────────────────────────────────

if [[ "$MODE" != "--app-only" ]]; then
  echo -e "${YELLOW}━━━ Step 1: Terraform Apply ━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  cd "$SCRIPT_DIR"

  # Check if secret tfvars exists
  if [ ! -f "$SECRET_FILE" ]; then
    echo -e "${RED}Missing secret file: $SECRET_FILE${NC}"
    echo "Run ./infra/bootstrap.sh to generate it."
    exit 1
  fi

  # Init (in case first run)
  terraform init -upgrade -input=false

  # Plan
  echo -e "${YELLOW}Planning infrastructure changes...${NC}"
  terraform plan \
    -var-file="$TFVARS_FILE" \
    -var-file="$SECRET_FILE" \
    -out=tfplan

  # Apply
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

  # Get ECR registry
  ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

  # Login to ECR
  echo "Logging in to ECR..."
  aws ecr get-login-password --region "$REGION" | \
    docker login --username AWS --password-stdin "$ECR_REGISTRY"

  # Get ALB DNS for frontend build arg
  ALB_DNS=$(cd "$SCRIPT_DIR" && terraform output -raw alb_url 2>/dev/null || echo "http://localhost")
  API_URL="${ALB_DNS}/api"
  echo -e "API URL: ${BLUE}${API_URL}${NC}"
  echo ""

  # Build backend
  echo -e "${YELLOW}Building backend image...${NC}"
  docker build \
    -t "$ECR_REGISTRY/sme-payments-backend:latest" \
    -t "$ECR_REGISTRY/sme-payments-backend:$(git rev-parse --short HEAD)" \
    "$PROJECT_ROOT/backend"

  echo "Pushing backend image..."
  docker push "$ECR_REGISTRY/sme-payments-backend:latest"
  docker push "$ECR_REGISTRY/sme-payments-backend:$(git rev-parse --short HEAD)"
  echo -e "${GREEN}✓ Backend image pushed${NC}"
  echo ""

  # Build frontend
  echo -e "${YELLOW}Building frontend image...${NC}"
  docker build \
    --build-arg "NEXT_PUBLIC_API_URL=${API_URL}" \
    -t "$ECR_REGISTRY/sme-payments-frontend:latest" \
    -t "$ECR_REGISTRY/sme-payments-frontend:$(git rev-parse --short HEAD)" \
    "$PROJECT_ROOT/frontend"

  echo "Pushing frontend image..."
  docker push "$ECR_REGISTRY/sme-payments-frontend:latest"
  docker push "$ECR_REGISTRY/sme-payments-frontend:$(git rev-parse --short HEAD)"
  echo -e "${GREEN}✓ Frontend image pushed${NC}"
  echo ""

  # ── Step 3: Run Prisma Migrations ────────────────────────────

  echo -e "${YELLOW}━━━ Step 3: Database Migrations ━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  ECS_CLUSTER="sme-payments-${ENV}"
  BACKEND_SERVICE="sme-payments-${ENV}-backend"

  # Get network config from the running service
  NETWORK_CONFIG=$(aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$BACKEND_SERVICE" \
    --region "$REGION" \
    --query 'services[0].networkConfiguration' \
    --output json 2>/dev/null || echo "")

  if [ -n "$NETWORK_CONFIG" ] && [ "$NETWORK_CONFIG" != "null" ]; then
    TASK_DEF=$(aws ecs describe-services \
      --cluster "$ECS_CLUSTER" \
      --services "$BACKEND_SERVICE" \
      --region "$REGION" \
      --query 'services[0].taskDefinition' \
      --output text)

    echo "Running Prisma migrations..."
    aws ecs run-task \
      --cluster "$ECS_CLUSTER" \
      --task-definition "$TASK_DEF" \
      --launch-type FARGATE \
      --region "$REGION" \
      --network-configuration "$NETWORK_CONFIG" \
      --overrides '{
        "containerOverrides": [{
          "name": "backend",
          "command": ["npx", "prisma", "migrate", "deploy"]
        }]
      }' \
      --started-by "deploy-script" > /dev/null

    echo "Waiting for migration to complete..."
    sleep 30
    echo -e "${GREEN}✓ Migrations complete${NC}"
  else
    echo -e "${YELLOW}⚠ No running service found — skipping migrations (first deploy)${NC}"
    echo "  Run migrations manually after first deploy:"
    echo "  aws ecs run-task --cluster $ECS_CLUSTER ..."
  fi
  echo ""

  # ── Step 4: Force New Deployment ─────────────────────────────

  echo -e "${YELLOW}━━━ Step 4: Deploy Services ━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  echo "Deploying backend..."
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$BACKEND_SERVICE" \
    --force-new-deployment \
    --region "$REGION" > /dev/null

  FRONTEND_SERVICE="sme-payments-${ENV}-frontend"
  echo "Deploying frontend..."
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$FRONTEND_SERVICE" \
    --force-new-deployment \
    --region "$REGION" > /dev/null

  echo ""
  echo "Waiting for services to stabilize (this may take 2-5 minutes)..."
  aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$BACKEND_SERVICE" "$FRONTEND_SERVICE" \
    --region "$REGION"

  echo -e "${GREEN}✓ All services deployed and healthy${NC}"
  echo ""
fi

# ── Summary ──────────────────────────────────────────────────

echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Deploy complete!                                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

cd "$SCRIPT_DIR"
APP_URL=$(terraform output -raw alb_url 2>/dev/null || echo "pending...")
API_URL=$(terraform output -raw api_url 2>/dev/null || echo "pending...")
SWAGGER=$(terraform output -raw swagger_url 2>/dev/null || echo "pending...")

echo -e "  App:     ${BLUE}${APP_URL}${NC}"
echo -e "  API:     ${BLUE}${API_URL}${NC}"
echo -e "  Swagger: ${BLUE}${SWAGGER}${NC}"
echo ""
