# AWS Deployment Plan — SME Programmable Settlement

> Target: Production-ready, KSA-region deployment on AWS.
> Date: March 2026

---

## Table of Contents

1. [System Inventory](#1-system-inventory)
2. [Target Architecture](#2-target-architecture)
3. [Environment Strategy](#3-environment-strategy)
4. [Infrastructure (Terraform / IaC)](#4-infrastructure-terraform--iac)
5. [Networking & Security](#5-networking--security)
6. [Compute — ECS Fargate](#6-compute--ecs-fargate)
7. [Database — RDS PostgreSQL](#7-database--rds-postgresql)
8. [Cache & Queues — ElastiCache Redis](#8-cache--queues--elasticache-redis)
9. [File Storage — S3](#9-file-storage--s3)
10. [Frontend — Next.js on Amplify / CloudFront](#10-frontend--nextjs-on-amplify--cloudfront)
11. [Secrets Management](#11-secrets-management)
12. [CI/CD Pipeline](#12-cicd-pipeline)
13. [Observability](#13-observability)
14. [Disaster Recovery & Backups](#14-disaster-recovery--backups)
15. [Cost Estimate](#15-cost-estimate)
16. [Migration Checklist](#16-migration-checklist)
17. [Phase Rollout](#17-phase-rollout)

---

## 1. System Inventory

What we're deploying:

| Component | Technology | Current Config |
|-----------|-----------|----------------|
| **Backend API** | NestJS (Node 20+) | Port 3001, `/api` prefix, Swagger at `/api/docs` |
| **Frontend** | Next.js 16 | Port 3002, SSR, Turbopack dev |
| **Database** | PostgreSQL 15 | Docker port 5433, Prisma ORM (28 models) |
| **Cache / Queue** | Redis 7 | BullMQ for job queues, port 6379 |
| **File Uploads** | Local disk (`uploads/`) | Multer memory storage → disk write, SHA-256 on ingest |
| **Cron Jobs** | `@nestjs/schedule` in-process | Reconciliation, Anchoring, Integrity, Escalation |
| **External APIs** | Sigstore Rekor (anchoring), Bank APIs (KSA) | Outbound HTTPS |

### Environment Variables (discovered from codebase)

```text
DATABASE_URL              # Prisma connection string
REDIS_HOST                # Redis hostname (default: localhost)
REDIS_PORT                # Redis port (default: 6379)
BACKEND_PORT              # API port (default: 3001)
WEBAUTHN_ORIGIN           # Allowed CORS origins (comma-separated)
SETTLEMENT_RAIL           # "KSA_BANK" or simulated
BANK_WEBHOOK_SECRET       # HMAC secret for bank callbacks
PLATFORM_SIGNING_KEY      # Base64-encoded PKCS8 DER (ECDSA P-256)
UPLOAD_DIR                # Evidence file storage path
ANCHOR_PROVIDER           # "rekor" or "noop"
REKOR_URL                 # Sigstore Rekor endpoint
ESCROW_CONFIRM_DELAY_MS   # Simulated escrow delay
RECONCILIATION_INTERVAL_MINUTES
INTEGRITY_CHECK_INTERVAL_MINUTES
JWT_SECRET                # (assumed, standard NestJS auth)
```

---

## 2. Target Architecture

```text
                          ┌──────────────┐
                          │   Route 53   │
                          │ sme-pay.sa   │
                          └──────┬───────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              ┌─────┴──────┐          ┌───────┴──────┐
              │ CloudFront │          │     ALB      │
              │  (CDN)     │          │ api.sme-pay  │
              │ Next.js    │          │   .sa/api    │
              └─────┬──────┘          └───────┬──────┘
                    │                         │
              ┌─────┴──────┐          ┌───────┴──────┐
              │  Amplify   │          │ ECS Fargate  │
              │  Hosting   │          │  (Backend)   │
              │  (SSR)     │          │  2+ tasks    │
              └────────────┘          └───────┬──────┘
                                              │
                         ┌────────────────────┼────────────────────┐
                         │                    │                    │
                  ┌──────┴──────┐   ┌─────────┴────────┐  ┌───────┴──────┐
                  │ RDS Postgres│   │ ElastiCache Redis │  │   S3 Bucket  │
                  │  (Multi-AZ) │   │   (Cluster Mode)  │  │  (Evidence)  │
                  └─────────────┘   └──────────────────┘  └──────────────┘
```

**Region**: `me-south-1` (Bahrain) — closest AWS region to KSA.
_If AWS launches `me-central-1` (KSA) before go-live, prefer that._

---

## 3. Environment Strategy

| Environment | Purpose | Branch | Infra Scale |
|-------------|---------|--------|-------------|
| **dev** | Day-to-day development | `develop` | Minimal (single AZ, small instances) |
| **staging** | Pre-production testing, UAT | `staging` | Mirrors prod topology, smaller instances |
| **production** | Live KSA pilot | `main` | Full HA (Multi-AZ, autoscaling) |

Each environment is a separate AWS account (or at minimum, separate VPC + IAM boundary) inside an AWS Organization.

---

## 4. Infrastructure (Terraform / IaC)

All infrastructure managed as code using **Terraform** with the following module structure:

```text
infra/
├── modules/
│   ├── networking/        # VPC, subnets, NAT, security groups
│   ├── ecs/               # Fargate cluster, task defs, services
│   ├── rds/               # PostgreSQL instance
│   ├── elasticache/       # Redis cluster
│   ├── s3/                # Evidence bucket + lifecycle rules
│   ├── alb/               # Application Load Balancer
│   ├── cloudfront/        # CDN distribution
│   ├── amplify/           # Next.js hosting
│   ├── secrets/           # Secrets Manager resources
│   ├── monitoring/        # CloudWatch dashboards, alarms
│   └── cicd/              # CodePipeline / GitHub Actions OIDC
├── environments/
│   ├── dev/
│   │   └── main.tf        # Dev-specific vars & overrides
│   ├── staging/
│   │   └── main.tf
│   └── prod/
│       └── main.tf
├── backend.tf             # S3 remote state + DynamoDB lock
└── variables.tf
```

**Remote State**: S3 bucket + DynamoDB table for state locking.

---

## 5. Networking & Security

### VPC Design

```text
VPC: 10.0.0.0/16

Public Subnets (2 AZs):
  10.0.1.0/24  — ALB, NAT Gateway
  10.0.2.0/24  — ALB (AZ-b)

Private Subnets (2 AZs):
  10.0.10.0/24 — ECS Fargate tasks (AZ-a)
  10.0.11.0/24 — ECS Fargate tasks (AZ-b)

Isolated Subnets (2 AZs):
  10.0.20.0/24 — RDS Primary (AZ-a)
  10.0.21.0/24 — RDS Standby (AZ-b)
  10.0.22.0/24 — ElastiCache (AZ-a)
  10.0.23.0/24 — ElastiCache (AZ-b)
```

### Security Groups

| SG Name | Inbound | Source |
|---------|---------|--------|
| `sg-alb` | 443 (HTTPS) | 0.0.0.0/0 |
| `sg-backend` | 3001 | `sg-alb` only |
| `sg-rds` | 5432 | `sg-backend` only |
| `sg-redis` | 6379 | `sg-backend` only |
| `sg-s3-endpoint` | 443 | VPC CIDR (via VPC endpoint) |

### Key Security Measures

- **No public IPs** on ECS tasks, RDS, or Redis — all traffic via private subnets
- **NAT Gateway** in public subnet for outbound internet (Sigstore Rekor, bank APIs)
- **VPC Endpoints** for S3 and ECR (avoid NAT costs for AWS service traffic)
- **WAF** on ALB: rate limiting, geo-blocking (allow KSA, SG, dev locations), SQL injection + XSS rules
- **ACM certificates** for `*.sme-pay.sa` on ALB and CloudFront
- **TLS 1.2+ everywhere** — ALB listener policy `ELBSecurityPolicy-TLS13-1-2-2021-06`

---

## 6. Compute — ECS Fargate

### Why Fargate (not EC2, not EKS)

- No server management overhead
- Scales to zero in dev (pay per task-second)
- Simpler than Kubernetes for a team < 10 engineers
- Supports the cron pattern we already use (in-process `@nestjs/schedule`)

### Task Definition

```json
{
  "family": "sme-backend",
  "cpu": "1024",
  "memory": "2048",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "containerDefinitions": [{
    "name": "backend",
    "image": "<account>.dkr.ecr.me-south-1.amazonaws.com/sme-backend:latest",
    "portMappings": [{ "containerPort": 3001, "protocol": "tcp" }],
    "environment": [],
    "secrets": [
      { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..." },
      { "name": "PLATFORM_SIGNING_KEY", "valueFrom": "arn:aws:secretsmanager:..." },
      { "name": "BANK_WEBHOOK_SECRET", "valueFrom": "arn:aws:secretsmanager:..." },
      { "name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:..." }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/sme-backend",
        "awslogs-region": "me-south-1",
        "awslogs-stream-prefix": "backend"
      }
    },
    "healthCheck": {
      "command": ["CMD-SHELL", "curl -f http://localhost:3001/api/health || exit 1"],
      "interval": 30,
      "timeout": 5,
      "retries": 3
    }
  }]
}
```

### Service Configuration

| Parameter | Dev | Staging | Production |
|-----------|-----|---------|------------|
| Desired count | 1 | 2 | 2 |
| Min capacity | 1 | 2 | 2 |
| Max capacity | 2 | 4 | 8 |
| CPU target | 70% | 70% | 60% |
| Memory target | — | — | 75% |

### Autoscaling Policy

- **Target tracking** on CPU utilization (60% for prod)
- **Step scaling** for burst: +2 tasks when CPU > 80% for 2 min
- **Scale-in cooldown**: 300 seconds (avoid flapping)
- **Scheduled scaling**: Scale up during KSA business hours (06:00–18:00 AST)

### Dockerfile (Backend)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
USER nestjs
EXPOSE 3001
CMD ["node", "dist/main"]
```

### Cron Jobs Strategy

The backend uses `@nestjs/schedule` with in-process crons:
- `EscalationService` — every 10 min + every hour
- `ReconciliationService` — configurable interval
- `IntegrityService` — configurable interval
- `AnchorSchedulerService` — periodic anchoring

**Production approach**: Run crons in **all tasks** but use **Redis-based distributed lock** (already using BullMQ/Redis) to ensure only one task executes each cron. Alternatively, designate one ECS task as the "cron leader" using ECS service discovery.

_Future improvement_: Extract cron jobs to **EventBridge Scheduler + Lambda** or a dedicated single-task ECS service for isolation.

---

## 7. Database — RDS PostgreSQL

### Instance Configuration

| Parameter | Dev | Staging | Production |
|-----------|-----|---------|------------|
| Engine | PostgreSQL 15 | PostgreSQL 15 | PostgreSQL 15 |
| Instance class | `db.t4g.micro` | `db.t4g.small` | `db.r6g.large` |
| Storage | 20 GB gp3 | 50 GB gp3 | 100 GB gp3 (auto-expand) |
| Multi-AZ | No | No | **Yes** |
| Read replicas | 0 | 0 | 1 (for reporting) |
| Backup retention | 7 days | 7 days | 35 days |
| Encryption | AES-256 (KMS) | AES-256 (KMS) | AES-256 (KMS) |
| Point-in-time recovery | Yes | Yes | Yes |

### Connection String Pattern

```text
DATABASE_URL=postgresql://sme_user:<password>@sme-prod.cluster-xxxxx.me-south-1.rds.amazonaws.com:5432/sme_payments?sslmode=require&connection_limit=20
```

### Prisma Migrations in CI/CD

```bash
# In the deploy pipeline, BEFORE rolling out new ECS tasks:
npx prisma migrate deploy
```

Run as a one-off ECS task (or CodeBuild step) with the same `DATABASE_URL` secret. Never run migrations from a running service.

### Performance

- **Connection pooling**: Use PgBouncer as a sidecar container or Prisma's built-in connection pool (`connection_limit=20` per task, with 2-8 tasks = 40-160 connections, well within RDS limits)
- **Slow query logging**: Enable `log_min_duration_statement = 200` (ms)
- **Parameter Group**: Set `shared_preload_libraries = 'pg_stat_statements'` for query analytics

---

## 8. Cache & Queues — ElastiCache Redis

### Instance Configuration

| Parameter | Dev | Staging | Production |
|-----------|-----|---------|------------|
| Engine | Redis 7 | Redis 7 | Redis 7 |
| Node type | `cache.t4g.micro` | `cache.t4g.small` | `cache.r6g.large` |
| Cluster mode | Disabled | Disabled | Disabled (single shard) |
| Replicas | 0 | 1 | 2 |
| Multi-AZ failover | No | No | **Yes** |
| Encryption at rest | Yes (KMS) | Yes | Yes |
| Encryption in transit | Yes (TLS) | Yes | Yes |
| Automatic backups | Daily | Daily | Daily, 7-day retention |

### Usage Patterns

- **BullMQ**: Job queues for async settlement processing
- **Idempotency**: `IdempotencyInterceptor` stores request fingerprints (TTL-based)
- **Cron locking**: Distributed lock for `@Cron` handlers (proposed improvement)
- **Rate limiting**: `ThrottlerModule` (if backed by Redis store in production)

---

## 9. File Storage — S3

### Current State

Evidence files are stored on local disk:
```typescript
const UPLOAD_DIR = path.resolve(
  process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"),
);
```

### Migration to S3

**Required code change**: Replace local `fs.writeFile` / `fs.readFile` in `EvidenceService` with S3 SDK calls.

#### S3 Bucket Configuration

```text
Bucket: sme-payments-evidence-{env}
Region: me-south-1
Versioning: Enabled (evidence integrity)
Encryption: SSE-S3 (AES-256) or SSE-KMS for prod
Lifecycle:
  - Transition to S3-IA after 90 days
  - Transition to Glacier after 365 days
  - No expiration (financial records — retain indefinitely)
Block public access: ALL BLOCKED
```

#### Access Pattern

- Backend ECS tasks write/read via **IAM Task Role** (no keys in env vars)
- Pre-signed URLs for frontend downloads (60-minute expiry)
- **VPC Endpoint** for S3 — traffic stays on AWS backbone

#### Code Changes Required

```typescript
// evidence.service.ts — replace disk storage with:
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Upload: PutObjectCommand with SHA-256 checksum header
// Download: getSignedUrl for pre-signed URL
// Verify: HeadObject to check existence + checksum
```

**Estimated effort**: 2-3 days (service refactor + tests + e2e validation)

---

## 10. Frontend — Next.js on Amplify / CloudFront

### Option A: AWS Amplify Hosting (Recommended)

- Native Next.js SSR support (App Router, server components)
- Automatic CloudFront CDN
- Branch-based deployments (preview URLs for PRs)
- Zero infra management

```text
Amplify App:
  Repository: GitHub (sme-payments)
  Framework: Next.js - SSR
  Build command: cd frontend && npm ci && npm run build
  Output dir: frontend/.next
  Environment variables:
    NEXT_PUBLIC_API_URL=https://api.sme-pay.sa
```

### Option B: Self-Hosted on ECS (if Amplify limitations hit)

- Separate ECS Fargate service for Next.js
- CloudFront distribution in front
- More control but more ops burden

### Recommendation: Start with Amplify, migrate to ECS only if needed.

### Domain Setup

```text
sme-pay.sa          → CloudFront (Amplify frontend)
api.sme-pay.sa      → ALB (ECS backend)
```

---

## 11. Secrets Management

All secrets in **AWS Secrets Manager** (not SSM Parameter Store — supports automatic rotation).

| Secret Name | Rotation | Description |
|------------|----------|-------------|
| `/sme/{env}/database-url` | Manual (DB password rotation planned) | Prisma connection string |
| `/sme/{env}/jwt-secret` | Manual | JWT signing key |
| `/sme/{env}/platform-signing-key` | Manual | ECDSA P-256 private key (base64 PKCS8) |
| `/sme/{env}/bank-webhook-secret` | Manual | HMAC for bank callbacks |
| `/sme/{env}/redis-auth-token` | Manual | ElastiCache AUTH token |

### Access Pattern

- ECS Task Role → Secrets Manager `GetSecretValue` via IAM policy
- ECS natively injects secrets as environment variables from `secrets` block in task def
- **No secrets in .env files, no secrets in Docker images**

---

## 12. CI/CD Pipeline

### GitHub Actions (Recommended)

```text
.github/
└── workflows/
    ├── ci.yml              # PR checks: lint, test, build
    ├── deploy-backend.yml  # Backend: build → push ECR → migrate DB → deploy ECS
    └── deploy-frontend.yml # Frontend: push to Amplify (auto-triggered)
```

### Backend Pipeline

```yaml
name: Deploy Backend

on:
  push:
    branches: [main]
    paths: [backend/**, prisma/**]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: sme_test
      redis:
        image: redis:7-alpine
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd backend && npm ci
      - run: cd backend && npx prisma generate
      - run: cd backend && npm test

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # OIDC for AWS
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam:::<deploy-role>
          aws-region: me-south-1

      # Build & push Docker image
      - uses: aws-actions/amazon-ecr-login@v2
      - run: |
          docker build -t sme-backend ./backend
          docker tag sme-backend:latest $ECR_REGISTRY/sme-backend:${{ github.sha }}
          docker push $ECR_REGISTRY/sme-backend:${{ github.sha }}

      # Run Prisma migrations
      - run: |
          aws ecs run-task \
            --cluster sme-prod \
            --task-definition sme-migrate \
            --launch-type FARGATE \
            --network-configuration "..." \
            --overrides '{"containerOverrides":[{"name":"migrate","command":["npx","prisma","migrate","deploy"]}]}'

      # Deploy new task definition
      - uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: task-def.json
          service: sme-backend
          cluster: sme-prod
          wait-for-service-stability: true
```

### Deployment Strategy

- **Rolling update** with ECS: `minimumHealthyPercent: 100`, `maximumPercent: 200`
- This means: new tasks spin up → health check passes → old tasks drain
- **Zero downtime** because ALB drains connections before killing old tasks
- **Rollback**: Revert to previous task definition revision (automatic if health check fails)

---

## 13. Observability

### Logging

| Component | Destination | Retention |
|-----------|-------------|-----------|
| Backend (stdout/stderr) | CloudWatch Logs `/ecs/sme-backend` | 30 days (dev), 90 days (prod) |
| ALB access logs | S3 `sme-access-logs-{env}` | 365 days |
| RDS slow queries | CloudWatch Logs | 30 days |
| WAF logs | CloudWatch Logs | 30 days |

**Structured logging**: Add `correlation-id` (already in `CorrelationIdMiddleware`) to all log lines for request tracing.

### Metrics & Dashboards (CloudWatch)

Dashboard panels:
- **API**: Request count, latency P50/P95/P99, 4xx/5xx rates
- **ECS**: CPU/memory utilization per task, running task count
- **RDS**: Connections, read/write IOPS, replication lag, free storage
- **Redis**: Memory usage, cache hit rate, evictions, connected clients
- **Business**: PO created count, settlement success rate, dispute count (custom metrics)

### Alarms

| Alarm | Threshold | Action |
|-------|-----------|--------|
| API 5xx rate | > 5% for 5 min | SNS → PagerDuty/Slack |
| API latency P99 | > 3s for 5 min | SNS → Slack |
| ECS CPU | > 80% sustained 5 min | Autoscale (auto) + alert |
| RDS free storage | < 5 GB | SNS → Slack |
| RDS CPU | > 80% for 10 min | SNS → Slack |
| Redis memory | > 80% | SNS → Slack |
| Health check failures | 3 consecutive | SNS → PagerDuty |
| Reconciliation drift | variance > 0 | SNS → PagerDuty (critical) |

### Tracing (Future)

- **AWS X-Ray** or **OpenTelemetry** for distributed tracing
- Instrument NestJS with `@opentelemetry/instrumentation-nestjs-core`
- Trace: HTTP request → DB query → Redis call → S3 upload → bank API call

---

## 14. Disaster Recovery & Backups

### RPO / RTO Targets

| Metric | Target |
|--------|--------|
| **RPO** (Recovery Point Objective) | < 5 minutes |
| **RTO** (Recovery Time Objective) | < 30 minutes |

### Backup Strategy

| Resource | Backup Method | Frequency | Retention |
|----------|--------------|-----------|-----------|
| RDS PostgreSQL | Automated snapshots + PITR | Continuous (transaction log) | 35 days |
| S3 Evidence | Versioning + Cross-region replication | Real-time | Indefinite |
| Redis | Daily snapshot | Daily | 7 days |
| Secrets Manager | Versioned by default | On change | Indefinite |
| Terraform state | S3 versioning | On change | 90 days |

### DR Runbook

1. **Database failure**: RDS Multi-AZ automatic failover (< 2 min), PITR for data corruption
2. **Region failure**: Restore RDS from cross-region snapshot, deploy ECS in backup region (`eu-west-1`), update Route 53 failover record
3. **S3 data loss**: Restore from versioning or cross-region replica
4. **Compromised signing key**: Rotate `PLATFORM_SIGNING_KEY` in Secrets Manager, redeploy ECS tasks

---

## 15. Cost Estimate

### Monthly Cost (Production — me-south-1)

| Resource | Spec | Estimated $/month |
|----------|------|--------------------|
| **ECS Fargate** | 2 tasks × 1 vCPU / 2 GB, 24/7 | ~$75 |
| **RDS PostgreSQL** | db.r6g.large, Multi-AZ, 100 GB | ~$380 |
| **ElastiCache Redis** | cache.r6g.large, 2 replicas | ~$310 |
| **ALB** | 1 ALB + data processing | ~$25 |
| **CloudFront** | 100 GB transfer/month | ~$12 |
| **Amplify Hosting** | SSR, build minutes | ~$15 |
| **S3** | 50 GB evidence + requests | ~$2 |
| **Secrets Manager** | 6 secrets | ~$3 |
| **CloudWatch** | Logs, metrics, alarms | ~$20 |
| **NAT Gateway** | 1 (single AZ, consider 2 for HA) | ~$35 |
| **Route 53** | Hosted zone + queries | ~$1 |
| **WAF** | ALB rules | ~$10 |
| **Data Transfer** | Outbound ~50 GB | ~$5 |
| | | |
| **TOTAL (Production)** | | **~$893/month** |
| **Dev environment** | (minimal sizing) | **~$150/month** |
| **Staging environment** | (mid sizing) | **~$400/month** |

### Cost Optimization Tips

- **Dev**: Use Fargate Spot, `db.t4g.micro`, single-AZ everything
- **Staging**: Schedule scale-to-zero outside business hours (EventBridge + Lambda)
- **Reserved Instances**: Commit to 1-year RI for RDS + ElastiCache after pilot validation (~30% savings)
- **S3 lifecycle**: Move evidence to IA after 90 days, Glacier after 1 year

---

## 16. Migration Checklist

### Phase 0: Pre-requisites

- [ ] AWS Organization + accounts (dev, staging, prod)
- [ ] Domain registration: `sme-pay.sa` (or chosen domain)
- [ ] ACM certificates provisioned (DNS validation)
- [ ] Terraform remote state bucket + DynamoDB table
- [ ] GitHub OIDC provider configured in AWS IAM

### Phase 1: Infrastructure Provisioning

- [ ] VPC + subnets + NAT Gateway + VPC endpoints
- [ ] Security groups
- [ ] RDS PostgreSQL instance
- [ ] ElastiCache Redis cluster
- [ ] S3 bucket (evidence) with versioning + encryption
- [ ] ECR repository
- [ ] ECS cluster (Fargate)
- [ ] ALB + target group + HTTPS listener
- [ ] Secrets Manager entries populated
- [ ] CloudWatch log groups + dashboards

### Phase 2: Application Changes

- [ ] Create `Dockerfile` for backend (multi-stage build)
- [ ] Refactor `EvidenceService` to use S3 instead of local disk
- [ ] Add health check endpoint verification (`/api/health`)
- [ ] Add Redis TLS support to BullMQ connection config
- [ ] Add `?sslmode=require` to `DATABASE_URL`
- [ ] Verify Prisma connection pooling settings
- [ ] Test with `SETTLEMENT_RAIL=KSA_BANK` if going live with real bank
- [ ] Add structured JSON logging (replace `console.log`)
- [ ] Implement distributed cron lock (Redis-based)

### Phase 3: CI/CD Setup

- [ ] GitHub Actions workflows (CI, backend deploy, frontend deploy)
- [ ] ECR image push pipeline
- [ ] ECS task definition update automation
- [ ] Prisma migration step in deploy pipeline
- [ ] Amplify app connected to GitHub repo
- [ ] Branch protection rules enforced

### Phase 4: DNS & TLS

- [ ] Route 53 hosted zone configured
- [ ] A/AAAA records for `api.sme-pay.sa` → ALB
- [ ] CNAME for `sme-pay.sa` → CloudFront/Amplify
- [ ] WAF rules attached to ALB
- [ ] Test end-to-end TLS

### Phase 5: Data Migration

- [ ] Seed production database (`npx prisma migrate deploy` + seed)
- [ ] Upload any existing evidence files to S3
- [ ] Verify ledger chain integrity after migration
- [ ] Run reconciliation service and verify clean report

### Phase 6: Go-Live

- [ ] Smoke test all API endpoints (use Swagger)
- [ ] Verify WebAuthn/passkey flow with production origin
- [ ] Confirm cron jobs are running (check CloudWatch logs)
- [ ] Confirm bank webhook endpoint is reachable
- [ ] Load test (moderate: 50 concurrent users)
- [ ] Enable CloudWatch alarms
- [ ] Update `WEBAUTHN_ORIGIN` to production domain
- [ ] Cut DNS to production

---

## 17. Phase Rollout

```text
Week 1-2:  Terraform modules + VPC + RDS + Redis + S3
           Backend Dockerfile + S3 code migration
           ──────────────────────────────────────────

Week 3:    ECS service + ALB + health checks
           CI/CD pipeline (GitHub Actions)
           ──────────────────────────────────────────

Week 4:    Amplify frontend deployment
           DNS + TLS + WAF
           CloudWatch dashboards + alarms
           ──────────────────────────────────────────

Week 5:    Staging environment full deployment
           E2E testing on staging
           Load testing
           ──────────────────────────────────────────

Week 6:    Production deployment
           Data migration + verification
           Go-live with KSA pilot users
           ──────────────────────────────────────────
```

---

## Appendix A: Required IAM Roles

| Role | Attached To | Key Permissions |
|------|-------------|-----------------|
| `sme-ecs-task-role` | ECS tasks | S3 (evidence bucket), Secrets Manager (read), CloudWatch (logs/metrics) |
| `sme-ecs-execution-role` | ECS agent | ECR (pull images), Secrets Manager (inject to container), CloudWatch (create log streams) |
| `sme-github-deploy-role` | GitHub OIDC | ECR (push), ECS (update service + run task), S3 (terraform state) |
| `sme-rds-monitoring-role` | RDS enhanced monitoring | CloudWatch (put metrics) |

## Appendix B: Environment Variables (Production)

```bash
# Injected via Secrets Manager → ECS task definition
DATABASE_URL=postgresql://sme_user:****@sme-prod.xxxxx.me-south-1.rds.amazonaws.com:5432/sme_payments?sslmode=require&connection_limit=20
REDIS_HOST=sme-prod.xxxxx.cache.amazonaws.com
REDIS_PORT=6379
BACKEND_PORT=3001
WEBAUTHN_ORIGIN=https://sme-pay.sa
SETTLEMENT_RAIL=KSA_BANK
BANK_WEBHOOK_SECRET=****
PLATFORM_SIGNING_KEY=****
JWT_SECRET=****
UPLOAD_DIR=/tmp/uploads  # Transitional; replaced by S3 after migration
ANCHOR_PROVIDER=rekor
REKOR_URL=https://rekor.sigstore.dev
RECONCILIATION_INTERVAL_MINUTES=30
INTEGRITY_CHECK_INTERVAL_MINUTES=60

# S3 (new)
EVIDENCE_BUCKET=sme-payments-evidence-prod
AWS_REGION=me-south-1
# No AWS keys needed — uses IAM Task Role
```
