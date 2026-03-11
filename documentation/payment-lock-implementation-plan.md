# Payment Lock Infrastructure — Implementation Plan

**Created:** 11 March 2026  
**Source:** [payment-lock.md](payment-lock.md) (design document)  
**Status:** Planning  

---

## Executive Summary

The payment-lock design document establishes five foundational pillars for institutional-grade trade finance infrastructure:

1. **Immutable event ledger** — ✅ Done (hash chains, Merkle anchoring, Rekor notarization)
2. **Payment instrument layer** — ❌ Not implemented
3. **Bank escrow integration** — ❌ Simulated only
4. **External anchoring** — ✅ Done (Sigstore Rekor)
5. **Financial reconciliation** — ❌ Not implemented

This plan decomposes pillars 2, 3, and 5 into 8 small, independently shippable phases — each with full test coverage.

---

## Current State Audit

| Document Concept | Current State | Gap |
|---|---|---|
| Bank-backed escrow | `SimulatedAdapter` debits/credits `User.balance`; `KSABankTransferAdapter` is a mock with fake refs | No real bank integration; both adapters are in-memory |
| Settlement adapter pattern | Clean `SettlementAdapter` interface with 5 methods, 2 implementations | Pattern is solid — needs async lifecycle |
| PaymentInstrument layer | Does not exist — PO links directly to `PaymentLock` | Missing entirely |
| Async lock (PENDING → LOCKED) | `PENDING` exists in enum but is never used — locks jump to `LOCKED` | Synchronous assumption |
| Bank webhooks | None — no async bank confirmation path | No infrastructure |
| Reconciliation engine | Manual admin-only `POST /settlements/:id/reconcile` — no scheduling, no reporting | Minimal |
| Reconciliation ledger events | `reconcile()` method logs no ledger events | Missing |
| Refund flow | Wired only through `DisputesService.executeDisputeSettlement()` | Works correctly |
| Financial Instrument abstraction | Does not exist | Missing entirely |
| Bank statement reconciliation | Does not exist | Missing entirely |
| LP risk snapshot / marketplace scoring | No risk scoring — marketplace shows raw `REQUESTED` list | Missing |

### Existing Infrastructure (Strengths)

- **`SettlementAdapter` interface** (153 lines) — clean abstraction with `reserveFunds`, `releaseFunds`, `transferFunds`, `refund`, `reconcile`
- **`SettlementService`** (523 lines) — orchestrates locks, settlements, advances, refunds
- **`KSABankTransferAdapter`** (217 lines) — simulates SARIE vs ACH rail selection by amount threshold (≥20k SAR → SARIE)
- **312 tests / 19 suites** — comprehensive safety net including `settlement.service.spec.ts`, `ksa-bank.adapter.spec.ts`, `settlements.e2e-spec.ts`
- **Dispute resolution** correctly calls `refundPO()` for FULL_REFUND and PARTIAL_REFUND outcomes

---

## Phase Plan

### Phase 1 — Async Payment Lock State Machine

**Goal:** Make the lock lifecycle match banking reality — banks are asynchronous systems. The document's core rule: *"Platform state is provisional. Bank state is authoritative."*

**What changes:**

1. Activate the `PENDING` state: `reserveForPO()` creates lock as `PENDING`, then transitions to `LOCKED` on adapter success
2. Add `LOCK_FAILED` to `PaymentLockStatus` enum + Prisma migration
3. New service method `confirmLock(lockId, bankRef)` — transitions `PENDING → LOCKED`
4. New service method `failLock(lockId, reason)` — transitions `PENDING → LOCK_FAILED`
5. Refactor `reserveForPO()`: create lock as `PENDING` → call adapter → on success → `confirmLock()` → on failure → `failLock()`
6. New ledger events: `PAYMENT_LOCK_REQUESTED` (on creation) + `PAYMENT_LOCK_CONFIRMED` (on bank confirmation) — replaces the current single `PAYMENT_LOCK_CONFIRMED`
7. Update tests: unit tests for new state transitions, update existing settlement specs

**Files touched:**
- `backend/prisma/schema.prisma` — add `LOCK_FAILED` to enum
- `backend/prisma/migrations/` — new migration
- `backend/src/settlements/settlement.service.ts` — refactor `reserveForPO()`, add `confirmLock()`, `failLock()`
- `backend/src/settlements/settlement.service.spec.ts` — new/updated tests
- `backend/src/settlements/settlements.e2e-spec.ts` — update assertions

**Size estimate:** ~150 lines changed, ~100 lines new tests  
**Risk:** Low — backward compatible, same end state for happy path  
**Dependencies:** None

---

### Phase 2 — Async Settlement State Machine

**Goal:** Settlement follows `INTENT → PROCESSING → CONFIRMED` pattern, matching the document's rule: *"Never skip the confirmation."*

**What changes:**

1. Add `PROCESSING` to `SettlementStatus` enum + Prisma migration
2. `settlePO()` creates settlement as `PROCESSING` (not `COMPLETED`)
3. New method `confirmSettlement(id, bankRef)` — transitions `PROCESSING → COMPLETED`
4. Refactor `settlePO()`: create as `PROCESSING` → call adapter → on success → `confirmSettlement()` → on failure → mark `FAILED`
5. Same pattern applied to `transferAdvance()` and `refundPO()`
6. New ledger events: `SETTLEMENT_PROCESSING` + `SETTLEMENT_COMPLETED` (two events instead of one)
7. Update all existing E2E tests

**Files touched:**
- `backend/prisma/schema.prisma` — add `PROCESSING` to enum
- `backend/prisma/migrations/` — new migration
- `backend/src/settlements/settlement.service.ts` — refactor 3 methods, add `confirmSettlement()`
- `backend/src/settlements/settlement.service.spec.ts` — new/updated tests
- `backend/src/settlements/settlements.e2e-spec.ts` — update assertions
- `backend/src/disputes/disputes.service.ts` — adapt to async settlement

**Size estimate:** ~200 lines changed, ~150 lines new tests  
**Risk:** Medium — touches settlement flow; existing E2E tests are comprehensive safety net  
**Dependencies:** None (can run in parallel with Phase 1)

---

### Phase 3 — Bank Webhook Handler

**Goal:** Enable asynchronous bank confirmations via callback endpoint, so the platform doesn't assume bank operations succeed synchronously.

**What changes:**

1. New `POST /api/settlements/webhooks/bank-callback` endpoint (no JWT — uses HMAC signature verification)
2. Webhook payload schema: `{ externalRef, status, amount, bankReference, timestamp, signature }`
3. HMAC-SHA256 verification using shared secret (`BANK_WEBHOOK_SECRET` env var)
4. Handler logic: look up settlement/lock by `externalRef` → call `confirmLock()` or `confirmSettlement()` or `failLock()`
5. Idempotency: if already in target state, return 200 OK (no-op)
6. Ledger event: `BANK_WEBHOOK_RECEIVED` logged for every callback
7. KSA adapter updated to include webhook URL in reserve/release calls (for production readiness)
8. Replay protection: reject webhooks with timestamp > 5 minutes old

**Files touched:**
- `backend/src/settlements/settlements.controller.ts` — new webhook endpoint
- `backend/src/settlements/settlement.service.ts` — new `handleBankCallback()` method
- `backend/src/settlements/settlements.module.ts` — register webhook route
- `backend/src/settlements/ksa-bank.adapter.ts` — accept webhook URL parameter
- New test file: `backend/src/settlements/webhook.spec.ts`

**Size estimate:** ~250 lines new, ~200 lines tests  
**Risk:** Low — new endpoint, doesn't change existing flows  
**Dependencies:** Phases 1 + 2 (needs `confirmLock()` and `confirmSettlement()`)

---

### Phase 4 — Payment Instrument Layer

**Goal:** Introduce the financial abstraction between PO and bank operations. The document's key insight: *"Banks think in terms of financial contracts, not application workflows."* The instrument becomes the asset that LPs invest against.

**What changes:**

1. New Prisma model `PaymentInstrument`:
   ```
   id               UUID (PK)
   purchaseOrderId  String (@unique)
   type             InstrumentType (enum: ESCROW_LOCK)
   amount           Int
   currency         String
   status           InstrumentStatus (enum: CREATED, LOCK_REQUESTED, LOCKED,
                    RELEASE_PENDING, RELEASED, REFUNDED, FAILED)
   escrowReference  String? (bank escrow account ref)
   bankReference    String? (SARIE transaction ref)
   payerAccountRef  String? (buyer IBAN)
   recipientAccountRef String? (supplier/LP IBAN)
   createdAt        DateTime
   lockedAt         DateTime?
   releasedAt       DateTime?
   ```
2. New `InstrumentService` with lifecycle methods:
   - `create(poId, amount, currency, payerRef)` → status `CREATED`
   - `requestLock(id)` → status `LOCK_REQUESTED`, calls adapter
   - `confirmLock(id, bankRef)` → status `LOCKED`
   - `requestRelease(id, recipientRef)` → status `RELEASE_PENDING`
   - `confirmRelease(id, bankRef)` → status `RELEASED`
   - `refund(id, reason)` → status `REFUNDED`
3. Each transition logged as a ledger event on entity type `PAYMENT_INSTRUMENT`
4. `SettlementService.reserveForPO()` now creates instrument first, then delegates to adapter:
   - `instrument.create()` → `instrument.requestLock()` → adapter.reserveFunds() → `instrument.confirmLock()`
5. `SettlementService.settlePO()` uses instrument for release:
   - `instrument.requestRelease()` → adapter.releaseFunds() → `instrument.confirmRelease()`
6. `PaymentLock` keeps working (it references instrument) — no breaking change to existing consumers

**Files touched:**
- `backend/prisma/schema.prisma` — new model + enums
- `backend/prisma/migrations/` — new migration
- New file: `backend/src/settlements/instrument.service.ts`
- `backend/src/settlements/settlement.service.ts` — integrate instrument lifecycle
- `backend/src/settlements/settlements.module.ts` — register new service
- New test file: `backend/src/settlements/instrument.service.spec.ts`
- Updated: `backend/src/settlements/settlements.e2e-spec.ts`

**Size estimate:** ~400 lines new service, ~100 lines migration, ~300 lines tests  
**Risk:** Medium — introduces new entity but wraps existing behavior  
**Dependencies:** Phases 1 + 2 (async state machines)

---

### Phase 5 — Scheduled Reconciliation Engine

**Goal:** Automated, periodic verification that platform state matches bank state. The document states: *"Banks must be able to answer this question without trusting your platform: Does the ledger state match the actual bank balances?"*

**What changes:**

1. New `ReconciliationService` with `@Cron` decorator (configurable interval via `RECONCILIATION_INTERVAL_MINUTES`, default 60)
2. Reconciliation run logic:
   - Pull all instruments in `LOCK_REQUESTED` or `RELEASE_PENDING` state (stuck async operations)
   - Pull all settlements in `PROCESSING` state
   - For each: call `adapter.reconcile(externalRef)`, compare rail status with platform status
   - On match: mark as consistent
   - On mismatch: create `ReconciliationAlert`
3. New Prisma model `ReconciliationReport`:
   ```
   id              UUID (PK)
   runAt           DateTime
   totalChecked    Int
   matched         Int
   mismatches      Int
   alerts          Json (array of {instrumentId, expected, actual, externalRef})
   ledgerBalance   Int? (sum of all LOCKED instruments)
   bankBalance     Int? (from adapter, if supported)
   variance        Int? (difference)
   ```
4. Ledger event: `BANK_RECONCILIATION_COMPLETED` with summary payload
5. Admin endpoints:
   - `GET /api/admin/reconciliation/reports` — paginated history
   - `GET /api/admin/reconciliation/latest` — last report with detail
   - `POST /api/admin/reconciliation/run` — manual trigger (admin only)
6. Stale operation alerts: instruments stuck in `LOCK_REQUESTED` for > 30 minutes flagged

**Files touched:**
- `backend/prisma/schema.prisma` — new model
- `backend/prisma/migrations/` — new migration
- New file: `backend/src/settlements/reconciliation.service.ts`
- `backend/src/settlements/settlements.controller.ts` — new admin endpoints
- `backend/src/settlements/settlements.module.ts` — register service + cron
- New test file: `backend/src/settlements/reconciliation.service.spec.ts`

**Size estimate:** ~350 lines new service, ~100 lines migration, ~250 lines tests  
**Risk:** Low — reads existing data, creates new records, no mutations to core flows  
**Dependencies:** Phase 4 (instruments to reconcile against)

---

### Phase 6 — Reconciliation Dashboard (Frontend)

**Goal:** Admin UI showing bank ↔ platform consistency. The document says: *"Banks want to see: Ledger balance = Bank balance, Variance = 0, Status = VERIFIED. This gives them confidence."*

**What changes:**

1. New page: `/dashboard/admin/reconciliation`
2. Summary card: latest reconciliation report with total checked, matched, mismatches, variance
3. Color-coded status banner: green (all match), amber (pending operations), red (mismatches found)
4. Mismatch detail table: instrument ID, PO reference, expected vs actual status, external ref, age
5. "Run Reconciliation" button for manual trigger (admin only)
6. Historical reports list with timestamps and summary stats
7. Instrument lifecycle viewer: click any instrument to see its full event chain
8. New API methods in `frontend/src/lib/api.ts`: `reconciliationApi.getLatest()`, `.getReports()`, `.runNow()`

**Files touched:**
- New file: `frontend/src/app/dashboard/admin/reconciliation/page.tsx`
- `frontend/src/lib/api.ts` — new reconciliation API methods
- `frontend/src/app/dashboard/layout.tsx` — add sidebar link (admin only)

**Size estimate:** ~350 lines new page, ~50 lines API methods  
**Risk:** Low — read-only UI over new backend endpoints  
**Dependencies:** Phase 5 (reconciliation engine backend)

---

### Phase 7 — LP Risk Snapshot & Enhanced Marketplace

**Goal:** Give LPs real-time, verifiable risk visibility per opportunity. The document states: *"LPs will fund only if: payment locked, buyer identity verified, settlement rail confirmed."*

**What changes:**

1. New `RiskSnapshotService` — computes per-opportunity risk score:
   - **Payment locked?** (instrument status = LOCKED) — weight: 30%
   - **Delivery progress** (PO status: ACCEPTED=1, SHIPPED=2, DELIVERED=3) — weight: 25%
   - **Buyer dispute history** (% of past POs disputed) — weight: 20%
   - **Instrument bank-confirmed?** (has external bank ref) — weight: 15%
   - **Days since PO created** (freshness) — weight: 10%
   - Output: `riskScore` (0–10), `estimatedDefaultProbability` (%)
2. Marketplace endpoint enhanced: `GET /api/early-payments/marketplace` now includes:
   ```json
   {
     "riskScore": 9.1,
     "defaultProbability": 0.3,
     "paymentLocked": true,
     "instrumentStatus": "LOCKED",
     "deliveryStatus": "SHIPPED",
     "buyerDisputeRate": 0.0,
     "bankReference": "SARIE-...",
     "expectedSettlement": "2026-03-15",
     "evidencePackAvailable": true
   }
   ```
3. Evidence pack download link per opportunity — LP can verify before funding
4. Frontend: enhanced LP marketplace view:
   - Risk score badge (green ≥ 8, amber ≥ 5, red < 5)
   - Risk breakdown tooltip
   - "Download Evidence" button per opportunity
   - Sort/filter by risk score

**Files touched:**
- New file: `backend/src/early-payments/risk-snapshot.service.ts`
- `backend/src/early-payments/early-payments.service.ts` — enrich marketplace response
- `backend/src/early-payments/early-payments.module.ts` — register service
- `frontend/src/app/dashboard/early-payments/page.tsx` — LP marketplace enhancement
- New test file: `backend/src/early-payments/risk-snapshot.service.spec.ts`

**Size estimate:** ~300 lines backend, ~200 lines frontend, ~200 lines tests  
**Risk:** Low — enriches existing read-only marketplace  
**Dependencies:** Phase 4 (instrument status data)

---

### Phase 8 — Evidence Pack Integration

**Goal:** Include financial instrument and bank reference data in Trust Envelopes. The document says: *"Your evidence pack must include: PO acceptance, payment lock proof, bank reference, delivery verification."*

**What changes:**

1. Evidence pack builder includes new `paymentInstrument` section:
   ```json
   {
     "paymentInstrument": {
       "instrumentId": "PI-93812",
       "type": "ESCROW_LOCK",
       "amount": 700000,
       "currency": "SAR",
       "status": "RELEASED",
       "escrowReference": "ESCROW-89321",
       "bankReference": "SARIE-89321",
       "lifecycle": [
         { "status": "CREATED", "at": "..." },
         { "status": "LOCKED", "at": "...", "bankRef": "..." },
         { "status": "RELEASED", "at": "...", "bankRef": "..." }
       ]
     }
   }
   ```
2. New `reconciliation` section in evidence pack:
   ```json
   {
     "reconciliation": {
       "lastChecked": "2026-03-11T12:00:00Z",
       "status": "CONSISTENT",
       "bankBalance": 700000,
       "ledgerBalance": 700000,
       "variance": 0
     }
   }
   ```
3. Verification checks extended:
   - **Check 16:** Instrument lifecycle integrity — `CREATED → LOCKED → RELEASED` matches PO lifecycle
   - **Check 17:** Bank reference consistency — instrument.bankRef matches settlement.externalRef
4. CLI verifier updated with new checks
5. Web verification service updated

**Files touched:**
- `backend/src/evidence/evidence.service.ts` — add instrument + reconciliation sections
- `backend/src/evidence/verification.service.ts` — add checks 16 + 17
- `frontend/src/components/evidence-panel.tsx` — display instrument section
- `documentation/platform-technical-reference-2.md` — document new checks
- Updated: `backend/src/evidence/evidence.e2e-spec.ts`

**Size estimate:** ~200 lines backend, ~100 lines verification, ~150 lines tests  
**Risk:** Low — extends existing evidence infrastructure  
**Dependencies:** Phases 4 + 5 (instrument + reconciliation data)

---

## Dependency Graph

```
Phase 1 (async lock) ─────┐
                           ├── Phase 3 (webhooks) ── Phase 5 (recon engine) ── Phase 6 (recon UI)
Phase 2 (async settle) ───┘           │
                                      │
Phase 4 (instruments) ───────────────┘──── Phase 7 (LP risk) ──── Phase 8 (evidence)
```

- **Phases 1 + 2** can run in parallel (independent state machine changes)
- **Phase 3** requires both 1 + 2 (needs `confirmLock()` and `confirmSettlement()`)
- **Phase 4** requires 1 + 2 (instruments wrap async lock/settle)
- **Phases 5–8** are sequential but each is independently shippable

---

## Estimation Summary

| Phase | New Code | Changed Code | Tests | Risk |
|-------|----------|-------------|-------|------|
| 1 — Async lock | ~50 lines | ~100 lines | ~100 lines | Low |
| 2 — Async settle | ~80 lines | ~120 lines | ~150 lines | Medium |
| 3 — Webhooks | ~250 lines | ~30 lines | ~200 lines | Low |
| 4 — Instruments | ~400 lines | ~100 lines | ~300 lines | Medium |
| 5 — Reconciliation | ~350 lines | ~50 lines | ~250 lines | Low |
| 6 — Recon UI | ~400 lines | ~20 lines | — | Low |
| 7 — LP risk | ~300 lines | ~100 lines | ~200 lines | Low |
| 8 — Evidence | ~200 lines | ~100 lines | ~150 lines | Low |
| **Total** | **~2,030** | **~620** | **~1,350** | |

**Grand total:** ~4,000 lines of code across 8 phases.

---

## Key Design Principles (from the document)

1. **Platform state is provisional. Bank state is authoritative.** — Never mark a lock as LOCKED or a settlement as COMPLETED until the bank confirms it.

2. **The platform must not custody funds directly.** — The architecture uses bank escrow accounts (virtual sub-accounts per PO). The platform orchestrates, never holds.

3. **Commercial layer ≠ Financial layer.** — POs are commercial documents. Payment instruments are financial contracts. They have separate lifecycles and separate ledger chains.

4. **Banks are asynchronous systems.** — Every money movement follows `INTENT → INSTRUCTION → CONFIRMATION`. Never skip the confirmation.

5. **Reconciliation is non-negotiable.** — Banks must be able to independently verify that platform state matches bank state.

6. **LPs invest in financial instruments, not POs.** — The instrument becomes the asset. This is exactly how institutional invoice financing works.

---

## Implementation Order

Start with **Phase 1** (async payment lock state machine) — it's the smallest change with the most fundamental impact, and it unlocks everything else.
