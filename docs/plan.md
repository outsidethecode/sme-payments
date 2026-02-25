# SME Procurement-to-Pay MVP — Implementation Plan

## 1. Project Overview

A unified digital **procurement-to-pay** platform that streamlines B2B transactions for SMEs by:

- Enabling buyers to create digitally verifiable purchase orders with explicit conditions
- Pre-authorising payments via (simulated) Open Banking so funds are locked before work begins
- Allowing suppliers to optionally access early payment through regulated liquidity partners
- Automating settlement on delivery/milestone verification
- Producing immutable audit trails for all parties

---

## 2. Actors & Roles

| Role               | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| **Buyer**           | SME that procures goods/services, creates POs, pre-authorises payments      |
| **Supplier**        | SME that fulfils orders, can request early payment                          |
| **Liquidity Partner** | Regulated financial entity that advances funds against verified commitments |
| **Platform Admin**  | Internal role — monitors transactions, manages fees, views audit logs       |

> For the MVP, a single user can register as Buyer or Supplier. The Liquidity Partner and Admin are seeded/system accounts with dedicated dashboards.

---

## 3. Technology Stack

### Frontend

| Layer         | Technology                         | Rationale                                                    |
| ------------- | ---------------------------------- | ------------------------------------------------------------ |
| Framework     | **Next.js 14 (App Router)**        | SSR/SSG, file-based routing, React Server Components         |
| Language      | **TypeScript**                     | Type safety across the stack                                  |
| UI Library    | **shadcn/ui + Tailwind CSS 3**     | Production-quality components, fully customisable             |
| State         | **TanStack Query (React Query)**   | Server-state caching, optimistic updates                     |
| Forms         | **React Hook Form + Zod**          | Validation shared with backend DTOs                          |
| Charts        | **Recharts**                       | Dashboard analytics (cashflow, transaction volume)           |
| Real-time     | **Server-Sent Events (SSE)**       | Live PO status updates, notifications (native NestJS support)|

### Backend

| Layer         | Technology                         | Rationale                                                    |
| ------------- | ---------------------------------- | ------------------------------------------------------------ |
| Framework     | **NestJS**                         | Modular, enterprise-grade Node.js framework                  |
| Language      | **TypeScript**                     | Shared types/validation with frontend                        |
| ORM           | **Prisma**                         | Type-safe DB access, migrations, seeding                     |
| Auth          | **Passport.js + @nestjs/jwt**      | Email/password (bcrypt) + JWT tokens + role guards           |
| Validation    | **Zod (shared schemas)**           | Single source of truth for validation                        |
| Crypto        | **WebAuthn/FIDO2 Passkeys + SHA-256** | Hardware-bound signatures via `@simplewebauthn` — zero key management |
| API Style     | **REST** (with OpenAPI/Swagger)    | Standard, easy to demo and document                          |
| Queue/Events  | **BullMQ + Redis**                 | Async settlement jobs, scheduled auto-acceptance             |

### Infrastructure (Local Demo)

| Layer         | Technology                         | Rationale                                                    |
| ------------- | ---------------------------------- | ------------------------------------------------------------ |
| Database      | **PostgreSQL 15 (Docker)**         | Single container, no Supabase overhead                       |
| Cache/Queue   | **Redis (Docker)**                 | BullMQ backing store                                         |
| Orchestration | **Docker Compose**                 | Single `docker compose up` — just 2 containers (PG + Redis)  |

### Simulated Services

| Service                | Simulation Approach                                                      |
| ---------------------- | ------------------------------------------------------------------------ |
| **Open Banking**       | Mock API in NestJS — simulates account lookup, payment auth, fund moves  |
| **Liquidity Partner**  | System actor with a seeded balance; auto-approves eligible requests       |
| **KYC/Compliance**     | Stubbed — all users auto-verified for MVP                                |

---

## 4. Core Data Model (Simplified)

```
User
  id, email, name, role (BUYER | SUPPLIER | LIQUIDITY_PARTNER | ADMIN)
  company_name, company_number
  bank_account (simulated)
  balance (simulated ledger)

PurchaseOrder
  id, reference_number
  buyer_id → User
  supplier_id → User
  description, line_items (JSON)
  amount (pennies)
  currency (GBP)
  conditions (JSON — acceptance_type, acceptance_window_hours, milestones)
  status (DRAFT | SENT | ACCEPTED | IN_PROGRESS | DELIVERED | VERIFIED | SETTLED | DISPUTED | CANCELLED)
  payment_locked (boolean)
  locked_at, accepted_at, delivered_at, verified_at, settled_at
  created_at, updated_at

PaymentLock
  id, purchase_order_id → PurchaseOrder
  buyer_id → User
  amount
  status (PENDING | LOCKED | RELEASED | REFUNDED)
  open_banking_ref (simulated)
  locked_at, released_at

EarlyPaymentRequest
  id, purchase_order_id → PurchaseOrder
  supplier_id → User
  liquidity_partner_id → User
  face_value
  service_fee          ← ujrah (flat service fee, NOT a time-based discount)
  net_advance          ← face_value minus service_fee
  status (REQUESTED | APPROVED | FUNDED | SETTLED | REJECTED | DEFAULTED)
  risk_acknowledged (boolean)   ← partner accepts delivery risk
  funded_at, settled_at

Settlement
  id, purchase_order_id → PurchaseOrder
  from_user_id → User
  to_user_id → User
  amount
  type (STANDARD | EARLY_PAY_ADVANCE | EARLY_PAY_SETTLEMENT)
  status (PENDING | COMPLETED | FAILED)
  completed_at

UserPasskey
  user_id → User
  credential_id (WebAuthn credential ID, base64url)
  public_key (ECDSA P-256, COSE format, base64)
  sign_count (authenticator counter for replay protection)
  device_type ('singleDevice' | 'multiDevice')
  backed_up (boolean)
  transports (array: 'internal', 'hybrid', 'usb', 'ble', 'nfc')
  created_at, last_used_at

EventLog (APPEND-ONLY — no UPDATE/DELETE at DB level)
  id, sequence (global monotonic), entity_sequence (per-entity)
  entity_type, entity_id
  event_type (PO_CREATED | PAYMENT_LOCKED | PO_ACCEPTED | ...)
  actor_id → User, actor_role
  payload (JSONB)
  timestamp
  actor_signature (WebAuthn assertion signature or system ECDSA signature)
  authenticator_data (WebAuthn authenticator data, NULL for SYSTEM events)
  actor_public_key
  credential_id (WebAuthn credential ID, NULL for SYSTEM events)
  previous_hash (SHA-256 of previous event, or "GENESIS")
  event_hash (SHA-256 of this event's canonical form)
  UNIQUE(entity_id, entity_sequence), UNIQUE(event_hash)

PlatformFee
  id, purchase_order_id → PurchaseOrder
  fee_type (TRANSACTION | EARLY_PAY_FACILITATION)
  amount
  created_at
```

### Engineering Design Notes (Internal — not disclosed)

The data model and fee structure are designed so that:

1. **The service fee on early payment is a flat fee for payment acceleration service (ujrah)**, not a percentage discount on a debt. The supplier receives the full face value minus a clearly defined service charge.
2. **The liquidity partner bears genuine delivery risk** — if the buyer disputes or delivery fails, the `EarlyPaymentRequest` can move to `DEFAULTED` and the partner absorbs the loss. There is no guaranteed repayment.
3. **Payment is conditional on verified performance**, not time. The `PaymentLock` releases on event (delivery verified), not on a date.
4. **There is no debt created.** The supplier sells nothing — the platform accelerates a payment that is already committed but conditional. The liquidity partner is pre-paying for a conditional outcome.

These structural choices ensure the mechanism is **risk-bearing trade facilitation**, not discounted debt — making it compatible with ethical finance principles without needing to disclose or label it.

---

## 5. Application Pages & UI

### 5.1 Shared

| Page              | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `/login`          | Email/password sign-in                               |
| `/register`       | Registration with role selection (Buyer / Supplier)  |
| `/dashboard`      | Role-specific dashboard (routes to correct view)     |
| `/notifications`  | Real-time notification feed                          |

### 5.2 Buyer Views

| Page                           | Description                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `/buyer/dashboard`             | Summary: active POs, locked funds, pending verifications       |
| `/buyer/orders`                | List of all POs with filters/search                            |
| `/buyer/orders/new`            | Create PO: select supplier, items, amount, conditions          |
| `/buyer/orders/[id]`           | PO detail: status timeline, lock payment, verify delivery      |
| `/buyer/suppliers`             | Manage known suppliers                                         |
| `/buyer/bank`                  | Simulated bank account / balance view                          |

### 5.3 Supplier Views

| Page                           | Description                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `/supplier/dashboard`          | Summary: incoming POs, cashflow, early-pay options             |
| `/supplier/orders`             | List of POs received                                           |
| `/supplier/orders/[id]`        | PO detail: accept, mark delivered, request early payment       |
| `/supplier/early-payments`     | History of early payment requests and outcomes                 |
| `/supplier/bank`               | Simulated bank account / balance view                          |

### 5.4 Liquidity Partner Views

| Page                           | Description                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `/lp/dashboard`                | Portfolio: active advances, returns, risk exposure             |
| `/lp/requests`                 | Pending early-payment requests to review/approve               |
| `/lp/requests/[id]`           | Request detail: PO info, **cryptographic verification bundle**, risk summary, approve/reject |
| `/lp/settlements`              | Settlement history                                             |

### 5.5 Admin Views

| Page                           | Description                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `/admin/dashboard`             | Platform-wide metrics: volume, fees, active transactions       |
| `/admin/transactions`          | All transactions with audit trail (backed by immutable ledger) |
| `/admin/users`                 | User management                                                |

---

## 6. API Endpoints (Backend)

### Auth & Passkeys
- `POST /auth/register` — Register with role
- `POST /auth/login` — Login (Supabase JWT)
- `GET  /auth/me` — Current user profile
- `POST /auth/passkeys/register/options` — Get WebAuthn registration options
- `POST /auth/passkeys/register/verify` — Verify and store new passkey
- `POST /auth/passkeys/authenticate/options` — Get WebAuthn authentication options
- `POST /auth/passkeys/authenticate/verify` — Verify passkey authentication

### Purchase Orders
- `POST   /purchase-orders` — Create PO (Buyer)
- `GET    /purchase-orders` — List POs (filtered by role)
- `GET    /purchase-orders/:id` — PO detail
- `PATCH  /purchase-orders/:id/send` — Send to supplier (Buyer)
- `PATCH  /purchase-orders/:id/accept` — Accept PO (Supplier)
- `PATCH  /purchase-orders/:id/deliver` — Mark as delivered (Supplier)
- `PATCH  /purchase-orders/:id/verify` — Verify delivery (Buyer)
- `PATCH  /purchase-orders/:id/dispute` — Raise dispute (Buyer)
- `PATCH  /purchase-orders/:id/cancel` — Cancel PO (Buyer, only if DRAFT/SENT)

### Payment Locks (Simulated Open Banking)
- `POST   /payment-locks` — Lock funds for a PO (Buyer)
- `GET    /payment-locks/:poId` — Get lock status
- `POST   /payment-locks/:id/release` — Release funds (system-triggered)

### Early Payment
- `POST   /early-payments/request` — Request early payment (Supplier)
- `GET    /early-payments` — List requests (role-filtered)
- `GET    /early-payments/:id` — Request detail
- `PATCH  /early-payments/:id/approve` — Approve & fund (LP)
- `PATCH  /early-payments/:id/reject` — Reject (LP)

### Settlements
- `GET    /settlements` — List settlements (role-filtered)
- `GET    /settlements/:id` — Settlement detail

### Simulated Bank
- `GET    /bank/balance` — Get simulated balance
- `GET    /bank/transactions` — Simulated bank ledger

### Verification & Ledger
- `POST   /ledger/challenge` — Request a signing challenge (returns WebAuthn options)
- `POST   /ledger/events` — Submit signed assertion to append event
- `GET    /ledger/:entityId/chain` — Full event chain for an entity
- `GET    /ledger/:entityId/verify` — Verify chain integrity
- `GET    /ledger/:entityId/bundle` — Verification bundle (for LP review)
- `GET    /ledger/events` — Paginated global event feed (Admin)

### Admin
- `GET    /admin/metrics` — Platform metrics
- `GET    /admin/audit-log` — Full audit trail (backed by ledger)
- `GET    /admin/users` — All users

---

## 7. Key Workflows (Implementation Detail)

### 7.1 PO Creation → Payment Lock

```
Buyer creates PO (DRAFT)
  → Buyer sends PO to Supplier (SENT)
  → Buyer locks payment via simulated Open Banking (PaymentLock: LOCKED)
  → PO status: SENT + payment_locked: true
```

### 7.2 Supplier Accepts → Work Begins

```
Supplier views PO with "Payment Guaranteed" badge
  → Supplier accepts (PO: ACCEPTED → IN_PROGRESS)
  → Supplier optionally sees "Get paid early" CTA
```

### 7.3 Early Payment Flow

```
Supplier clicks "Get paid now"
  → System calculates:
      face_value: PO amount
      service_fee: flat fee (configured per transaction tier)
      net_advance: face_value - service_fee
  → EarlyPaymentRequest created (REQUESTED)
  → LP reviews request:
      - Sees PO details, lock status, conditions
      - Acknowledges delivery risk (risk_acknowledged: true)
      - Approves → funds advanced to supplier (FUNDED)
      - Supplier balance += net_advance
      - LP balance -= net_advance
  → PO continues normally (supplier still delivers)
```

### 7.4 Delivery Verification → Settlement

```
Supplier marks as delivered (PO: DELIVERED)
  → Buyer verifies (PO: VERIFIED)
     OR auto-accept after acceptance_window expires (BullMQ scheduled job)
  → Settlement triggered:

  If NO early payment:
    → Buyer funds → Supplier (STANDARD settlement)
    → PaymentLock: RELEASED

  If early payment occurred:
    → Buyer funds → Liquidity Partner (EARLY_PAY_SETTLEMENT)
    → PaymentLock: RELEASED
    → EarlyPaymentRequest: SETTLED

  → PO: SETTLED
  → PlatformFee recorded
  → AuditLog entries created
```

### 7.5 Dispute / Non-Delivery

```
Buyer disputes delivery (PO: DISPUTED)
  → If early payment was funded:
      → EarlyPaymentRequest: DEFAULTED
      → LP absorbs loss (no guaranteed repayment)
      → PaymentLock: REFUNDED → funds return to buyer
  → AuditLog records dispute
```

> **This is critical**: the LP bears real risk. If delivery fails, the LP does not get paid. This is by design.

---

## 8. Implementation Plan — User Stories & Tasks

### Phase 0: Project Scaffolding (Sprint 0)

| #   | Story                                      | Description                                                         |
| --- | ------------------------------------------ | ------------------------------------------------------------------- |
| 0.1 | Docker Compose setup                       | PostgreSQL + Redis (2 containers only)                              |
| 0.2 | NestJS project init                        | Modules, Prisma, BullMQ, Swagger, env config                       |
| 0.3 | Next.js project init                       | App Router, Tailwind, shadcn/ui, TanStack Query, Zod               |
| 0.4 | Prisma schema & migrations                 | Full data model, seed script (demo users, balances)                 |
| 0.5 | Shared validation schemas                  | Zod schemas in a shared package or synced                           |
| 0.6 | Auth integration                           | Passport.js + bcrypt + JWT. Role guards in NestJS, protected routes in Next.js |

### Phase 0.5: Cryptographic Ledger Foundation (Sprint 0)

| #    | Story                                                 | Description                                                                                |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0.7  | Passkey registration on signup                    | WebAuthn credential creation on registration. Public key stored, private key stays in device hardware. |
| 0.8  | Append-only event log table                            | PostgreSQL table with INSERT-only permissions, DB triggers to block UPDATE/DELETE.           |
| 0.9  | Hash chain enforcement trigger                         | DB trigger validates previous_hash matches last event's hash on every INSERT.               |
| 0.10 | Ledger service (challenge → sign → append → verify) | Two-step signing: backend issues challenge, frontend triggers passkey biometric, backend verifies assertion + appends. |
| 0.11 | Verification bundle endpoint                           | GET /ledger/:entityId/bundle — returns full chain + actor public keys + integrity check.     |

> **This phase underpins all subsequent phases.** Every PO state change, payment lock, and settlement will be recorded as a signed, hash-chained event.

### Phase 1: Core Purchase Order Flow (Sprint 1)

| #   | Story                                                 | Description                                                                                |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1.1 | Buyer can create a purchase order                      | Form: supplier, items, amount, conditions, acceptance window. Saves as DRAFT.              |
| 1.2 | Buyer can send PO to supplier                          | PO transitions DRAFT → SENT. Supplier notified.                                           |
| 1.3 | Supplier can view incoming POs                         | List view with status filters. Shows payment lock status.                                  |
| 1.4 | Supplier can accept a PO                               | PO transitions SENT → ACCEPTED → IN_PROGRESS.                                             |
| 1.5 | Buyer can cancel a PO                                  | Only if DRAFT or SENT. Refunds lock if exists.                                             |
| 1.6 | PO detail page with status timeline                    | Visual timeline showing each status transition with timestamps.                            |

### Phase 2: Payment Locking (Simulated Open Banking) (Sprint 1)

| #   | Story                                                 | Description                                                                                |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 2.1 | Simulated Open Banking service                         | Mock: account lookup, balance check, fund reservation, fund release.                       |
| 2.2 | Buyer can lock payment for a PO                        | Triggers simulated bank hold. PaymentLock created. PO shows "Payment Guaranteed".          |
| 2.3 | Locked funds are reflected in buyer's balance           | Simulated balance decreases by locked amount. Cannot double-spend.                         |
| 2.4 | Payment lock visible to supplier                        | Supplier sees verified "Funds Locked" badge on PO.                                        |

### Phase 3: Delivery & Verification (Sprint 2)

| #   | Story                                                 | Description                                                                                |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 3.1 | Supplier can mark PO as delivered                      | PO transitions IN_PROGRESS → DELIVERED. Buyer notified.                                   |
| 3.2 | Buyer can verify delivery                              | PO transitions DELIVERED → VERIFIED. Triggers settlement.                                 |
| 3.3 | Auto-acceptance after window expires                   | BullMQ delayed job: if buyer doesn't act within acceptance window, auto-verify.            |
| 3.4 | Buyer can dispute delivery                             | PO transitions DELIVERED → DISPUTED. Locks settlement.                                    |

### Phase 4: Settlement Engine (Sprint 2)

| #   | Story                                                 | Description                                                                                |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 4.1 | Standard settlement (no early payment)                 | On verification: unlock funds, transfer Buyer → Supplier, record fee.                     |
| 4.2 | Settlement creates audit log entries                    | Every fund movement logged with actor, timestamp, amounts.                                |
| 4.3 | Simulated bank transactions                            | Both parties see ledger entries in their "bank" view.                                     |
| 4.4 | Platform fee deduction                                 | Configurable transaction fee deducted and recorded.                                       |

### Phase 5: Early Payment (Liquidity) (Sprint 3)

| #   | Story                                                 | Description                                                                                |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 5.1 | Supplier sees "Get paid early" option                  | Available when PO is ACCEPTED/IN_PROGRESS and payment is locked.                          |
| 5.2 | Supplier can request early payment                     | Shows: face value, service fee, net amount. Supplier confirms.                            |
| 5.3 | LP dashboard shows pending requests                    | LP can review PO details, lock status, delivery conditions, risk.                         |
| 5.4 | LP can approve/fund early payment                      | LP acknowledges risk → funds advanced to supplier → balances update.                      |
| 5.5 | LP can reject early payment request                    | Supplier notified. Can still wait for standard settlement.                                |
| 5.6 | Settlement with early payment (LP receives funds)      | On verification: Buyer funds → LP. EarlyPaymentRequest: SETTLED.                         |
| 5.7 | Dispute with early payment (LP absorbs loss)           | On dispute: LP does NOT get reimbursed. Request: DEFAULTED. Buyer refunded.               |

### Phase 6: Dashboards & Analytics (Sprint 3)

| #   | Story                                                 | Description                                                                                |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 6.1 | Buyer dashboard                                        | Active POs, total locked, pending verifications, recent activity.                          |
| 6.2 | Supplier dashboard                                     | Incoming POs, cashflow summary, early-pay savings, recent activity.                       |
| 6.3 | LP dashboard                                           | Active portfolio, total advanced, returns, risk exposure.                                 |
| 6.4 | Admin dashboard                                        | Platform volume, total fees, user count, transaction breakdown.                           |
| 6.5 | Audit trail viewer (Admin)                             | Searchable, filterable log of all platform events.                                        |

### Phase 7: Polish & Demo Readiness (Sprint 4)

| #   | Story                                                 | Description                                                                                |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 7.1 | Real-time notifications                                | Server-Sent Events (SSE): PO status changes, payment events pushed to UI.                 |
| 7.2 | Demo seed script                                       | Pre-populated scenario: 2 buyers, 2 suppliers, 1 LP, sample POs in various states.       |
| 7.3 | Responsive design pass                                 | Mobile-friendly layouts for all pages.                                                    |
| 7.4 | Error handling & loading states                        | Proper error boundaries, skeleton loaders, toast notifications.                           |
| 7.5 | README & demo walkthrough                              | Setup instructions, demo script with suggested click-through.                             |

---

## 9. Folder Structure

```
sme-payments/
├── docs/                          # Existing documentation
├── docker-compose.yml             # PostgreSQL, Redis, Supabase
├── packages/
│   └── shared/                    # Shared Zod schemas, types, constants
│       ├── src/
│       │   ├── schemas/           # Zod validation schemas
│       │   ├── types/             # TypeScript interfaces
│       │   └── constants/         # Fee tiers, status enums
│       ├── package.json
│       └── tsconfig.json
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── auth/                  # Auth module (Supabase JWT guard)
│   │   ├── users/                 # User management
│   │   ├── purchase-orders/       # PO CRUD + state machine
│   │   ├── payment-locks/         # Simulated Open Banking
│   │   ├── early-payments/        # Early payment requests
│   │   ├── settlements/           # Settlement engine
│   │   ├── bank/                  # Simulated bank/ledger
│   │   ├── ledger/                 # Append-only event ledger (hash chain + WebAuthn signatures)
│   │   ├── passkeys/               # WebAuthn passkey registration + assertion
│   │   ├── admin/                 # Admin endpoints
│   │   ├── notifications/         # Real-time events
│   │   └── common/                # Guards, decorators, pipes, filters
│   ├── package.json
│   ├── tsconfig.json
│   └── nest-cli.json
├── frontend/
│   ├── src/
│   │   ├── app/                   # Next.js App Router
│   │   │   ├── (auth)/            # Login, Register
│   │   │   ├── (dashboard)/       # Role-based layouts
│   │   │   │   ├── buyer/
│   │   │   │   ├── supplier/
│   │   │   │   ├── lp/
│   │   │   │   └── admin/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── components/
│   │   │   ├── ui/                # shadcn/ui primitives
│   │   │   ├── purchase-orders/   # PO-specific components
│   │   │   ├── payments/          # Payment-related components
│   │   │   ├── dashboard/         # Dashboard widgets
│   │   │   └── layout/            # Nav, sidebar, header
│   │   ├── lib/
│   │   │   ├── api.ts             # API client (fetch wrapper)
│   │   │   ├── sse.ts             # SSE client for real-time events
│   │   │   ├── hooks/             # Custom React hooks
│   │   │   └── utils.ts           # Formatting, helpers
│   │   └── styles/
│   │       └── globals.css
│   ├── package.json
│   ├── tailwind.config.ts
│   ├── next.config.js
│   └── tsconfig.json
└── README.md
```

---

## 10. Demo Scenario (Walkthrough)

For reviewers/judges, the demo should tell a story:

1. **Login as Buyer (Acme Retail Ltd)**
   - Dashboard shows 0 active POs
   - Click "New Purchase Order"
   - Select supplier: "Swift Logistics Ltd"
   - Enter: "Warehouse logistics support", £20,000, acceptance window 48h
   - Submit → PO created (DRAFT)

2. **Lock Payment**
   - On PO detail, click "Lock Payment"
   - Simulated Open Banking flow: confirm bank, authorise £20,000
   - Balance shows £20,000 reserved
   - PO shows "Payment Guaranteed" ✓
   - Send PO to supplier

3. **Switch to Supplier (Swift Logistics Ltd)**
   - Dashboard shows 1 incoming PO
   - View PO: see guaranteed payment, conditions
   - Click "Accept Order" → status: IN_PROGRESS
   - See "Get Paid Early" button → click it
   - Screen shows: £20,000 face value, £500 service fee, £19,500 today
   - Click "Request Early Payment"

4. **Switch to Liquidity Partner**
   - Dashboard shows 1 pending request
   - Review: PO details, payment lock verified, delivery conditions
   - Acknowledge risk → Approve
   - £19,500 transferred to supplier

5. **Back to Supplier**
   - Balance shows +£19,500
   - Mark order as "Delivered"

6. **Back to Buyer**
   - Notification: "Delivery pending verification"
   - Review and click "Verify Delivery"

7. **Settlement**
   - Automatic: £20,000 moves from buyer → liquidity partner
   - Supplier already paid
   - Platform fee recorded
   - All parties see completed transaction in their ledger

8. **Admin View**
   - Total volume: £20,000
   - Platform fees earned
   - Full audit trail visible

---

## 11. Non-Functional Requirements

| Concern          | Approach                                                           |
| ---------------- | ------------------------------------------------------------------ |
| Security         | Passport.js JWT auth, role-based guards, bcrypt passwords, Zod validation |
| Data integrity   | DB transactions for all fund movements, optimistic locking on POs  |
| Auditability     | Every state change logged with actor + timestamp                   |
| Testability      | Unit tests for settlement logic, E2E for critical flows            |
| Demo-ability     | Seed script, quick-start docker, demo walkthrough README           |

---

## 12. Core Innovation: Cryptographic Verification

See **[technical-verification.md](./technical-verification.md)** for the full technical design covering:

- **WebAuthn / FIDO2 Passkeys** — every event signed by the acting party's hardware (Secure Enclave / TPM) with biometric authentication. Private keys never leave the device.
- **SHA-256 hash chain** — tamper-evident, append-only event history
- **PostgreSQL append-only enforcement** — INSERT only at DB level with triggers
- **Verification bundles** — LP receives cryptographic proof, not just a database flag
- **No blockchain needed** — same guarantees, zero overhead

This is what makes "pre-verified receivables" possible. The LP doesn't trust the platform — the platform *cannot forge* a user's signature because it never has their private key.

---

## 13. Out of Scope (for MVP)

- Real Open Banking integration (Plaid, TrueLayer, etc.)
- Real KYC/AML checks
- Multi-currency support
- File attachments on POs
- Mobile native apps
- CBDC / blockchain integration
- Multi-milestone POs (single delivery milestone only)
- Crowdfunding / retail investor features (explicitly excluded per brief)

---

## 14. Risk Register

| Risk                                    | Mitigation                                              |
| --------------------------------------- | ------------------------------------------------------- |
| Docker / local env issues               | Minimal footprint: only 2 containers (PostgreSQL + Redis) |
| Scope creep on UI polish                | shadcn/ui gives production-quality defaults fast         |
| Settlement logic bugs                   | Comprehensive unit tests, idempotent operations          |
| Demo data feels unrealistic             | Realistic seed script with UK company names and amounts  |
