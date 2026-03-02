# Programmable SME Settlement

Event-Driven B2B Payments with Embedded Liquidity and Verifiable Digital Trust — NestJS backend, Next.js frontend, PostgreSQL, and Redis.

## Prerequisites

- **Node.js** (v20+)
- **Docker & Docker Compose** (for PostgreSQL and Redis)

## Getting Started

### 1. Start infrastructure (PostgreSQL + Redis)

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on `localhost:5433` (user: `sme_user`, password: `sme_password`, db: `sme_payments`)
- **Redis** on `localhost:6379`

### 2. Install dependencies

```bash
# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 3. Set up the database

```bash
cd backend

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Seed with demo data
npm run prisma:seed
```

### 4. Run the backend

```bash
cd backend
npm run dev
```

The backend runs on **http://localhost:3001**. All API routes are prefixed with `/api`.

### 5. Run the frontend

In a separate terminal:

```bash
cd frontend
npm run dev
```

The frontend runs on **http://localhost:3000**.

## Accessing the App

| URL | Description |
|-----|-------------|
| http://localhost:3000 | Frontend (Next.js) |
| http://localhost:3001/api/docs | Swagger API docs |

### Demo Accounts

All seed accounts use the password **`password123`**.

| Email | Role | Company |
|-------|------|---------|
| `buyer@acme.co.uk` | Buyer | Acme Retail Ltd |
| `buyer@greenfield.co.uk` | Buyer | Greenfield Manufacturing Ltd |
| `supplier@swiftlogistics.co.uk` | Supplier | Swift Logistics Ltd |
| `supplier@brightworks.co.uk` | Supplier | Brightworks Engineering Ltd |
| `lp@capitalbridge.co.uk` | Liquidity Partner | Capital Bridge Finance Ltd |
| `admin@platform.co.uk` | Admin | Programmable SME Settlement |

## Environment Variables

Environment files are at `.env` (root) and `backend/.env`. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://sme_user:sme_password@localhost:5433/sme_payments` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | `dev-jwt-secret-change-in-production` | JWT signing secret |
| `BACKEND_PORT` | `3001` | Backend server port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API URL used by the frontend |

## Useful Commands

```bash
# Open Prisma Studio (database GUI)
cd backend && npm run prisma:studio

# Lint the frontend
cd frontend && npm run lint

# Build for production
cd backend && npm run build
cd frontend && npm run build
```