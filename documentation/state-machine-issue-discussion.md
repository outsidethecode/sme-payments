# PO Status "IN_PROGRESS" — Naming & State Machine Clarity Issue

**Author:** Engineering  
**Date:** 13 March 2026  
**Status:** Open for team feedback  
**Priority:** UX / Trust / Bank-grade semantics

---

## 1. The Problem

When a **supplier** views a Purchase Order after the buyer has funded escrow, they see:

```
┌──────────────────────────────────────────────┐
│  PO-MMOZLUXP-9GCD         IN PROGRESS       │
│  Created 13 Mar 2026                         │
│                                              │
│  ✅ Payment Secured       [ Mark Shipped ]   │
└──────────────────────────────────────────────┘
```

**The confusion:**

- The badge says **"IN PROGRESS"** — which sounds like the **payment** is still being processed.
- But the label says **"Payment Secured"** — meaning the escrow is already fully funded and locked.
- A reasonable person asks: _"If the payment is secured, why does it say 'in progress'? And if it's in progress, should I really ship?"_

This is a **trust and clarity issue**. In a bank-grade system, every status must be **unambiguous and self-explanatory**, especially to a supplier who is about to ship physical goods worth hundreds of thousands.

---

## 2. Root Cause: One Status Field Carries Two Meanings

The PO `status` field conflates **two distinct lifecycles** into a single enum:

| What the status describes | Example meaning of "IN_PROGRESS" |
|---|---|
| **Commercial lifecycle** (order fulfilment) | "Supplier is working on the order" |
| **Financial lifecycle** (payment flow) | "Payment is being processed" |

Currently `IN_PROGRESS` means: _"Escrow is funded, supplier can begin fulfilment."_ But the label reads like payments are mid-flight.

---

## 3. The Exact State Machines (Current Implementation)

### 3.1 PO Status — Commercial Lifecycle

```
DRAFT → [PENDING_APPROVAL →] SENT → ACCEPTED → IN_PROGRESS → SHIPPED → DELIVERED → VERIFIED → SETTLED
                                 │                                  │
                                 ← NEGOTIATION ←                   → DISPUTED → (resolved)
                                 │
                                 → CANCELLED
```

### 3.2 What Actually Happens Financially at Each Step

| # | PO Status | Financial Event | Payment Lock | Escrow Balance | Who Acts |
|---|-----------|----------------|--------------|----------------|----------|
| 1 | `DRAFT` | None | — | — | Buyer |
| 2 | `SENT` | None | — | — | Buyer |
| 3 | `ACCEPTED` | None (commercial acceptance only) | — | — | Supplier |
| 4 | **`IN_PROGRESS`** | **Buyer debited → Escrow credited → Lock created (LOCKED)** | **LOCKED** | **+amount** | **Buyer funds** |
| 5 | `SHIPPED` | None (guard verifies lock is LOCKED) | LOCKED | No change | Supplier |
| 6 | `DELIVERED` | None | LOCKED | No change | Supplier |
| 7 | `VERIFIED` | None | LOCKED | No change | Buyer |
| 8 | `SETTLED` | **Escrow debited → Supplier/LP credited → Lock RELEASED** | **RELEASED** | **−amount** | Buyer |

**Key observation:** Financial action only happens at two points — entry to `IN_PROGRESS` (escrow funded) and entry to `SETTLED` (funds released). Everything in between (`SHIPPED`, `DELIVERED`, `VERIFIED`) is purely commercial.

### 3.3 Payment Lock Lifecycle

```
PENDING ──adapter confirms──→ LOCKED ──settlement──→ RELEASED
   │                            │
   └──adapter rejects──→ LOCK_FAILED     └──dispute refund──→ REFUNDED
```

### 3.4 Payment Instrument Lifecycle

```
CREATED → LOCK_REQUESTED → LOCKED → SETTLEMENT_PENDING → SETTLED
                              │
                              ├→ FINANCING_REQUESTED → FINANCING_FUNDED → SETTLEMENT_PENDING
                              └→ REFUNDED
```

### 3.5 Escrow Account Balance

```
                    +amount                                 −amount
                       │                                       │
 ──────────────────────┼───────────────────────────────────────┼──────→ time
                 fundEscrow()                           settlePO()
             (ACCEPTED→IN_PROGRESS)                 (VERIFIED→SETTLED)
```

### 3.6 Early Payment Flow (Parallel Financial Chain)

```
Supplier requests    → EarlyPaymentRequest: REQUESTED
LP transfers advance → EarlyPaymentRequest: FUNDED   │ Instrument beneficiary flipped to LP
Buyer settles PO     → EarlyPaymentRequest: SETTLED  │ Escrow pays LP instead of Supplier
```

### 3.7 Dispute Flow

```
PO:      DELIVERED → DISPUTED → (admin resolves) → CANCELLED / SETTLED / VERIFIED / IN_PROGRESS
Dispute: OPEN → EVIDENCE_SUBMITTED → UNDER_REVIEW → RESOLVED

Outcome               PO becomes      Financial effect
─────────────────────  ─────────────   ─────────────────────────
FULL_REFUND            CANCELLED       Lock → REFUNDED, buyer refunded
PARTIAL_REFUND         SETTLED         Partial refund to buyer
RELEASE_TO_SUPPLIER    VERIFIED        Normal settlement to supplier
REWORK                 IN_PROGRESS     No financial action
```

---

## 4. How We Currently Address It

### 4.1 Backend Guards

`markShipped()` now performs a **defensive double-check**:

```typescript
// 1. Status must be IN_PROGRESS (implying escrow was funded)
if (po.status !== "IN_PROGRESS") throw 400;

// 2. Explicit payment lock verification (belt-and-suspenders)
if (!po.paymentLocked || !po.paymentLock || po.paymentLock.status !== "LOCKED") {
  throw 400("Cannot ship: buyer payment has not been locked in escrow");
}
```

### 4.2 Frontend Indicator

The PO detail page shows a **"Payment Secured"** / **"Payment Not Locked"** indicator next to the Ship button. The button is disabled unless `paymentLock.status === "LOCKED"`.

### 4.3 What's Still Wrong

Even with the guard and the indicator, the **status badge itself** reads "IN PROGRESS" — which is misleading. The supplier has to read and trust a secondary indicator instead of the primary status badge.

---

## 5. Options for Bank-Grade Resolution

### Option A: Rename `IN_PROGRESS` → `ESCROW_FUNDED` (or `FUNDED`)

**Pros:**
- Status name directly communicates financial reality
- Supplier reads "ESCROW FUNDED" and immediately knows: money is in escrow, safe to ship
- Simple rename, one migration

**Cons:**
- "Funded" describes a financial event, not the commercial stage
- Loses the sense that the order is "active" / "being fulfilled"

**Example flow:**
```
ACCEPTED → ESCROW_FUNDED → SHIPPED → DELIVERED → VERIFIED → SETTLED
```

### Option B: Split into Two Parallel Status Fields

Separate `commercialStatus` and `paymentStatus` on the PO:

```
commercialStatus: DRAFT → SENT → ACCEPTED → FULFILLING → SHIPPED → DELIVERED → VERIFIED → COMPLETED
paymentStatus:    UNFUNDED → FUNDING → FUNDED → SETTLING → SETTLED → REFUNDED
```

**Pros:**
- Each status is unambiguous — no overloading
- The UI can show both: `Status: Fulfilling` + `Payment: Funded ✅`
- Scales cleanly when payment flows get more complex (partial funding, staged payments, instalment plans)
- Bank-grade: mirrors how real payment systems separate order management from treasury

**Cons:**
- Breaking change: every query, filter, guard, and API response needs updating
- Two fields to keep in sync (need transition rules that prevent invalid combinations)
- Higher complexity for simple POs

**Example UI:**
```
┌──────────────────────────────────────────┐
│  PO-MMOZLUXP-9GCD                       │
│                                          │
│  Order: FULFILLING     Payment: FUNDED ✅ │
│                                          │
│                        [ Mark Shipped ]  │
└──────────────────────────────────────────┘
```

### Option C: Keep Single Status, Add a Display Label Map

Keep the DB enum as-is, but map it to user-friendly display labels:

```typescript
const PO_DISPLAY_LABELS = {
  DRAFT:       "Draft",
  SENT:        "Awaiting Acceptance",
  ACCEPTED:    "Accepted — Awaiting Payment",
  IN_PROGRESS: "Escrow Funded — Ready to Ship",   // ← clear label
  SHIPPED:     "Shipped — In Transit",
  DELIVERED:   "Delivered — Awaiting Verification",
  VERIFIED:    "Verified — Awaiting Settlement",
  SETTLED:     "Settled",
  DISPUTED:    "Disputed",
  CANCELLED:   "Cancelled",
};
```

**Pros:**
- Zero schema changes, zero migration
- Display labels can differ per-role (buyer sees "Awaiting Delivery", supplier sees "Ready to Ship")
- Quick to implement

**Cons:**
- The underlying enum is still misleading in API responses, logs, and developer tooling
- Band-aid: does not fix the root architectural conflation

### Option D: Introduce an Explicit `ESCROW_FUNDED` State Between `ACCEPTED` and `IN_PROGRESS`

```
ACCEPTED → ESCROW_FUNDED → IN_PROGRESS → SHIPPED → ...
```

- `ACCEPTED`: Commercial acceptance, no payment yet
- `ESCROW_FUNDED`: Buyer has funded escrow, payment is locked
- `IN_PROGRESS`: Supplier has acknowledged and begun fulfilment (explicit opt-in)

**Pros:**
- Preserves "IN_PROGRESS" to mean "supplier is actively fulfilling"
- Adds a clear financial milestone as its own state
- Supplier must explicitly acknowledge the funded escrow before starting work

**Cons:**
- Extra step for the supplier (friction)
- One more status to manage in guards/UI

---

## 6. Questions for the Team

1. **Which option do you prefer?** (A / B / C / D / other)

2. **Do we need role-specific display labels?** e.g., buyer sees "Pending Shipment", supplier sees "Ready to Ship — Payment in Escrow"

3. **Should the supplier explicitly "start work"?** (Option D introduces a supplier acknowledgement step between escrow funding and fulfilment — is this desirable or unnecessary friction?)

4. **For bank-grade audit/compliance, should we separate commercial and financial status fields?** (Option B) — this is how institutional payment systems work, but it's a larger refactor.

5. **Are there other status names that feel ambiguous?** e.g. `VERIFIED` — does the buyer "verify delivery" or "verify payment"? Should it be `DELIVERY_VERIFIED`?

---

## 7. Recommendation

For **immediate fix:** **Option C** (display label map) — zero risk, ships today, removes the confusion.

For **bank-grade long-term:** **Option B** (dual status fields) — the right architecture for a regulated payment platform where order management and treasury management are audited separately.

A pragmatic path: ship Option C now, plan Option B for the next major version.

---

_Please add your comments and preference below. We'll discuss in the next engineering sync._
---

---

# Suggested Reply to the Dev Team

Thanks for writing this up — the analysis is correct and this is an important UX/trust issue.

The core problem is that **PO status is currently trying to represent two different things at the same time**:

1. **Commercial lifecycle** (order fulfilment)
2. **Financial lifecycle** (escrow/payment status)

These should **not be encoded into a single field**.

Banks, escrow systems, and trade platforms always treat these as **separate state machines**.

So the correct solution is **not just renaming `IN_PROGRESS`**, but separating the two concerns.

---

# 1. Keep PO Status Purely Commercial

The `PO.status` field should represent **only the commercial lifecycle**.

Example:

```
DRAFT
SENT
ACCEPTED
FULFILLMENT
SHIPPED
DELIVERED
VERIFIED
SETTLED
DISPUTED
CANCELLED
```

The important change:

```
IN_PROGRESS → FULFILLMENT
```

Meaning:

> Supplier may start fulfilling the order.

This removes the ambiguity that payment is “processing”.

---

# 2. Payment State Must Be Separate

The financial state already exists in the system:

```
PaymentInstrument.state
PaymentLock.state
```

These should drive **payment UI**, not PO status.

Example payment states:

```
LOCK_REQUESTED
LOCKED
SETTLEMENT_PENDING
SETTLED
REFUNDED
```

---

# 3. Supplier UI Should Show Two Independent Signals

Instead of relying on PO status to communicate payment certainty, the UI should show **two indicators**:

Example supplier screen:

```
PO-MMOZLUXP-9GCD

Status: FULFILLMENT
Payment: ESCROW LOCKED
```

Or visually:

```
[ ESCROW FUNDED ✓ ]
Supplier may ship goods
```

This removes ambiguity.

The supplier’s decision to ship should depend on:

```
PaymentLock.state == LOCKED
```

not on the PO status.

---

# 4. Shipping Guard Must Check Escrow Lock

The system rule should be:

```
markShipped() allowed only if PaymentLock.state == LOCKED
```

That is the real safety guarantee.

---

# 5. Event Model Remains the Same

Financial actions remain exactly where they are:

```
Buyer funds escrow
→ PaymentLock = LOCKED
→ PO.status → FULFILLMENT
```

and later:

```
Buyer verifies delivery
→ settlement
→ PaymentLock = RELEASED
→ PO.status = SETTLED
```

No change to the ledger model.

---

# 6. Why This Is the Correct Approach

This separation matches how real financial systems work:

Commercial workflow:

```
Order accepted
Goods shipped
Goods delivered
```

Financial workflow:

```
Funds reserved
Funds released
```

They must be **independent but linked**.

---

# 7. Concrete Changes

Proposed changes:

1. Rename:

```
IN_PROGRESS → FULFILLMENT
```

2. UI should show:

```
Payment Secured
Escrow Locked
```

based on `PaymentLock.state`.

3. Supplier shipping guard must enforce:

```
PaymentLock.state == LOCKED
```

---

# 8. Outcome

This gives suppliers a clear mental model:

```
ESCROW LOCKED → Safe to ship
```

And removes the confusion caused by `IN_PROGRESS`.

---

# My Opinion (as architecture guidance)

Your dev team is **thinking in the right direction**. The key is simply:

> **PO status should never try to communicate payment certainty.
> That belongs to the payment/escrow state.**

Once you separate these, the UI becomes intuitive and bank reviewers will find the model much clearer.

---

If you'd like, I can also show you **one more subtle improvement to the state machine that will prevent settlement race conditions between buyer verification and LP funding**, which becomes important once early-payment is active.
