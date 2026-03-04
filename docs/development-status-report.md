# Development Status Report — Programmable SME Settlement Platform

**Date:** 3 March 2026
**Status:** Feature-complete for controlled KSA pilot
**Backend tests:** 205 passing across 16 suites (zero failures)
**Codebase:** ~14,400 lines TypeScript (backend) · ~8,800 lines TypeScript/TSX (frontend) · 94 backend source files · 47 frontend source files

---

## 1. What We Built

A full-stack procurement-to-pay platform that enables a **buyer** to create purchase orders, a **supplier** to fulfill and optionally request early payment, and a **liquidity partner** to fund early payments under Sharia-compliant structures — all settled through pluggable bank rails with a cryptographically verifiable audit trail.

The system is designed from the ground up for the **KSA market** with SAR currency support, 15% VAT calculations, SARIE bank rail integration, and KSA Personal Data Protection Act (PDPA) compliance.

---

## 2. Architecture

### Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Backend** | NestJS 10.3, TypeScript 5.4, Prisma 5.22 | Modular enterprise framework with type-safe ORM |
| **Frontend** | Next.js 16, React 19, TanStack Query 5, Tailwind 4, shadcn/ui | Server-side rendering, modern component library |
| **Database** | PostgreSQL 15 | Transactional integrity, JSONB for flexible schemas |
| **Cache/Queue** | Redis 7, BullMQ | Challenge store, async settlement jobs |
| **Authentication** | JWT + WebAuthn/FIDO2 passkeys | Hardware-bound signatures, zero key management |
| **API** | REST with OpenAPI/Swagger auto-documentation | 95 endpoints across 19 controllers |

### Data Model

**18 Prisma models** and **24 enums** covering the full procurement-to-pay lifecycle:

- `User`, `Organisation`, `OrgMembership` — multi-tenant RBAC
- `PolicyRule`, `ApprovalRequest`, `Approval` — configurable governance
- `PurchaseOrder` — 30+ fields including payment terms, delivery terms, tax, acceptance windows, import metadata
- `PaymentLock`, `EarlyPaymentRequest`, `Settlement` — escrow and settlement
- `EventLog` — SHA-256 hash-chained append-only ledger
- `EvidenceAttachment` — file-backed proof with content hashing
- `Dispute`, `FraudFlag`, `LpExposureSnapshot` — risk and dispute management
- `UserPasskey` — WebAuthn credential storage
- `Invitation`, `PlatformFee` — onboarding and fee tracking

---

## 3. Phase-by-Phase Delivery

### Phase 0 — Multi-Tenancy Foundation (38 tests)

**What:** Transformed the single-tenant demo into an organisation-based multi-tenant system.

**Delivered:**
- `Organisation` model with type (BUYER / SUPPLIER / LIQUIDITY_PARTNER), jurisdiction (UK / KSA), currency (GBP / SAR), Sharia-compliance flag
- `OrgMembership` with RBAC roles: OWNER, APPROVER, FINANCE, MEMBER
- Automatic org creation on user registration with jurisdiction-aware defaults
- Admin and LP registration endpoints (previously seed-only)
- Currency-aware minimum order amounts (£500 GBP / SAR 1,875)

**Why it matters:** Every downstream feature (policies, approvals, settlement, risk) depends on knowing which organisation a user belongs to and what rules apply to that org.

---

### Phase 1 — Policy Engine & Approval Workflows (39 tests, cumulative: 77)

**What:** Replaced hardcoded approval logic with a configurable policy engine.

**Delivered:**
- `PolicyRule` model: event-type triggers, threshold conditions (minAmount/maxAmount), required approval count, required org roles, auto-approve flags
- Full CRUD for policy rules scoped to organisations
- `ApprovalRequest` / `Approval` workflow: create request → vote (APPROVE/REJECT) → auto-resolve when quorum reached
- Time-based expiry on approval requests (configurable hours)
- Role-gated voting (only users with the required org role can approve)
- Duplicate vote prevention, expired request rejection

**IP value:** The policy engine is **data-driven, not code-driven**. A buyer org can configure "POs above SAR 50,000 require 2 approvals from FINANCE + OWNER" without any code changes. This is the foundation for white-labelling the platform for different industries and jurisdictions.

---

### Phase 2 — Secure Actor Onboarding (34 tests, cumulative: 111)

**What:** Production-grade onboarding flows for all three actor types.

**Delivered:**
- **Buyer onboarding:** Org creation → KYB-lite verification (CR number, authorized signatory) → payment method → approval policies → team invitations
- **Supplier tiered onboarding:**
  - *Tier 1 (basic):* CR number + bank IBAN + platform terms + passkey → can receive POs
  - *Tier 2 (liquidity-eligible):* KYB verification + sanctions check → can request early payment
- **LP onboarding:** Partner profile + funding limits + risk appetite config + participation agreement
- **Invite flow:** Buyer invites suppliers via 1-click token link; LP invited by platform admin
- **KYB service:** Abstract interface with mock provider (pluggable for Wathq API in production)
- Onboarding status tracking per organisation with step-by-step progress

**IP value:** Tiered supplier onboarding is a **key differentiator**. Suppliers who never want early payment only go through basic onboarding — reducing friction to near zero. Only those who opt into liquidity features face heavier compliance.

---

### Phase 3 — Settlement Adapter Layer (38 tests, cumulative: 149)

**What:** Replaced the simulated balance system with a pluggable settlement architecture.

**Delivered:**
- **`SettlementAdapter` interface:** `reserveFunds()`, `releaseFunds()`, `transferFunds()`, `refund()`, `reconcile()` — clean abstraction over any payment rail
- **`SimulatedAdapter`:** Wraps existing balance logic for demo mode
- **`KSABankTransferAdapter`:** Integration with KSA bank rails
  - Amounts in halalah (1 SAR = 100 halalah)
  - References prefixed with `SARIE-`
  - Automatic routing: amounts ≥ SAR 20,000 go through SARIE RTGS, smaller via domestic ACH
  - 200ms simulated network latency
  - Failure injection via `SA00FAIL` IBAN prefix for testing error paths
  - Full reconciliation with reference tracking
- **Adapter factory:** Runtime selection based on jurisdiction/currency
- **13 dedicated adapter tests** covering reserve, release, transfer, refund, reconciliation, failure paths, and SARIE threshold routing

**IP value:** The adapter pattern means we can **swap bank partners without touching business logic**. The same PO lifecycle code works identically whether settlement runs through SARIE, a UK Open Banking API, or a future CBDC rail. This is architecturally rare in fintech MVPs.

---

### Phase 4 — Real-World PO & Evidence System (17 tests, cumulative: 166)

**What:** Made purchase orders production-grade and added an auditable evidence system.

**Delivered:**
- **Extended PO schema (30+ fields):**
  - External PO number (buyer's ERP reference)
  - Payment terms: IMMEDIATE, NET_30, NET_60, NET_90
  - Delivery terms: EX_WORKS, FOB, CIF, DDP, CUSTOM
  - Tax rate (BPS), tax amount, gross amount
  - Acceptance type, acceptance window (hours), dispute window (hours)
  - Partial acceptance support (allowed flag + accepted line items JSON)
  - Import metadata: source (CSV/PDF/MANUAL), batch ID, imported timestamp, attachment URL
- **CSV import engine:**
  - Header validation, multi-row PO grouping by external PO number
  - Automatic line item aggregation, batch tracking
  - Error-per-group reporting (partial imports succeed even if some POs fail)
- **Evidence service:**
  - File upload with SHA-256 content hashing for tamper detection
  - 8 evidence types: delivery note, signed receipt, photo proof, invoice, inspection report, shipping document, PO document, other
  - 10 MB max file size, MIME type whitelist (PDF, JPEG, PNG, WebP, CSV, XLSX)
  - Linked to ledger events for full traceability
  - Evidence pack export: per-PO JSON bundle with all events + evidence + hash verification status

**IP value:** The evidence pack is a **productised audit trail**. Each PO generates a self-verifying bundle that includes who signed what, when, with what cryptographic proof, and what documentary evidence was attached. This is what makes the platform credible to LP risk teams and regulators.

---

### Phase 5 — Dispute Resolution & Risk Controls (30 tests, cumulative: 196)

**What:** Handles failure modes so the system is trustworthy with real money.

**Delivered:**
- **Dispute workflow:**
  - Raise dispute (within dispute window) → submit evidence (both sides) → admin review → resolve
  - 4 outcomes: `ACCEPTED` (full refund to buyer), `REJECTED` (release to supplier), `PARTIAL_REFUND`, `REWORK`
  - Settlement actions execute automatically on resolution (refund, partial refund, or release)
  - All dispute events logged to the immutable ledger
- **Fraud controls service:**
  - Velocity limits: max POs per buyer per day, max daily value per buyer
  - Supplier velocity limits: max POs per supplier per day
  - Supplier whitelist enforcement
  - Mandatory evidence threshold: POs above a configurable amount require evidence attachments
  - Runtime-configurable (no restart needed)
  - All violations logged as `FraudFlag` records with severity levels
- **LP risk service:**
  - Real-time exposure calculation per liquidity partner
  - Buyer concentration tracking (configurable max %, default 30%)
  - Supplier concentration tracking (configurable max %, default 40%)
  - Auto-suspension when utilisation exceeds threshold (default 95%)
  - Warning alerts at configurable threshold (default 80%)
  - Exposure snapshot history for trend analysis
  - Check-funding gate: blocks early payment requests that would breach limits

**IP value:** The combination of **configurable fraud controls + LP risk management + dispute resolution with automatic settlement** is the risk infrastructure that banks and LPs require before participating. This isn't a demo feature — it's the compliance skeleton of a regulated product.

---

### Phase 6 — Production Hardening (9 tests, cumulative: 205)

**What:** Security, observability, and compliance hardening for real-world deployment.

**Delivered:**
- **Redis challenge store:** WebAuthn challenges moved from in-memory Map to Redis with TTL — survives server restarts, supports horizontal scaling. Falls back to in-memory for tests/development.
- **Correlation IDs:** Every request gets a UUID (`x-correlation-id` header) — generated if not provided, echoed back in response. Enables distributed tracing across services and logs.
- **Rate limiting:** `@nestjs/throttler` with two tiers — 20 requests/second (burst) and 100 requests/minute (sustained). Prevents brute-force and abuse.
- **Security headers:** Helmet middleware adds `X-Content-Type-Options: nosniff`, `X-Frame-Options`, Content-Security-Policy, and other OWASP-recommended headers.
- **Health endpoint:** `GET /api/health` with database connectivity check via `@nestjs/terminus`. Returns structured status with per-dependency health.
- **PDPA compliance:**
  - `GET /api/pdpa/export` — full personal data export (Subject Access Request). Returns all PII + transactional data for the authenticated user. Password hash explicitly excluded.
  - `DELETE /api/pdpa/erase` — pseudonymisation (Right to Erasure). Replaces PII with placeholders, deletes passkeys and invitations, retains transactional records for audit.
- **Frontend health indicator:** Polls `/api/health` every 30 seconds, shows green/red badge with tooltip in the dashboard sidebar.

**IP value:** PDPA data export and erasure are **regulatory requirements** for KSA operations. Having them built-in from day one, rather than retrofitted, demonstrates regulatory awareness that is rare in early-stage platforms.

---

## 4. Cryptographic Audit Trail — The Core IP

The ledger is the centrepiece of the platform's intellectual property.

### How it works

1. **Every state change** across the entire PO lifecycle (creation, approval, payment lock, delivery, acceptance, settlement, dispute) writes an `EventLog` record.
2. Each event includes:
   - **Entity reference** (PO ID, dispute ID, etc.)
   - **Actor** (who did it, with what role)
   - **Payload** (full state snapshot at that moment)
   - **Canonical payload hash** — SHA-256 of the JSON payload with keys sorted deterministically. This means the same payload always produces the same hash, even if retrieved from PostgreSQL JSONB (which doesn't preserve key order).
   - **Previous hash** — pointer to the prior event's hash, forming a **hash chain** (conceptually similar to a blockchain but without the overhead).
   - **Actor signature** — when the actor has a passkey, the event is signed using their WebAuthn credential. The signature is over an **intent hash** that cryptographically binds the business action to the approval.
3. The `verifyChain()` function can walk the entire chain and confirm:
   - No event has been tampered with (payload hash matches)
   - Chain links are unbroken (each previousHash matches the prior event)
   - Signatures are present where expected

### Why this is defensible IP

- **Self-contained proof:** Each event carries enough information to verify itself without external infrastructure. No blockchain node needed.
- **Passkey-bound signatures:** The actor's hardware authenticator signs the transaction, not just a software key. This provides non-repudiation that is legally meaningful.
- **Evidence-grade bundles:** The evidence pack export combines the hash chain + passkey signatures + documentary evidence (PDFs, photos) into a single verifiable package. This is productisation of audit infrastructure.

---

## 5. What's Not Built Yet

| Area | Status | Notes |
|------|--------|-------|
| Real SARIE bank API integration | Simulated | Adapter interface is ready; needs partner bank credentials |
| Real KYB provider (Wathq) | Mock | Interface is pluggable; needs Wathq API key |
| CI/CD pipeline | Not started | No GitHub Actions / deployment automation |
| Browser-level E2E tests | Not started | Backend has 205 E2E + unit tests; no Cypress/Playwright |
| SSE / WebSocket notifications | Not started | Dashboard requires manual refresh |
| PDF evidence pack export | Not started | Currently JSON only |
| Reconciliation exception queue | Not started | BullMQ is wired; async reconciliation worker not built |
| Dashboard analytics charts | Not started | Recharts is in the plan; no graphs yet |

---

## 6. Test Coverage Summary

| Suite | Tests | What it covers |
|-------|-------|---------------|
| Auth E2E | 16 | Registration (UK/KSA), login, JWT validation, role checks, jurisdiction-aware org creation |
| Organisations E2E | 26 | CRUD, membership, KYB status, admin ← → org linking |
| Approvals E2E | 17 | Multi-approver chains, quorum, expiry, role-gated voting |
| Onboarding E2E | 14 | Buyer/Supplier Tier1/Tier2/LP onboarding flows, KYB verification |
| Settlements E2E | 12 | Full PO lifecycle settlement, early payment settlement, multi-currency |
| KSA Bank Adapter | 13 | Reserve, release, transfer, refund, reconciliation, SARIE routing, failure paths |
| Evidence E2E | 10 | Upload, hash verification, evidence pack export, PO-scoped queries |
| Disputes E2E | 30 | Raise, evidence submission, review, all 4 outcomes with settlement actions |
| Hardening E2E | 9 | Health check, correlation IDs, security headers, PDPA export/erase, rate limiting |
| Unit tests (7 suites) | 58 | Auth service, approvals service, organisations service, policies service, settlements service, onboarding service, KYB service |
| **Total** | **205** | **16 suites, 0 failures** |

---

## 7. API Surface

**19 controllers, 95 endpoints.** Full Swagger documentation at `/api/docs`.

| Controller | Key Endpoints |
|-----------|---------------|
| `auth` | Register, login (with jurisdiction + org auto-creation) |
| `organisations` | CRUD, membership, settings, KYB status |
| `policies` | CRUD policy rules per org, evaluate policies |
| `approvals` | Create approval request, vote, list pending/by-entity |
| `onboarding` | Status check, buyer/supplier-tier1/supplier-tier2/LP completion |
| `invitations` | Create, accept, list (sent/received), cancel |
| `purchase-orders` | Full lifecycle (create→send→accept→deliver→verify→settle), CSV import, partial acceptance |
| `payment-locks` | Lock, release, status check |
| `early-payments` | Request, fund, settle |
| `settlements` | Settle PO, refund PO, list by PO |
| `evidence` | Upload, list by PO, get, delete, export pack |
| `disputes` | Raise, submit evidence, review, resolve (with auto-settlement) |
| `risk` | LP exposure report, check funding, snapshots, fraud config, fraud checks |
| `ledger` | List events, verify chain integrity |
| `admin` | Platform stats, user management |
| `users` | List users, balance check |
| `passkeys` | Register, authenticate, list, delete |
| `health` | DB connectivity check |
| `pdpa` | Data export, data erasure |

---

## 8. Frontend Pages

**15 dashboard pages** with role-gated navigation:

- **Dashboard** — role-aware overview
- **Onboarding** — step-by-step guides per actor type
- **Purchase Orders** — list, detail, create, CSV import
- **Payment Locks** — lock/release escrow
- **Early Payments** — request/fund/settle
- **Settlements** — transaction history
- **Approvals** — pending approvals, vote
- **Invitations** — send/accept/manage
- **Ledger** — full event log with hash verification
- **Evidence** — upload/view per PO
- **Disputes** — raise, submit evidence, resolve
- **Risk** — LP exposure dashboard, fraud controls
- **Admin** — platform-wide management
- **Login** — quick-select demo accounts per role and jurisdiction

---

## 9. Is This Real IP?

### What makes this defensible

1. **The ledger + passkey signature system.** Cryptographic hash chains with hardware-bound signatures provide non-repudiation at a level that most B2B payment platforms don't attempt. The canonical JSON hashing ensures verify-after-read works correctly even across different database storage engines.

2. **The pluggable settlement adapter.** Most fintech MVPs hardcode their payment rail. Our adapter interface (`reserveFunds → releaseFunds → transferFunds → refund → reconcile`) means the same business logic runs on any rail — SARIE, Open Banking, or future CBDC — with zero code changes.

3. **Tiered onboarding with configurable risk controls.** The combination of Tier 1/Tier 2 supplier onboarding with per-LP concentration limits, velocity-based fraud controls, and auto-suspension thresholds is the infrastructure that makes LP participation viable. Without this, no regulated entity can onboard.

4. **Data-driven policy engine.** Approval workflows are configured through data (policy rules with conditions and required roles), not code. This means the platform can serve different industries, org sizes, and jurisdictions without forking the codebase.

5. **Evidence-grade audit bundles.** The per-PO evidence pack — combining hash chain verification, passkey signatures, and documentary evidence with SHA-256 content hashes — is a productised audit trail that has standalone commercial value.

### What's not defensible (yet)

- UI/UX is functional but not differentiated — standard shadcn/ui components
- No patents filed on the hash chain or adapter pattern
- The KSA bank integration is simulated — real SARIE integration would create significant switching costs

---

## 10. Metrics at a Glance

| Metric | Value |
|--------|-------|
| Backend source files | 94 |
| Frontend source files | 47 |
| Backend lines of code | ~14,400 |
| Frontend lines of code | ~8,800 |
| Prisma models | 18 |
| Prisma enums | 24 |
| API endpoints | 95 |
| Controllers | 19 |
| NestJS modules | 20 |
| Dashboard pages | 15 |
| Automated tests | 205 |
| Test suites | 16 |
| Test pass rate | 100% |
| Schema lines | 656 |
| npm dependencies (runtime) | 23 |
| Development phases completed | 7 (0–6) |

---

## 11. What's Next

The platform is **feature-complete for a controlled pilot**. Remaining work falls into three categories:

**To go live with a real pilot:**
1. Integrate real SARIE bank API (swap adapter credentials)
2. Wire Wathq API for KSA CR validation (replace mock KYB provider)
3. Deploy to staging (CI/CD, TLS, domain)
4. Recruit anchor buyer + 5–20 suppliers + 1 LP

**To strengthen the product:**
1. Real-time notifications (SSE/WebSocket)
2. PDF evidence pack export
3. Dashboard analytics (Recharts)
4. Reconciliation exception queue (async BullMQ worker)

**To strengthen the IP position:**
1. File provisional patent on hash-chain + passkey signature verification method
2. Benchmark evidence pack against ISO 27001 and SAMA requirements
3. Commission independent security audit
