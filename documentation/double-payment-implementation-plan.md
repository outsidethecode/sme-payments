# Double-Payment Prevention — Implementation Plan

## Problem Summary

A critical race condition exists between **LP early payment funding** and **buyer settlement release**. Without transactional guards, the supplier can receive both the LP advance AND buyer escrow release — a catastrophic double payment.

### Root Causes Identified

| # | Root Cause | Location |
|---|---|---|
| 1 | **No serializable reads** on `EarlyPaymentRequest.status` — TOCTOU gap between check and transfer | `fund()`, `acknowledgeObligation()` |
| 2 | **No `SELECT FOR UPDATE`** on instrument state transitions — `findAndValidateTransition()` uses plain `findUnique` then separate `update` | `InstrumentService` every method |
| 3 | **Money moves before status is committed** — `transferAdvance()` calls bank adapter before the `$transaction` that records `FUNDED` | `EarlyPaymentsService.fund()` |
| 4 | **`settlePO()` is recipient-agnostic** — trusts the `recipientId` passed to it with no independent verification | `SettlementService.settlePO()` |
| 5 | **No cross-entity consistency** — instrument, lock, early payment request, and settlement updated independently | All services |
| 6 | **`fund()` never checks instrument status** — completely unaware of `PaymentInstrument` state | `EarlyPaymentsService.fund()` |
| 7 | **`fund()` never updates instrument status** — instrument stays `LOCKED` after LP funding | `EarlyPaymentsService.fund()` |

### Race Condition Scenarios

**Race 1 — LP funds while buyer simultaneously settles:**
```
LP: read earlyPay.status=REQUESTED ✓
                                    Buyer: verifyDelivery() → PO=VERIFIED
                                    Buyer: acknowledgeObligation()
                                      read earlyPay.status=REQUESTED
                                      auto-expire → EXPIRED
                                      recipient = supplier
                                      settlePO() → escrow → supplier 💰
LP: transferAdvance() → LP money → supplier 💰💰 DOUBLE PAYMENT
LP: $transaction → earlyPay: EXPIRED → FUNDED (overwrites!)
```

**Race 2 — Two LPs fund same request concurrently:**
```
LP-A: read earlyPay.status=REQUESTED ✓
LP-B: read earlyPay.status=REQUESTED ✓
LP-A: transferAdvance() → LP-A → supplier 💰
LP-B: transferAdvance() → LP-B → supplier 💰💰
```

---

## Solution: `settlementBeneficiary` + Transactional Locking

Per the design document, we add a `settlementBeneficiary` field to `PaymentInstrument` that becomes the **single authoritative answer** to "who receives escrow funds." Combined with `SELECT FOR UPDATE` transactional locking, this makes double payment impossible.

---

## Gap Analysis: Current vs Target

### Schema Changes

| Field | Current | Target | Action |
|---|---|---|---|
| `status` enum | CREATED, LOCK_REQUESTED, LOCKED, RELEASE_PENDING, RELEASED, REFUNDED, FAILED | CREATED, LOCK_REQUESTED, LOCKED, FINANCING_REQUESTED, FINANCING_FUNDED, SETTLEMENT_PENDING, SETTLED, REFUNDED, FAILED | Add 3 new states, rename RELEASE_PENDING→SETTLEMENT_PENDING, RELEASED→SETTLED |
| `settlementBeneficiary` | ❌ missing | SUPPLIER, LIQUIDITY_PROVIDER, BUYER | **Add new enum + field** |
| `buyerOrgId` | ❌ missing | UUID ref to organization | Add (denormalized for financial auditing) |
| `supplierOrgId` | ❌ missing | UUID ref to organization | Add (denormalized for financial auditing) |
| `settledAt` | `releasedAt` exists | `settledAt` (rename for clarity) | Rename field |
| `financingPartnerId` | ❌ missing | UUID ref to LP user | Add (records which LP funded) |

### State Machine Changes

**Current transitions:**
```
CREATED → LOCK_REQUESTED → LOCKED → RELEASE_PENDING → RELEASED
                             ↓                ↓
                          REFUNDED          FAILED
```

**Target transitions:**
```
CREATED → LOCK_REQUESTED → LOCKED ─┬─→ FINANCING_REQUESTED → FINANCING_FUNDED ─┐
                             │      │                                            │
                             │      └─→ SETTLEMENT_PENDING ←────────────────────┘
                             │                ↓
                             └→ REFUNDED    SETTLED
                                              ↑ (via adapter confirm)
```

### Code Changes Required

| File | Change | Description |
|---|---|---|
| `schema.prisma` | Migration | Add `SettlementBeneficiary` enum, new `InstrumentStatus` values, new fields |
| `instrument.service.ts` | Major rewrite | Add `requestFinancing()`, `confirmFinancing()`, `requestSettlement()`, `confirmSettlement()` methods; all transitions use `$transaction` + `SELECT FOR UPDATE` |
| `early-payments.service.ts` | Major rewrite of `fund()` | Must atomically lock instrument, check status, flip beneficiary, THEN call adapter |
| `purchase-orders.service.ts` | Rewrite `acknowledgeObligation()` | Must atomically transition instrument to SETTLEMENT_PENDING, read beneficiary from instrument (not derived from early pay status) |
| `settlement.service.ts` | Modify `settlePO()` | Read `settlementBeneficiary` from instrument to determine recipient; remove passed-in `recipientId` trust |
| `evidence.service.ts` | Update Trust Envelope | Include `settlementBeneficiary` in instrument section |
| Frontend `api.ts` | Update types | Add `settlementBeneficiary` to instrument types |
| Frontend evidence panel | Update display | Show beneficiary in instrument lifecycle card |

---

## Implementation Steps

### Step 1 — Prisma Schema Migration

Add new enum and fields to `schema.prisma`:

```prisma
enum SettlementBeneficiary {
  SUPPLIER
  LIQUIDITY_PROVIDER
  BUYER
}

enum InstrumentStatus {
  CREATED
  LOCK_REQUESTED
  LOCKED
  FINANCING_REQUESTED
  FINANCING_FUNDED
  SETTLEMENT_PENDING
  SETTLED
  REFUNDED
  FAILED
}

model PaymentInstrument {
  id                     String                @id @default(uuid())
  purchaseOrderId        String                @unique @map("purchase_order_id")
  type                   InstrumentType        @default(ESCROW_LOCK)
  amount                 Int
  currency               String                @default("GBP")
  status                 InstrumentStatus      @default(CREATED)
  settlementBeneficiary  SettlementBeneficiary @default(SUPPLIER) @map("settlement_beneficiary")
  escrowReference        String?               @map("escrow_reference")
  bankReference          String?               @map("bank_reference")
  payerAccountRef        String?               @map("payer_account_ref")
  recipientAccountRef    String?               @map("recipient_account_ref")
  buyerOrgId             String?               @map("buyer_org_id")
  supplierOrgId          String?               @map("supplier_org_id")
  financingPartnerId     String?               @map("financing_partner_id")
  failureReason          String?               @map("failure_reason")
  createdAt              DateTime              @default(now()) @map("created_at")
  lockedAt               DateTime?             @map("locked_at")
  settledAt              DateTime?             @map("settled_at")

  purchaseOrder PurchaseOrder @relation(fields: [purchaseOrderId], references: [id])

  @@index([status])
  @@index([bankReference])
  @@index([settlementBeneficiary])
  @@map("payment_instruments")
}
```

Migration SQL will:
- Add `settlement_beneficiary` column with default `SUPPLIER`
- Add new enum values to `InstrumentStatus`
- Add `buyer_org_id`, `supplier_org_id`, `financing_partner_id` columns
- Rename `released_at` → `settled_at`
- Migrate existing `RELEASE_PENDING` → `SETTLEMENT_PENDING`, `RELEASED` → `SETTLED`

### Step 2 — Instrument Service Rewrite

Rewrite `InstrumentService` with:

#### 2a. Atomic transition helper using `SELECT FOR UPDATE`

Replace the current `findAndValidateTransition()` (which has a TOCTOU gap) with an atomic pattern:

```typescript
private async atomicTransition(
  tx: PrismaTransactionClient,
  instrumentId: string,
  expectedStatus: InstrumentStatusType | InstrumentStatusType[],
  targetStatus: InstrumentStatusType,
  data?: Partial<PaymentInstrumentUpdateData>,
): Promise<PaymentInstrument> {
  // SELECT FOR UPDATE — serializes concurrent access
  const [instrument] = await tx.$queryRaw<PaymentInstrument[]>`
    SELECT * FROM payment_instruments
    WHERE id = ${instrumentId}
    FOR UPDATE
  `;

  if (!instrument) {
    throw new BadRequestException(`Instrument ${instrumentId} not found`);
  }

  const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!allowed.includes(instrument.status as InstrumentStatusType)) {
    throw new BadRequestException(
      `Invalid transition: ${instrument.status} → ${targetStatus} (expected ${allowed.join('|')})`,
    );
  }

  return tx.paymentInstrument.update({
    where: { id: instrumentId },
    data: { status: targetStatus, ...data },
  });
}
```

#### 2b. New methods for financing flow

```typescript
// LOCKED → FINANCING_REQUESTED (supplier requests early payment)
async requestFinancing(instrumentId: string, actorId: string)

// FINANCING_REQUESTED → FINANCING_FUNDED (LP funds)
// Atomically flips beneficiary: SUPPLIER → LIQUIDITY_PROVIDER
async confirmFinancing(instrumentId: string, lpId: string, financingPartnerId: string, actorId: string)

// LOCKED | FINANCING_FUNDED → SETTLEMENT_PENDING (buyer triggers settlement)
async requestSettlement(instrumentId: string, recipientAccountRef: string, actorId: string)

// SETTLEMENT_PENDING → SETTLED (bank confirms)
async confirmSettlement(instrumentId: string, bankReference: string, actorId: string)
```

#### 2c. Updated transition map

```typescript
const VALID_TRANSITIONS: Record<InstrumentStatusType, InstrumentStatusType[]> = {
  CREATED:              ['LOCK_REQUESTED', 'FAILED'],
  LOCK_REQUESTED:       ['LOCKED', 'FAILED'],
  LOCKED:               ['FINANCING_REQUESTED', 'SETTLEMENT_PENDING', 'REFUNDED'],
  FINANCING_REQUESTED:  ['FINANCING_FUNDED', 'SETTLEMENT_PENDING', 'FAILED'],
  FINANCING_FUNDED:     ['SETTLEMENT_PENDING'],
  SETTLEMENT_PENDING:   ['SETTLED', 'FAILED'],
  SETTLED:              [],
  REFUNDED:             [],
  FAILED:               [],
};
```

### Step 3 — Rewrite `EarlyPaymentsService.fund()`

The current `fund()` method has the critical race condition. The rewrite must:

1. **Begin transaction** with `SELECT FOR UPDATE` on the instrument
2. **Inside the transaction**: check instrument status ∈ {LOCKED, FINANCING_REQUESTED}, check earlyPay status = REQUESTED, and atomically:
   - Transition instrument → `FINANCING_FUNDED`
   - Set `settlementBeneficiary = LIQUIDITY_PROVIDER`
   - Set `financingPartnerId = lpId`
   - Update earlyPay → `FUNDED`
3. **After transaction commits**: call `transferAdvance()` (money movement)
4. If adapter fails: **compensating transaction** to revert instrument and earlyPay status

**Key design decision:** The beneficiary flip MUST happen BEFORE the money movement. If the adapter call fails, we revert the beneficiary. This is the correct order because:
- If beneficiary is flipped but transfer fails → we revert (no money moved, no harm)
- If transfer succeeds but beneficiary flip races with settlement → double payment (catastrophic)

```typescript
async fund(id: string, lpId: string, sig?: SignatureData) {
  // Step 1: Atomic lock + validate + flip beneficiary
  const { instrument, request } = await this.prisma.$transaction(async (tx) => {
    // Lock the instrument row
    const [instrument] = await tx.$queryRaw`
      SELECT * FROM payment_instruments
      WHERE purchase_order_id = (
        SELECT purchase_order_id FROM early_payment_requests WHERE id = ${id}
      )
      FOR UPDATE
    `;

    if (!instrument || !['LOCKED', 'FINANCING_REQUESTED'].includes(instrument.status)) {
      throw new BadRequestException(
        `Cannot fund: instrument is ${instrument?.status ?? 'missing'}`
      );
    }

    // Also lock the early payment request
    const [request] = await tx.$queryRaw`
      SELECT * FROM early_payment_requests WHERE id = ${id} FOR UPDATE
    `;

    if (request.status !== 'REQUESTED') {
      throw new BadRequestException(`Cannot fund: request is ${request.status}`);
    }

    // Atomic beneficiary flip
    await tx.paymentInstrument.update({
      where: { id: instrument.id },
      data: {
        status: 'FINANCING_FUNDED',
        settlementBeneficiary: 'LIQUIDITY_PROVIDER',
        financingPartnerId: lpId,
      },
    });

    await tx.earlyPaymentRequest.update({
      where: { id },
      data: { liquidityPartnerId: lpId, status: 'FUNDED', fundedAt: new Date() },
    });

    return { instrument, request };
  });

  // Step 2: Transfer money (AFTER lock is committed)
  try {
    const result = await this.settlement.transferAdvance({ ... });
    // Log success
  } catch (error) {
    // COMPENSATING TRANSACTION: revert beneficiary
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentInstrument.update({
        where: { id: instrument.id },
        data: {
          status: 'LOCKED',
          settlementBeneficiary: 'SUPPLIER',
          financingPartnerId: null,
        },
      });
      await tx.earlyPaymentRequest.update({
        where: { id },
        data: { status: 'REQUESTED', liquidityPartnerId: null, fundedAt: null },
      });
    });
    throw error;
  }
}
```

### Step 4 — Rewrite `acknowledgeObligation()`

The current method derives the recipient from `earlyPay.status`. The rewrite must:

1. **Begin transaction** with `SELECT FOR UPDATE` on the instrument
2. **Read `settlementBeneficiary`** from the instrument (not derived)
3. **Transition instrument** → `SETTLEMENT_PENDING` (blocks any further LP funding)
4. **Auto-expire** any unfunded early payment request
5. **Commit** — now the settlement path is locked
6. **Call `settlePO()`** with the beneficiary from the instrument

```typescript
async acknowledgeObligation(id: string, actorId: string, sig?: SignatureData) {
  const po = await this.requireStatus(id, 'VERIFIED');
  if (po.buyerId !== actorId) throw new ForbiddenException(...);

  // Step 1: Atomic lock + determine recipient + transition instrument
  const { recipientId, recipientAccountRef, instrumentId, beneficiary } =
    await this.prisma.$transaction(async (tx) => {
      // Lock the instrument
      const [instrument] = await tx.$queryRaw`
        SELECT * FROM payment_instruments
        WHERE purchase_order_id = ${id}
        FOR UPDATE
      `;

      if (!instrument || !['LOCKED', 'FINANCING_REQUESTED', 'FINANCING_FUNDED'].includes(instrument.status)) {
        throw new BadRequestException(`Cannot settle: instrument is ${instrument?.status ?? 'missing'}`);
      }

      // The instrument's beneficiary is the authoritative answer
      const beneficiary = instrument.settlement_beneficiary;

      // Auto-expire unfunded early payment requests
      const earlyPay = await tx.$queryRaw`
        SELECT * FROM early_payment_requests
        WHERE purchase_order_id = ${id}
        FOR UPDATE
      `;
      if (earlyPay?.[0]?.status === 'REQUESTED') {
        await tx.earlyPaymentRequest.update({
          where: { id: earlyPay[0].id },
          data: { status: 'EXPIRED' },
        });
      }

      // Transition instrument → SETTLEMENT_PENDING (blocks LP funding)
      await tx.paymentInstrument.update({
        where: { id: instrument.id },
        data: { status: 'SETTLEMENT_PENDING' },
      });

      // Resolve recipient from beneficiary
      let recipientId: string;
      if (beneficiary === 'LIQUIDITY_PROVIDER') {
        recipientId = instrument.financing_partner_id!;
      } else {
        recipientId = po.supplierId;
      }

      const recipientOrg = await this.orgs.getOrgByUserId(recipientId);
      return {
        recipientId,
        recipientAccountRef: recipientOrg?.bankIban,
        instrumentId: instrument.id,
        beneficiary,
      };
    });

  // Step 2: Settle (instrument is already SETTLEMENT_PENDING — LP can't fund)
  const result = await this.settlement.settlePO({
    purchaseOrderId: id,
    recipientId,
    recipientAccountRef,
    totalAmount: po.amount,
    feeBps: 50,
    currency: po.currency as SettlementCurrency,
    earlyPaymentRequestId: beneficiary === 'LIQUIDITY_PROVIDER' ? ... : undefined,
  });

  // Step 3: Finalize
  await this.prisma.$transaction(async (tx) => {
    if (beneficiary === 'LIQUIDITY_PROVIDER') {
      const earlyPay = await tx.earlyPaymentRequest.findUnique({ where: { purchaseOrderId: id } });
      if (earlyPay) {
        await tx.earlyPaymentRequest.update({
          where: { id: earlyPay.id },
          data: { status: 'SETTLED', settledAt: new Date() },
        });
      }
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: 'SETTLED', settledAt: new Date() },
    });
  });
}
```

### Step 5 — Update `settlePO()` in Settlement Service

Modify to read `settlementBeneficiary` from the instrument and validate it matches the passed recipient:

```typescript
async settlePO(input: SettlePOInput) {
  // ... existing lock lookup ...

  // Verify settlement beneficiary from instrument
  const instrument = await this.instrumentService.findByPO(input.purchaseOrderId);
  if (instrument && instrument.status !== 'SETTLEMENT_PENDING') {
    throw new BadRequestException(
      `Cannot settle: instrument is ${instrument.status}, expected SETTLEMENT_PENDING`
    );
  }

  // ... proceed with adapter call ...

  // After success: instrument → SETTLED
  if (instrument) {
    await this.instrumentService.confirmSettlement(
      instrument.id, result.externalRef, input.recipientId
    );
  }
}
```

### Step 6 — Update `requestEarlyPayment()` in Early Payments Service

When a supplier requests early payment, transition the instrument:

```typescript
async request(purchaseOrderId: string, supplierId: string, sig?: SignatureData) {
  // ... existing validation ...

  // Transition instrument → FINANCING_REQUESTED
  const instrument = await this.instrumentService.findByPO(purchaseOrderId);
  if (instrument && instrument.status === 'LOCKED') {
    await this.instrumentService.requestFinancing(instrument.id, supplierId);
  }

  // ... create early payment request ...
}
```

### Step 7 — Ledger Events for Beneficiary Changes

Add new ledger event types:

```typescript
'BENEFICIARY_SET'         // when settlementBeneficiary changes
'FINANCING_REQUESTED'     // instrument: LOCKED → FINANCING_REQUESTED
'FINANCING_FUNDED'        // instrument: → FINANCING_FUNDED + beneficiary flip
'SETTLEMENT_INITIATED'    // instrument: → SETTLEMENT_PENDING
'SETTLEMENT_COMPLETED'    // instrument: → SETTLED
```

Each beneficiary change event includes:
```json
{
  "instrumentId": "...",
  "previousBeneficiary": "SUPPLIER",
  "newBeneficiary": "LIQUIDITY_PROVIDER",
  "financingPartnerId": "...",
  "reason": "LP early payment funding"
}
```

### Step 8 — Update Evidence Service

Add `settlementBeneficiary` to the `paymentInstrument` section of Trust Envelopes:

```typescript
paymentInstrument: {
  instrumentId: instrument.id,
  status: instrument.status,
  settlementBeneficiary: instrument.settlementBeneficiary,
  financingPartnerId: instrument.financingPartnerId,
  amount: instrument.amount,
  currency: instrument.currency,
  ...
}
```

### Step 9 — Frontend Updates

- Update `api.ts` types to include `settlementBeneficiary`
- Show beneficiary badge on instrument lifecycle card (green for SUPPLIER, blue for LIQUIDITY_PROVIDER, yellow for BUYER)
- Display beneficiary change events in the evidence panel timeline

### Step 10 — Prisma Migration & Data Migration

Generate and validate migration:
```bash
npx prisma migrate dev --name add_settlement_beneficiary
```

Data migration for existing records:
- All existing `RELEASED` instruments → `SETTLED`, `settlementBeneficiary = SUPPLIER`
- All existing `RELEASE_PENDING` instruments → `SETTLEMENT_PENDING`, `settlementBeneficiary = SUPPLIER`
- Instruments with completed early payment (early pay status = SETTLED + LP id) → `settlementBeneficiary = LIQUIDITY_PROVIDER`

---

## Test Plan

### Unit Tests — InstrumentService (15 new tests)

| # | Test | Validates |
|---|---|---|
| 1 | `create()` sets `settlementBeneficiary = SUPPLIER` by default | Default beneficiary |
| 2 | `requestFinancing()` transitions LOCKED → FINANCING_REQUESTED | New state |
| 3 | `requestFinancing()` rejects if not LOCKED | Guard |
| 4 | `confirmFinancing()` transitions FINANCING_REQUESTED → FINANCING_FUNDED | New state |
| 5 | `confirmFinancing()` sets beneficiary to LIQUIDITY_PROVIDER | Beneficiary flip |
| 6 | `confirmFinancing()` sets financingPartnerId | LP tracking |
| 7 | `confirmFinancing()` rejects if already SETTLEMENT_PENDING | Race guard |
| 8 | `confirmFinancing()` rejects if already SETTLED | Post-settlement guard |
| 9 | `requestSettlement()` transitions LOCKED → SETTLEMENT_PENDING | Direct settlement |
| 10 | `requestSettlement()` transitions FINANCING_FUNDED → SETTLEMENT_PENDING | LP-funded settlement |
| 11 | `requestSettlement()` rejects if already SETTLED | Idempotency |
| 12 | `confirmSettlement()` transitions SETTLEMENT_PENDING → SETTLED | Final state |
| 13 | `confirmSettlement()` sets settledAt timestamp | Audit trail |
| 14 | `refund()` transitions LOCKED → REFUNDED with beneficiary = BUYER | Refund path |
| 15 | Beneficiary is immutable once SETTLEMENT_PENDING | Core invariant |

### Unit Tests — EarlyPaymentsService.fund() (10 new tests)

| # | Test | Validates |
|---|---|---|
| 1 | `fund()` atomically flips beneficiary to LIQUIDITY_PROVIDER | Core fix |
| 2 | `fund()` rejects if instrument is SETTLEMENT_PENDING | Race prevention |
| 3 | `fund()` rejects if instrument is SETTLED | Post-settlement guard |
| 4 | `fund()` rejects if earlyPay is not REQUESTED | Status guard |
| 5 | `fund()` creates BENEFICIARY_SET ledger event | Audit trail |
| 6 | `fund()` reverts beneficiary if adapter fails | Compensating transaction |
| 7 | `fund()` reverts earlyPay status if adapter fails | Compensating transaction |
| 8 | `fund()` sets financingPartnerId on instrument | LP tracking |
| 9 | `fund()` transitions instrument LOCKED → FINANCING_FUNDED | State machine |
| 10 | Two concurrent `fund()` calls — only one succeeds | Concurrent safety |

### Unit Tests — acknowledgeObligation() (8 new tests)

| # | Test | Validates |
|---|---|---|
| 1 | Settlement pays SUPPLIER when no LP funding | Default path |
| 2 | Settlement pays LP when beneficiary = LIQUIDITY_PROVIDER | LP path |
| 3 | `acknowledgeObligation()` transitions instrument to SETTLEMENT_PENDING | State gate |
| 4 | `acknowledgeObligation()` auto-expires unfunded early pay requests | Cleanup |
| 5 | `acknowledgeObligation()` reads beneficiary from INSTRUMENT not earlyPay | Authoritative source |
| 6 | `acknowledgeObligation()` rejects if instrument already SETTLED | Idempotency |
| 7 | Beneficiary cannot be changed after SETTLEMENT_PENDING | Immutability |
| 8 | Settlement creates ledger event with beneficiary info | Audit trail |

### Integration / E2E Tests — Race Condition Prevention (6 new tests)

| # | Test | Validates |
|---|---|---|
| 1 | **LP funds → buyer settles** — LP receives escrow (correct path) | Happy path A |
| 2 | **Buyer settles → LP tries to fund** — LP funding rejected | Race prevention |
| 3 | **Concurrent LP fund + buyer settle** — exactly one succeeds, no double payment | Core race condition |
| 4 | **Two LPs fund concurrently** — exactly one succeeds | Concurrent LP safety |
| 5 | **Full lifecycle: PO → lock → deliver → LP fund → settle → LP receives** | End-to-end LP path |
| 6 | **Full lifecycle: PO → lock → deliver → settle → supplier receives** | End-to-end standard path |

### Regression Tests (5 tests)

| # | Test | Validates |
|---|---|---|
| 1 | Evidence pack includes `settlementBeneficiary` | Phase 8 compatibility |
| 2 | Risk snapshot still works with new instrument states | Phase 7 compatibility |
| 3 | Reconciliation handles SETTLED (renamed from RELEASED) | Phase 5 compatibility |
| 4 | Instrument lifecycle card shows new states | Frontend compatibility |
| 5 | All existing 420 tests still pass | No regressions |

---

## Execution Order

```
Step 1  — Schema migration (add fields, enum values, rename)
Step 2  — InstrumentService rewrite (atomic transitions)
Step 3  — EarlyPaymentsService.fund() rewrite (beneficiary flip)
Step 4  — acknowledgeObligation() rewrite (read from instrument)
Step 5  — settlePO() update (validate beneficiary)
Step 6  — requestEarlyPayment() update (FINANCING_REQUESTED)
Step 7  — Ledger events for beneficiary changes
Step 8  — Evidence service update
Step 9  — Frontend updates
Step 10 — Run full test suite (target: ~465 tests, 0 failures)
```

**Estimated: ~45 new tests bringing total to ~465**

---

## Key Design Decisions

### 1. Beneficiary flip BEFORE money movement
The `settlementBeneficiary` is set to `LIQUIDITY_PROVIDER` inside the transaction BEFORE calling the bank adapter. If the adapter call fails, a compensating transaction reverts it. This ordering prevents the catastrophic case where money moves but beneficiary isn't updated.

### 2. `SELECT FOR UPDATE` as the locking mechanism
Prisma's `$queryRaw` is used for `SELECT FOR UPDATE` since Prisma doesn't natively support row-level locking. This serializes concurrent access to the instrument row.

### 3. Instrument is the single source of truth
`settlePO()` will read `settlementBeneficiary` from the instrument rather than trusting the caller's `recipientId`. The instrument becomes the authoritative financial contract.

### 4. SETTLEMENT_PENDING as a blocking gate
When the buyer initiates settlement, the instrument moves to `SETTLEMENT_PENDING` immediately (inside a transaction). This blocks any LP `fund()` call that arrives afterward, because `fund()` requires instrument status ∈ {LOCKED, FINANCING_REQUESTED}.

### 5. Backward compatibility
- `RELEASE_PENDING` → `SETTLEMENT_PENDING` and `RELEASED` → `SETTLED` are renamed in the enum
- All existing data is migrated
- Frontend updated to reflect new terminology
