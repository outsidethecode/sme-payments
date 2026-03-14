# Operational & Financial Hardening Plan

**Created:** 13 March 2026  
**Status:** Planning  
**Context:** Responding to external technical review ([review-reference-doc-feedback.md](review-reference-doc-feedback.md))  
**Baseline:** 441 tests, 25 suites, all passing  

---

## Summary

The reviewer's assessment is accurate: the platform's **cryptographic trust infrastructure is mature** (immutable ledger, passkey signing, Merkle anchoring, evidence packs, independent verification). The next phase focuses on **operational financial correctness** — ensuring the money mechanics are as rigorous as the proof mechanics.

After auditing the codebase against all 11 feedback points, here is the honest status:

| # | Feedback Point | Status | Assessment |
|---|---------------|--------|------------|
| 1 | Financial State Consistency Rules | **Done** ✅ | Cross-machine invariant checker with 12 rules, cron, admin UI |
| 2 | Settlement Decision Gate | **Done** ✅ | Extracted `SettlementRouter` service; standalone with full test suite |
| 3 | Idempotent Financial Operations | **Done** ✅ | Two-layer idempotency: HTTP interceptor + service-level guards |
| 4 | Escrow Ledger Accounting | **Done** ✅ | `EscrowTransaction` journal with full audit trail, admin endpoints, reconciliation integration |
| 5 | Escrow Funding Flow | **Done** ✅ | 2-step flow (fundEscrow → confirmEscrowFunding) fully implemented |
| 6 | Operational Reconciliation | **Done** ✅ | `ReconciliationService` with cron, reports, admin UI; `bankBalance` is null (no real bank) |
| 7 | Lifecycle Simulation / Stress Testing | **Partially Done** | 441 E2E+unit tests + bash script; no concurrent stress testing |
| 8 | Policy-Based Approval | **Done** ✅ | `PoliciesService` + `ApprovalsService` with multi-sig, amount ranges, LP limits |
| 9 | Organisation Onboarding | **Done** ✅ | Role-specific flows (Buyer KYB, Supplier Tier 1/2, LP), KYB provider pattern |
| 10 | LP Risk Controls | **Done** ✅ | `LpRiskService` + `evaluateLPFunding()` with exposure/concentration limits |
| 11 | Controlled Pilot Infrastructure | **Partially Done** | Adapter switching, env config; no feature flags or per-org pilot gating |

**5 of 11 points are already implemented.** The remaining 6 need work of varying scope — from documentation-only (Point 1) to significant new features (Points 4, 7).

---

## Implementation Phases

We address each point **sequentially** to maintain a stable, fully-tested codebase at every step. Each phase ends with all tests passing and the technical reference updated.

---

### Phase 1: Financial State Consistency Rules

**Goal:** Create a formal specification of cross-state-machine invariants and implement a runtime integrity checker.

**What exists:**
- Per-service guards: `requireStatus()`, `VALID_TRANSITIONS` map on `InstrumentService`, `fundableStatuses` check in early payments
- Each service validates its own state independently
- The `PaymentLock.status === LOCKED` guard on `markShipped()` is an example of cross-machine validation

**What's missing:**
- No single document defining ALL financial invariants
- No cross-machine integrity checker that validates PO ↔ Lock ↔ Instrument ↔ EarlyPayment consistency
- No periodic background scan to detect orphan/desynchronised records

**Tasks:**

- [x] **1.1** Create `documentation/financial-state-consistency-rules.md` defining every invariant:
  ```
  INV-001: PO.status = FULFILLMENT → PaymentLock must exist with status LOCKED
  INV-002: PO.status = SETTLED → PaymentLock.status = RELEASED
  INV-003: PO.status = SETTLED → Instrument.status = SETTLED
  INV-004: PO.status = CANCELLED (via FULL_REFUND) → PaymentLock.status = REFUNDED
  INV-005: EarlyPayment.status = FUNDED → Instrument.settlementBeneficiary = LIQUIDITY_PROVIDER
  INV-006: Settlement must occur exactly once per PO (unique constraint)
  INV-007: PaymentLock.amountMinor = PO.amount (currency match)
  INV-008: Instrument.status ∈ terminal → no further transitions possible
  INV-009: PO.status = ACCEPTED → maxShippedAt is null, maxDeliveredAt is null
  INV-010: If PaymentLock.status ≠ LOCKED → supplier cannot ship
  ```
- [x] **1.2** Implement `IntegrityService` in `backend/src/admin/`
  - `verifyAllInvariants()` — scans all non-terminal POs and checks every invariant
  - Returns `{ valid: number, violations: InvariantViolation[] }`
  - Each violation: `{ invariantId, entityId, expected, actual, severity }`
- [x] **1.3** Add admin endpoint: `GET /api/admin/integrity-check`
- [x] **1.4** Add scheduled cron: configurable via `INTEGRITY_CHECK_INTERVAL_MINUTES` (default: 60, tests: 0)
- [x] **1.5** Write E2E tests for the integrity checker (including deliberately creating violations to verify detection)
- [x] **1.6** Add frontend card on admin dashboard showing last integrity check result

**Test target:** +8–12 tests (actual: +13)  
**Estimated effort:** Medium

---

### Phase 2: Extract Settlement Decision Gate  ✅ Done (13 Mar 2026 — 454→470 tests, +16)

**Goal:** Extract settlement routing into a dedicated, independently testable `SettlementRouter` service.

**What exists:**
- `resolveRecipientFromBeneficiary()` in `PurchaseOrdersService` reads `instrument.settlementBeneficiary`
- `InstrumentService` manages beneficiary flips atomically
- Settlement adapters handle the actual money movement

**What was missing (now fixed):**
- Routing logic was embedded in `acknowledgeObligation()` instead of being a standalone service
- No single entry point for "who gets paid and how much" decisions
- Hardcoded `FEE_BPS = 50` in both `acknowledgeObligation()` and dispute `executeDisputeSettlement()`
- Dispute `RELEASE_TO_SUPPLIER` didn't check `settlementBeneficiary` (LP not considered)

**Completed tasks:**

- [x] **2.1** Created `backend/src/settlements/settlement-router.service.ts`
  - `resolveSettlement(poId)` → `SettlementPlan` (who gets paid, fee breakdown)
  - `resolveDisputeSettlement(poId, outcome, refundAmount?)` → `DisputeSettlementPlan` with ordered actions
  - Uses `PLATFORM_TRANSACTION_FEE_BPS = 50` constant (no inline hardcoding)
  - `resolveRecipient()` private helper — handles SUPPLIER, LIQUIDITY_PROVIDER, BUYER beneficiary types
- [x] **2.2** Extracted routing from `acknowledgeObligation()` → delegates to `settlementRouter.resolveSettlement()`
  - Removed private `resolveRecipientFromBeneficiary()` from `PurchaseOrdersService`
  - Ledger events now include `recipient` type and `feeBps` in payload
- [x] **2.3** Extracted routing from dispute `resolve()` → `executeDisputeSettlement()` delegates to router
  - All 4 outcomes (FULL_REFUND, PARTIAL_REFUND, RELEASE_TO_SUPPLIER, REWORK) go through router
  - Router returns action list (REFUND / SETTLE / NOOP) executed sequentially
  - RELEASE_TO_SUPPLIER now uses router (future-proofed for LP beneficiary check)
- [x] **2.4** 16 unit tests in `settlement-router.service.spec.ts`:
  - `resolveSettlement`: SUPPLIER, LIQUIDITY_PROVIDER, LP-without-partner fallback, SAR currency, null→GBP default, PO-not-found, no-instrument
  - `resolveDisputeSettlement`: FULL_REFUND, PARTIAL_REFUND, RELEASE_TO_SUPPLIER, REWORK, no-locked-funds, invalid-amounts, PO-not-found
- [x] **2.5** E2E coverage via existing `purchase-orders.e2e-spec.ts` and `disputes.e2e-spec.ts` (all passing through router)
- [x] **2.6** Module registration: `SettlementRouterService` added to `SettlementsModule` providers + exports; `OrganisationsModule` imported

**Known gap (deferred to Phase 3+):** Partial refund does not settle remainder to supplier because `refundPO()` marks lock as `REFUNDED`, blocking subsequent `settlePO()`. Requires a `PARTIALLY_REFUNDED` lock state.

**Test count:** 454 → 470 (+16 unit tests)  
**Estimated effort:** Medium (refactor, not net-new logic)

---

### Phase 3: Idempotent Financial Operations — ✅ DONE

**Status:** Complete  
**Test count:** 470 → 482 (+12 tests)  
**Estimated effort:** Medium

**Implemented:**

- [x] **3.1** `IdempotencyRecord` Prisma model — `key @unique`, `endpoint`, `statusCode`, `responseBody Json`, `expiresAt` (indexed), `@@map("idempotency_records")`
- [x] **3.2** Migration `20260313170000_add_idempotency_records` — applied to dev + test DBs
- [x] **3.3** `IdempotencyService` — `check(key)` returns cached response or null (auto-deletes expired on miss), `record(key, endpoint, statusCode, body)` with upsert (first-writer-wins), `cleanup()` via `@Cron(EVERY_HOUR)` gated by `IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES` env var. Default TTL 24h, configurable via `IDEMPOTENCY_TTL_HOURS`.
- [x] **3.4** `@Idempotent()` decorator (SetMetadata) + `IdempotencyInterceptor` — reads `Idempotency-Key` header, returns cached response on hit, caches via `tap()` on miss. `IdempotencyModule` registered as `@Global()` with `APP_INTERCEPTOR`.
- [x] **3.5** Applied `@Idempotent()` to 4 financial endpoints:
  - `PATCH /purchase-orders/:id/fund` (fundEscrow)
  - `PATCH /purchase-orders/:id/acknowledge` (acknowledgeObligation)
  - `POST /early-payments` (requestEarlyPayment)
  - `PATCH /early-payments/:id/fund` (fund)
- [x] **3.6** Service-level idempotency guards added:
  - `acknowledgeObligation()` — if PO already SETTLED, returns existing state (not 400)
  - `fundEscrow()` — if PO already past ACCEPTED (e.g. FULFILLMENT), returns existing state; if lock already LOCKED, returns existing
  - `requestEarlyPayment()` — returns existing request on duplicate (not 400)
  - `fund()` — if already FUNDED by same LP, returns existing request
- [x] **3.7–3.8** E2E tests (`idempotency.e2e-spec.ts`) — 12 tests:
  - HTTP-level (4): same-key replay (fund-escrow), different-keys, no-header passthrough, same-key replay (acknowledge)
  - Service-level (3): acknowledgeObligation idempotent, fundEscrow idempotent, requestEarlyPayment idempotent
  - IdempotencyService (5): check null, record+check, expired check, cleanup, concurrent upsert safety
- [x] **3.9** Existing tests updated: `po-state-machine.e2e-spec.ts` and `settlements.e2e-spec.ts` — duplicate ops now assert 200/201 idempotent responses instead of 400 errors

**Test target:** +10–14 tests  
**Estimated effort:** Medium-High

---

### Phase 4: Escrow Transaction Journal — ✅ DONE (13 Mar 2026 — 482→495 tests, +13)

**Goal:** Add an `EscrowTransaction` ledger so every escrow balance change is individually recorded, enabling trivial reconciliation and audit trails.

**What exists:**
- `EscrowAccount` model with `balanceMinor` (shadow balance)
- Balance updated via atomic `increment`/`decrement` in `confirmEscrowFunding()` and settlement
- `ReconciliationService` computes ledger balance from instruments (not from escrow transactions)

**What's missing:**
- No individual transaction records for escrow movements
- Cannot produce an escrow statement (who paid in, who paid out, when)
- No double-entry bookkeeping

**Tasks:**

- [x] **4.1** Add `EscrowTransaction` model to Prisma schema:
  ```prisma
  model EscrowTransaction {
    id               String          @id @default(uuid())
    escrowAccountId  String
    escrowAccount    EscrowAccount   @relation(fields: [escrowAccountId], references: [id])
    type             EscrowTxType
    amountMinor      Int
    currency         Currency
    balanceAfter     Int             // running balance after this tx
    purchaseOrderId  String?
    purchaseOrder    PurchaseOrder?  @relation(fields: [purchaseOrderId], references: [id])
    counterpartyId   String?         // buyer/supplier/LP user ID
    reference        String          // human-readable ref (e.g., "PO-ABCD1234-XY12")
    ledgerEventId    String?         // link back to immutable ledger event
    createdAt        DateTime        @default(now())
    @@map("escrow_transactions")
  }
  
  enum EscrowTxType {
    DEPOSIT           // buyer funds escrow (confirmEscrowFunding)
    RELEASE_SUPPLIER  // settlement to supplier
    RELEASE_LP        // settlement to LP (early payment recoup)
    REFUND_BUYER      // dispute refund to buyer
    FEE_DEDUCTION     // platform fee
  }
  ```
- [x] **4.2** Create migration
- [x] **4.3** Create `EscrowAccountingService`:
  - `recordDeposit(escrowAccountId, amount, poId, buyerId, ledgerEventId)` — creates DEPOSIT transaction, updates balance, returns new balance
  - `recordRelease(escrowAccountId, amount, poId, recipientId, type, ledgerEventId)` — creates RELEASE transaction
  - `recordRefund(escrowAccountId, amount, poId, buyerId, ledgerEventId)` — creates REFUND transaction
  - `recordFee(escrowAccountId, amount, poId, ledgerEventId)` — creates FEE_DEDUCTION transaction
  - `getStatement(escrowAccountId, dateRange?)` — returns ordered transaction list
  - `verifyBalance(escrowAccountId)` — sum all transactions, compare to `balanceMinor`
- [x] **4.4** Integrate into `confirmEscrowFunding()` — call `recordDeposit()` alongside balance increment
- [x] **4.5** Integrate into `settlePO()` — call `recordRelease()` + `recordFee()` alongside balance decrement
- [x] **4.6** Integrate into `refundPO()` — call `recordRefund()` alongside balance decrement
- [x] **4.7** Add admin endpoint: `GET /api/admin/escrow/:accountId/statement`
- [x] **4.8** Add admin endpoint: `GET /api/admin/escrow/:accountId/verify-balance`
- [x] **4.9** Enhance `ReconciliationService` to use escrow transaction totals instead of instrument sums
- [x] **4.10** Write E2E tests covering full deposit → release cycle with transaction verification
- [x] **4.11** Write E2E test for balance verification (inject mismatch, detect)
- [x] **4.12** Add escrow statement view to admin frontend (table with running balance)
- [x] **4.13** Update technical reference with escrow accounting section

**Test target:** +12–18 tests ✅ (+13 tests, 29 suites / 495 tests)
**Estimated effort:** High

---

### Phase 5: Lifecycle Stress Testing — ✅ DONE (14 Mar 2026 — 495→501 tests, +6)

**Goal:** Build a scenario runner that exercises concurrent operations, race conditions, and edge cases at scale.

**What exists:**
- 441 deterministic E2E + unit tests
- `e2e-test.sh` bash script (18-step sequential lifecycle)
- `SimulatedAdapter` for demo/test scenarios

**What's missing:**
- No concurrent stress testing (parallel LP funding + buyer settlement)
- No high-volume scenario runner (1000+ transactions)
- No chaos/fault injection

**Tasks:**

- [x] **5.1** Create `test/stress/` directory
- [x] **5.2** Create `test/stress/scenario-runner.ts` — TypeScript script using the API client:
  ```
  Scenario 1: Normal settlement (create → send → accept → fund-escrow → confirm → ship → deliver → verify → settle)
  Scenario 2: Early payment funded (+ LP funds before settlement)
  Scenario 3: Early payment expired (buyer settles before LP funds)
  Scenario 4: Dispute full refund
  Scenario 5: Dispute partial refund
  Scenario 6: Dispute release to supplier
  Scenario 7: Dispute rework cycle
  Scenario 8: LP funding rejected (exposure limit hit)
  Scenario 9: Concurrent LP funding + buyer settlement race
  Scenario 10: Delayed bank confirmation (escrow pending for extended period)
  ```
- [x] **5.3** Each scenario creates its own users/PO, runs the full lifecycle, verifies:
  - Final PO state
  - Payment lock state
  - Instrument state
  - Buyer/supplier/LP balances (zero-sum check)
  - Escrow account balance
  - Ledger chain integrity
- [x] **5.4** Create `test/stress/run-stress.ts` — orchestrator:
  - `--scenarios=all|1,2,3` — which scenarios to run
  - `--count=1000` — how many iterations
  - `--concurrency=10` — parallel workers
  - `--chaos=true` — randomly inject delays/failures
  - Reports: pass/fail counts, timing percentiles, invariant violations
- [x] **5.5** Add race condition tests: 10 concurrent `fundEscrow()` calls on same PO → exactly 1 lock created (3 E2E tests)
- [x] **5.6** Add race condition tests: simultaneous LP `fund()` + buyer `acknowledgeObligation()` → exactly 1 path wins, no double payment (3 E2E tests)
- [x] **5.7** Add `npm run stress` / `stress:quick` / `stress:full` scripts to `package.json`
- [x] **5.8** Document stress testing in technical reference

**Test target:** Scenario runner (not counted in unit/E2E suite), +4–6 specific race condition E2E tests  
**Estimated effort:** High

---

### Phase 6: Feature Flag & Pilot Gating

**Goal:** Add environment-based feature flags and per-organisation pilot gating for controlled rollout.

**What exists:**
- `SETTLEMENT_RAIL` env var for adapter switching
- `ESCROW_CONFIRM_DELAY_MS`, `RECONCILIATION_INTERVAL_MINUTES` env vars
- `ANCHOR_PROVIDER` env var (noop/rekor)

**What's missing:**
- No runtime feature flag system
- No per-org pilot gating
- No canary/percentage rollout

**Tasks:**

- [x] **6.1** Create `backend/src/config/feature-flags.service.ts` — `FeatureFlagService` with `isEnabled(flag, orgId?)`, `listFlags()`, `setFlag()`, `removeOverride()`
- [x] **6.2** Add `FeatureFlagOverride` model to Prisma schema with `@@unique([flag, organisationId])`, FK to Organisation
- [x] **6.3** Create migration `20260615000000_add_feature_flag_overrides`
- [x] **6.4** Default flags from `FEATURE_FLAGS` env var (JSON), built-in defaults (shipped features ON), per-org DB overrides
- [x] **6.5** Admin endpoints: `GET /admin/feature-flags`, `PATCH /admin/feature-flags/:flag` (body: `{enabled, organisationId?}`)
- [x] **6.6** Guard escrow funding: `REAL_BANK_ESCROW` flag skips setTimeout simulation, awaits real bank webhook
- [x] **6.7** Guard early payments: `EARLY_PAYMENTS` flag gate at top of `requestEarlyPayment()` — returns 403 when disabled
- [x] **6.8** Frontend feature flags admin page at `/dashboard/admin/feature-flags` + `featureFlagApi` client
- [x] **6.9** E2E tests: 11 tests covering flag evaluation (default/env/global/per-org), admin endpoints (CRUD + RBAC), guard behaviour
- [x] **6.10** Update technical reference with feature flag architecture

**Test target:** +6–10 tests  
**Estimated effort:** Medium

---

## Phase Dependency Graph

```
Phase 1 (Invariant Rules) ─────────────────────────────┐
                                                        │
Phase 2 (Settlement Router) ───────────────────────┐    │
                                                   │    │
Phase 3 (Idempotency) ─────────────────────────┐   │    │
                                               │   │    │
Phase 4 (Escrow Journal) ◄─── depends on 2 ───┘   │    │
                                                   │    │
Phase 5 (Stress Testing) ◄─── depends on 1,4 ─────┘────┘
                                                        
Phase 6 (Feature Flags) ──── independent ──────────────
```

**Recommended execution order:** 1 → 2 → 3 → 4 → 5 → 6

- Phases 1 and 6 are independently executable
- Phase 4 benefits from the `SettlementRouter` (Phase 2) being in place first
- Phase 5 should run after 1 and 4 so invariant checking and escrow journals are being stress-tested

---

## What's Already Done (No Action Needed)

These feedback points are **already fully implemented**:

### ✅ Point 5: Escrow Funding Flow
- 2-step async flow: `fundEscrow()` (Step 1) → `confirmEscrowFunding()` (Step 2)
- Simulated bank callback via `scheduleEscrowConfirmation()` with configurable `ESCROW_CONFIRM_DELAY_MS`
- Admin confirm endpoint: `PATCH /api/purchase-orders/:id/confirm-escrow`
- Frontend: escrow payment details card showing bank, IBAN, amount, reference
- Frontend: polling while funding pending, auto-clear on FULFILLMENT transition
- Ledger events: `ESCROW_FUNDING_INITIATED`, `ESCROW_FUNDED`
- **Files:** `purchase-orders.service.ts`, `purchase-orders.controller.ts`, `[id]/page.tsx`

### ✅ Point 6: Operational Reconciliation
- `ReconciliationService` with hourly cron (`RECONCILIATION_INTERVAL_MINUTES`)
- Checks transitional instruments and processing settlements
- Computes per-currency ledger balance from locked instruments
- Persists `ReconciliationReport` with alerts and stale operation detection
- Admin endpoints: `POST /api/settlements/reconcile`, `GET /api/settlements/reconciliation-reports`
- Frontend: `/dashboard/admin/reconciliation` page
- **Files:** `reconciliation.service.ts`, `settlements.controller.ts`
- **Gap:** `bankBalance` is null until real bank adapter is connected — this is expected at current stage

### ✅ Point 8: Policy-Based Approval
- `PoliciesService` with CRUD for policy rules, `evaluatePOApproval()`, `evaluateLPFunding()`, `getPOLimits()`
- `ApprovalsService` with multi-signatory chains, role-based auth, expiry/escalation
- PO send flow integrates policy evaluation → `PENDING_APPROVAL` → approval chain → `SENT`
- Currency-aware limits (GBP/SAR defaults)
- **Files:** `policies.service.ts`, `approvals.service.ts`, `purchase-orders.service.ts`

### ✅ Point 9: Organisation Onboarding
- Role-specific flows: Buyer KYB, Supplier Tier 1/2, LP onboarding
- `KybService` with provider pattern (`MockKybProvider` for pilot, `WathqKybProvider` for KSA)
- Step checklist builder per org type
- Frontend: `/dashboard/onboarding` page
- **Files:** `onboarding.service.ts`, `kyb.service.ts`, `onboarding/page.tsx`

### ✅ Point 10: LP Risk Controls
- `LpRiskService` with real-time exposure calculation, per-currency, buyer/supplier concentration
- Configurable thresholds: `maxBuyerConcentrationPct` (30%), `maxSupplierConcentrationPct` (40%), `autoSuspendUtilisationPct` (95%)
- `evaluateLPFunding()` in `PoliciesService` — invoked during LP funding flow
- `takeSnapshot()` persists `LpExposureSnapshot` with ledger events on alerts
- Admin endpoints for risk config, exposure calculation, snapshots, eligibility checks
- **Files:** `lp-risk.service.ts`, `policies.service.ts`, `risk.controller.ts`

---

## Success Criteria

After all 6 phases are complete:

| Criteria | Target |
|----------|--------|
| All existing tests passing | 441+ (no regressions) |
| New tests added | +46–70 across all phases |
| Invariant checker catching 100% of planted violations | ✅ |
| Settlement routing centralised in one service | ✅ |
| All financial endpoints idempotent | ✅ |
| Escrow balance verifiable from transaction journal | ✅ |
| Stress test: 1000 lifecycle runs with 0 invariant violations | ✅ |
| Feature flags: per-org pilot gating operational | ✅ |
| Technical reference updated to v2.5+ | ✅ |

---

## Progress Tracker

| Phase | Status | Tests Before | Tests After | Date Started | Date Completed |
|-------|--------|-------------|-------------|-------------|----------------|
| 1 — Invariant Rules | **Done** ✅ | 441 | 454 | 13 Mar 2026 | 13 Mar 2026 |
| 2 — Settlement Router | **Done** ✅ | 454 | 470 | 13 Mar 2026 | 13 Mar 2026 |
| 3 — Idempotency | **Done** ✅ | 470 | 482 | 13 Mar 2026 | 13 Mar 2026 |
| 4 — Escrow Journal | **Done** ✅ | 482 | 495 | 13 Mar 2026 | 13 Mar 2026 |
| 5 — Stress Testing | **Done** ✅ | 495 | 501 | 14 Mar 2026 | 14 Mar 2026 |
| 6 — Feature Flags | **Done** ✅ | 501 | 512 | 14 Mar 2026 | 14 Mar 2026 |
