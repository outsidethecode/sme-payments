# Buyer Escrow Payment Implementation Plan

## Overview

Transform the payment flow from **auto-debit on supplier-accept** (current) to an explicit **buyer-funds-escrow** step, matching the architecture described in `escrow-account.md` and the canonical workflow in `draft-workflow.md` (Step 2: "Buyer pre-authorises payment").

### Current Flow (Problem)

```
Buyer creates PO → Sends to Supplier → Supplier clicks Accept
  ↳ System auto-checks buyer User.balance
  ↳ System auto-debits buyer User.balance via SimulatedAdapter
  ↳ Creates PaymentLock(LOCKED) + PaymentInstrument(LOCKED)
  ↳ PO → ACCEPTED
```

**Issues:**
1. Buyer has no explicit "fund escrow" action — funds are silently debited when the supplier accepts
2. `User.balance` is a flat integer — no connection to the real `EscrowAccount` entity
3. `EscrowAccount.balanceMinor` is never actually updated (it's always 0)
4. `PaymentInstrument.escrowAccountId` is never set — no link between the financial contract and the escrow account
5. If buyer has insufficient funds at accept-time, the supplier accept **fails** — bad UX
6. The workflow doc says the buyer should pre-authorise payment **before** the supplier accepts

### Target Flow (From escrow-account.md + draft-workflow.md)

```
Buyer creates PO → Sends to Supplier
  ↳ Supplier clicks Accept → PO status: ACCEPTED (no funds moved yet)
  ↳ Buyer sees "Fund Escrow" button on ACCEPTED PO
  ↳ Buyer clicks "Fund Escrow"
    → System finds EscrowAccount matching PO currency
    → System debits buyer User.balance (simulated; real = Open Banking payment)
    → System credits EscrowAccount.balanceMinor
    → System creates PaymentLock(LOCKED) + PaymentInstrument(LOCKED)
    → PO status: ACCEPTED → IN_PROGRESS (funds secured, supplier can start work)
    → Ledger: ESCROW_FUNDED event
```

This separates **commercial acceptance** (supplier agrees to terms) from **financial commitment** (buyer funds escrow).

---

## Implementation Steps

### Step 1 — New PO Status: Separate Accept from Funding

**Goal:** Supplier accept only changes PO to ACCEPTED. Buyer funding moves it to IN_PROGRESS.

**Current `accept()` method** (purchase-orders.service.ts lines 457–530):
- Checks buyer balance
- Calls `settlement.reserveForPO()` (debits buyer, creates lock)
- Sets PO to ACCEPTED + paymentLocked

**Changes:**
1. **Remove** the buyer balance check from `accept()`
2. **Remove** the `settlement.reserveForPO()` call from `accept()`
3. **Remove** `paymentLocked: true` and `lockedAt` from the accept update
4. PO status stays `ACCEPTED` — meaning "supplier agreed, awaiting buyer funding"
5. Same for `acceptCounter()` — remove the reservation logic there too

**Ledger events:**
- `PO_ACCEPTED` — remains (commercial acceptance, no financial action)

---

### Step 2 — New Endpoint: `PATCH /purchase-orders/:id/fund`

**Goal:** Explicit buyer action to fund the escrow account for an ACCEPTED PO.

**New method** `fundEscrow(id, actorId, sig?)` in `PurchaseOrdersService`:

```
1. Require PO status = ACCEPTED
2. Require actorId = po.buyerId
3. Require PaymentLock does NOT exist for this PO (idempotency)
4. Check buyer has sufficient balance (User.balance >= po.amount)
5. Resolve the correct EscrowAccount:
   - Find EscrowAccount where currency = po.currency AND active = true
   - If not found → throw "No active escrow account for {currency}"
6. Call settlement.reserveForPO() (creates lock + instrument)
7. Link PaymentInstrument → EscrowAccount (set escrowAccountId)
8. Credit EscrowAccount.balanceMinor += po.amount
9. Update PO:
   - paymentLocked: true
   - lockedAt: now
   - status: IN_PROGRESS (funds secured, supplier can begin work)
10. Log ledger events:
    - ESCROW_FUNDED (entityType: PURCHASE_ORDER)
      payload: { amount, currency, escrowAccountId, escrowLabel }
    - PAYMENT_LOCK_CREATED (already done by reserveForPO)
11. Return PO + receipt
```

**Controller:**
```typescript
@Patch(':id/fund')
@Roles('BUYER')
@ApiOperation({ summary: 'Fund escrow for an accepted PO' })
async fundEscrow(@Param('id') id: string, @Request() req, @Body() body) {
  return this.service.fundEscrow(id, req.user.id, body.signature);
}
```

---

### Step 3 — Update `settlement.reserveForPO()` to Accept `escrowAccountId`

**Goal:** Wire the escrow account through the reservation flow.

**Changes to `ReserveForPOInput`:**
- Add optional `escrowAccountId?: string`

**Changes to `reserveForPO()`:**
- Pass `escrowAccountId` when creating the `PaymentInstrument` (Step 0)
- After `confirmLock()`, update `PaymentInstrument.escrowAccountId`

**Changes to `instrument.service.ts`:**
- `create()` accepts optional `escrowAccountId`
- `confirmLock()` sets `escrowAccountId` on the instrument if provided

---

### Step 4 — Credit `EscrowAccount.balanceMinor` on Fund

**Goal:** Keep the escrow shadow balance accurate.

**In `fundEscrow()` (or in `settlement.reserveForPO()`):**

```typescript
await this.prisma.escrowAccount.update({
  where: { id: escrowAccountId },
  data: { balanceMinor: { increment: amount } },
});
```

**On settlement release (`settlePO()`):**

```typescript
await this.prisma.escrowAccount.update({
  where: { id: instrument.escrowAccountId },
  data: { balanceMinor: { decrement: netAmount } },
});
```

**On refund (`refundPO()`):**

```typescript
await this.prisma.escrowAccount.update({
  where: { id: instrument.escrowAccountId },
  data: { balanceMinor: { decrement: amount } },
});
```

This ensures `EscrowAccount.balanceMinor` always equals `Sum(LOCKED PaymentLocks for that currency)`.

---

### Step 5 — Frontend: "Fund Escrow" Button on PO Detail Page

**Goal:** Buyer sees a clear call-to-action to fund the escrow when the PO is ACCEPTED.

**Location:** `frontend/src/app/dashboard/purchase-orders/[id]/page.tsx`

**When to show:** PO status = `ACCEPTED` AND user is the buyer AND no paymentLock exists

**UI:**
```
┌─────────────────────────────────────────┐
│  💰 Fund Escrow                         │
│                                         │
│  This PO has been accepted by the       │
│  supplier. Fund the escrow account      │
│  to secure payment and allow work       │
│  to begin.                              │
│                                         │
│  Amount: SAR 600,000.00                 │
│  Escrow: KSA SAR Escrow (Saudi Bank)    │
│  Your Balance: SAR 1,000,000.00         │
│                                         │
│  [ Fund Escrow Account ]                │
│                                         │
│  Funds will be held in escrow until     │
│  delivery is verified and settled.      │
└─────────────────────────────────────────┘
```

**API call:** `PATCH /purchase-orders/:id/fund`

**After success:**
- PO status updates to IN_PROGRESS
- Payment Lock card appears (already exists in the UI)
- Button disappears

---

### Step 6 — Frontend API Client Update

**Goal:** Add the `fund` method to the PO API client.

**In `api.ts`:**
```typescript
fund: (id: string, signature?: SignatureData) =>
  api.patch(`/purchase-orders/${id}/fund`, { signature }),
```

---

### Step 7 — Ledger Event Types

**New event:** `ESCROW_FUNDED`

```
entityType: PURCHASE_ORDER
entityId: <PO id>
eventType: ESCROW_FUNDED
actorId: <buyer id>
actorRole: BUYER
payload: {
  amount: <minor units>,
  currency: "SAR" | "GBP",
  escrowAccountId: <uuid>,
  escrowAccountLabel: "KSA SAR Escrow",
  paymentLockId: <uuid>,
  instrumentId: <uuid>,
}
```

Existing events that remain:
- `PAYMENT_LOCK_REQUESTED` — created in `reserveForPO()` step
- `PAYMENT_LOCK_CONFIRMED` — created when adapter confirms
- `PAYMENT_LOCK_RELEASED` — on settlement
- `SETTLEMENT_PROCESSING` / `SETTLEMENT_COMPLETED` — on payout

---

### Step 8 — Update Dashboard Locked Amount

**Goal:** The "Locked Amount" card on the admin dashboard now accurately reflects escrow-funded POs.

**No code change needed** — the existing `paymentLock.groupBy` query already sums LOCKED locks by currency. Once the flow changes, only buyer-funded POs will have LOCKED locks, making the number accurate.

---

### Step 9 — Update Existing Tests

**Goal:** Fix tests broken by removing auto-lock from accept.

**Key test changes:**
- Tests that call `accept()` and expect a PaymentLock → need to also call `fundEscrow()` afterward
- Tests for the settlement flow → need to fund escrow before expecting settlement to work
- Add new tests for the `fundEscrow()` method itself:
  - Happy path: ACCEPTED PO + sufficient balance → IN_PROGRESS + lock created
  - Cannot fund non-ACCEPTED PO
  - Cannot fund if not the buyer
  - Cannot fund twice (idempotency)
  - Cannot fund with insufficient balance
  - Cannot fund if no escrow account exists for the currency

---

### Step 10 — Seed Data: Create Escrow Accounts

**Goal:** Ensure seed data has active escrow accounts for both currencies.

**Check if escrow accounts already exist in seed** — if not, add:

```typescript
await prisma.escrowAccount.upsert({
  where: { country_currency: { country: 'SA', currency: 'SAR' } },
  create: { label: 'KSA SAR Escrow', bank: 'Saudi Bank', country: 'SA', currency: 'SAR', balanceMinor: 0 },
  update: {},
});

await prisma.escrowAccount.upsert({
  where: { country_currency: { country: 'GB', currency: 'GBP' } },
  create: { label: 'UK GBP Escrow', bank: 'UK Bank', country: 'GB', currency: 'GBP', balanceMinor: 0 },
  update: {},
});
```

---

## Status Flow Summary

### Before (Current)

```
DRAFT → SENT → ACCEPTED (funds auto-locked) → SHIPPED → DELIVERED → VERIFIED → SETTLED
```

### After (New)

```
DRAFT → SENT → ACCEPTED (commercial only) → IN_PROGRESS (buyer funded escrow)
  → SHIPPED → DELIVERED → VERIFIED → SETTLED
```

The `IN_PROGRESS` status now has a clear meaning: **buyer has funded escrow, supplier can begin work**.

---

## Reconciliation Alignment

After this implementation, the admin dashboard will show:

| Card | Meaning | Source |
|------|---------|--------|
| **Escrow Balance** | Actual money held in escrow accounts | `EscrowAccount.balanceMinor` grouped by currency |
| **Locked Amount** | Total funds locked against POs | `PaymentLock.amount` where status=LOCKED, grouped by currency |

These two values should **always match**. If they don't, run reconciliation.

The daily reconciliation check from `escrow-account.md`:
```
Sum(LOCKED PaymentLocks for currency X) == EscrowAccount(currency X).balanceMinor
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/src/purchase-orders/purchase-orders.service.ts` | Remove auto-lock from `accept()` + `acceptCounter()`, add `fundEscrow()` |
| `backend/src/purchase-orders/purchase-orders.controller.ts` | Add `PATCH /:id/fund` endpoint |
| `backend/src/settlements/settlement.service.ts` | Accept `escrowAccountId` in `reserveForPO()`, credit/debit escrow balance |
| `backend/src/settlements/instrument.service.ts` | Accept `escrowAccountId` in `create()` |
| `frontend/src/lib/api.ts` | Add `fund()` method to PO API |
| `frontend/src/app/dashboard/purchase-orders/[id]/page.tsx` | Add "Fund Escrow" button + card for buyer |
| `backend/prisma/seed.ts` | Add escrow account seed data (if missing) |
| Various test files | Update to call `fundEscrow()` after accept |

---

## Simulation vs Production

This plan uses the **SimulatedAdapter** (debits `User.balance`). The escrow account credit is a **shadow balance** that mirrors what the real bank account would hold.

**To go to production:**
1. Replace `SimulatedAdapter` with `KsaBankAdapter` (already exists as mock)
2. `reserveFunds()` initiates real Open Banking payment → platform escrow bank account
3. `EscrowAccount.balanceMinor` is reconciled daily against real bank statement
4. The buyer's "Fund Escrow" button triggers Open Banking auth flow instead of instant debit

The architecture is **identical** — only the adapter implementation changes.
