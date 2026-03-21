# Taysiro — GCP Deployment Guide

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  GCP — me-central1 (Doha, Qatar)                               │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐                          │
│  │  Cloud Run   │    │  Cloud Run   │                          │
│  │  (Frontend)  │───▶│  (Backend)   │                          │
│  │  Next.js SSR │    │  NestJS API  │                          │
│  └──────────────┘    └──────┬───────┘                          │
│                             │ VPC Connector                     │
│                    ┌────────┴────────┐                          │
│                    │                 │                           │
│              ┌─────┴─────┐   ┌──────┴──────┐                   │
│              │ Cloud SQL  │   │ Memorystore │                   │
│              │ PostgreSQL │   │    Redis    │                   │
│              └───────────┘   └─────────────┘                   │
│                                                                 │
│  ┌───────────────┐  ┌────────────────┐  ┌──────────────┐      │
│  │ Cloud Storage │  │ Secret Manager │  │  Monitoring  │      │
│  │  (Evidence)   │  │   (Secrets)    │  │   (Alerts)   │      │
│  └───────────────┘  └────────────────┘  └──────────────┘      │
│                                                                 │
│  ┌──────────────────┐                                          │
│  │ Artifact Registry│  (Docker images)                         │
│  └──────────────────┘                                          │
└─────────────────────────────────────────────────────────────────┘
```

## Why GCP Dammam?

- **Full KSA data residency** — `me-central1` is in Dammam, Saudi Arabia
- **Cloud Run** — serverless containers, auto-HTTPS, scale-to-zero
- **Cost** — ~$60-80/month pilot vs ~$150-200 on AWS Bahrain
- **No ALB/NAT** — Cloud Run provides HTTPS + load balancing built-in

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- [Terraform](https://developer.hashicorp.com/terraform/downloads) >= 1.5
- [Docker Desktop](https://docs.docker.com/desktop/install/mac-install/)
- A GCP account with billing enabled

## Quick Start

### 1. Bootstrap (one-time)

```bash
./infra/bootstrap.sh
```

This will:
- Verify `gcloud`, `terraform`, `docker` are installed
- Authenticate with GCP
- Enable 10 required APIs
- Generate secrets in `infra/environments/pilot.secret.tfvars`
- Configure Docker for Artifact Registry
- Create Terraform state bucket
- Initialize Terraform

### 2. Deploy

```bash
./infra/deploy.sh pilot
```

This will:
1. `terraform plan` + `terraform apply` (creates all infrastructure)
2. Build + push Docker images to Artifact Registry
3. Run Prisma migrations
4. Deploy new Cloud Run revisions

### 3. Verify

After deployment, you'll see:

```
Frontend: https://taysiro-frontend-pilot-xxxxx.run.app
Backend:  https://taysiro-backend-pilot-xxxxx.run.app
API:      https://taysiro-backend-pilot-xxxxx.run.app/api
```

## Environment Switching

```bash
# Pilot (default)
./infra/deploy.sh pilot

# Production (separate GCP project)
./infra/deploy.sh production
```

Each environment uses its own:
- GCP project (resource isolation)
- `.tfvars` file (sizing & config)
- `.secret.tfvars` file (credentials)
- Terraform workspace

## Directory Structure

```
infra/
├── providers.tf              # Google provider, Terraform version
├── main.tf                   # Wires all modules + enables APIs
├── variables.tf              # Root input variables
├── outputs.tf                # URLs, repos, connection info
├── modules/
│   ├── networking/           # VPC, subnet, VPC Access Connector
│   ├── database/             # Cloud SQL PostgreSQL 15
│   ├── cache/                # Memorystore Redis 7
│   ├── storage/              # Cloud Storage (evidence bucket)
│   ├── backend-service/      # Cloud Run + Artifact Registry + Secrets
│   ├── frontend-service/     # Cloud Run + Artifact Registry
│   └── monitoring/           # Alert policies (email)
├── environments/
│   ├── pilot.tfvars          # Pilot sizing & config
│   ├── pilot.secret.tfvars   # Pilot secrets (gitignored)
│   ├── production.tfvars     # Production sizing & config
│   └── production.secret.tfvars
├── bootstrap.sh              # One-time setup
└── deploy.sh                 # Build + deploy
```

## Cost Breakdown (Pilot)

| Service | Spec | Est. Monthly |
|---------|------|-------------|
| Cloud Run (backend) | 1 vCPU, 512 MB, min 1 | ~$15 |
| Cloud Run (frontend) | 1 vCPU, 256 MB, scale-to-zero | ~$3 |
| Cloud SQL | db-f1-micro, 10 GB | ~$8 |
| Memorystore Redis | 1 GB Basic | ~$35 |
| Cloud Storage | < 1 GB | ~$1 |
| VPC Connector | e2-micro × 2 | ~$15 |
| Artifact Registry | < 2 GB | ~$1 |
| **Total** | | **~$78/month** |

## CI/CD (GitHub Actions)

### Required Secrets

Set these in GitHub → Settings → Secrets:

| Secret | Description |
|--------|-------------|
| `GCP_PROJECT_ID` | Your GCP project ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/PROJECT_NUM/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` |
| `GCP_SERVICE_ACCOUNT` | `deploy@PROJECT_ID.iam.gserviceaccount.com` |

### Setting up Workload Identity Federation

```bash
# Create a service account for GitHub Actions
gcloud iam service-accounts create github-deploy \
  --display-name="GitHub Actions Deploy"

# Grant required roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-deploy@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-deploy@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-deploy@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Create Workload Identity Pool
gcloud iam workload-identity-pools create github-pool \
  --location="global" \
  --display-name="GitHub Actions"

# Create provider
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Allow the pool to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding \
  github-deploy@$PROJECT_ID.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUM/locations/global/workloadIdentityPools/github-pool/attribute.repository/YOUR_ORG/taysiroments"
```

## Manual Operations

### Run Prisma migrations

```bash
# Via Cloud SQL proxy (local)
gcloud sql connect taysiro-pilot-pg --user=taysiro_user --database=taysiroments

# Or via Cloud Run Jobs
gcloud run jobs create taysiro-migrate-pilot \
  --image ME-CENTRAL2-docker.pkg.dev/PROJECT_ID/taysiro-backend/backend:latest \
  --region me-central1 \
  --command npx \
  --args prisma,migrate,deploy \
  --vpc-connector taysiro-pilot-conn \
  --set-env-vars DATABASE_URL="postgresql://..."
```

### Update webauthn_origin after first deploy

After the first deploy, update the backend's `WEBAUTHN_ORIGIN` env var to the actual frontend URL:

```bash
# Get the frontend URL
gcloud run services describe taysiro-frontend-pilot --region me-central1 --format="value(status.url)"

# Update in pilot.tfvars or via gcloud
gcloud run services update taysiro-backend-pilot \
  --region me-central1 \
  --set-env-vars WEBAUTHN_ORIGIN=https://taysiro-frontend-pilot-xxxxx.run.app
```

### View logs

```bash
# Backend logs
gcloud run services logs read taysiro-backend-pilot --region me-central1 --limit 100

# Tail logs in real-time
gcloud run services logs tail taysiro-backend-pilot --region me-central1
```

## Going to Production

1. Create a separate GCP project for production
2. Update `infra/environments/production.tfvars` with the new project ID
3. Run `./infra/bootstrap.sh` targeting the production project
4. Generate production secrets: `infra/environments/production.secret.tfvars`
5. `./infra/deploy.sh production`
6. Set up custom domain via Cloud Run domain mapping
7. Update `WEBAUTHN_ORIGIN` to the production domain
