# Financial State Consistency Rules

**Version:** 1.0  
**Created:** 13 March 2026  
**Status:** Active  
**Enforced by:** `IntegrityService` (backend/src/admin/integrity.service.ts)

---

## Overview

This document defines every cross-state-machine invariant in the platform. Each invariant describes a relationship between two or more entities (PO, PaymentLock, PaymentInstrument, EarlyPaymentRequest, Settlement) that **must** hold true at all times. The `IntegrityService` periodically verifies all invariants and reports violations.

---

## Invariant Index

| ID | Rule | Severity | Entities |
|----|------|----------|----------|
| INV-001 | FULFILLMENT+ PO requires a LOCKED PaymentLock | CRITICAL | PO ↔ PaymentLock |
| INV-002 | SETTLED PO requires RELEASED PaymentLock | CRITICAL | PO ↔ PaymentLock |
| INV-003 | SETTLED PO requires SETTLED PaymentInstrument | CRITICAL | PO ↔ PaymentInstrument |
| INV-004 | CANCELLED PO (via FULL_REFUND) requires REFUNDED PaymentLock | HIGH | PO ↔ PaymentLock |
| INV-005 | FUNDED EarlyPayment requires LP beneficiary on Instrument | CRITICAL | EarlyPayment ↔ PaymentInstrument |
| INV-006 | PaymentLock amount must equal PO amount | HIGH | PO ↔ PaymentLock |
| INV-007 | PaymentLock currency must match PO currency | HIGH | PO ↔ PaymentLock |
| INV-008 | PaymentInstrument amount must equal PO amount | HIGH | PO ↔ PaymentInstrument |
| INV-009 | PaymentInstrument currency must match PO currency | HIGH | PO ↔ PaymentInstrument |
| INV-010 | SHIPPED PO requires LOCKED PaymentLock | CRITICAL | PO ↔ PaymentLock |
| INV-011 | DELIVERED PO requires LOCKED PaymentLock | CRITICAL | PO ↔ PaymentLock |
| INV-012 | VERIFIED PO requires LOCKED PaymentLock | CRITICAL | PO ↔ PaymentLock |

---

## Invariant Definitions

### INV-001: FULFILLMENT+ PO requires LOCKED PaymentLock

```
IF PO.status ∈ {FULFILLMENT, SHIPPED, DELIVERED, VERIFIED}
THEN PaymentLock MUST exist AND PaymentLock.status = LOCKED
```

**Rationale:** Once a PO enters FULFILLMENT (escrow funded), a locked payment lock must exist. If the lock is missing or not in LOCKED status, funds may not actually be held.

**Severity:** CRITICAL

---

### INV-002: SETTLED PO requires RELEASED PaymentLock

```
IF PO.status = SETTLED
THEN PaymentLock MUST exist AND PaymentLock.status = RELEASED
```

**Rationale:** Settlement releases funds from escrow. A settled PO whose lock is still LOCKED indicates funds were distributed without release, or the release failed silently.

**Severity:** CRITICAL

---

### INV-003: SETTLED PO requires SETTLED PaymentInstrument

```
IF PO.status = SETTLED
THEN PaymentInstrument MUST exist AND PaymentInstrument.status = SETTLED
```

**Rationale:** The financial instrument tracks the full lifecycle. A settled PO without a settled instrument means the accounting abstraction is out of sync.

**Severity:** CRITICAL

---

### INV-004: CANCELLED PO (with dispute FULL_REFUND) requires REFUNDED PaymentLock

```
IF PO.status = CANCELLED
AND Dispute exists with outcome = FULL_REFUND
THEN PaymentLock MUST exist AND PaymentLock.status = REFUNDED
```

**Rationale:** A full refund dispute should result in the payment lock being refunded. If the lock is still LOCKED after cancellation, buyer funds are trapped.

**Severity:** HIGH

---

### INV-005: FUNDED EarlyPayment requires LP beneficiary on Instrument

```
IF EarlyPaymentRequest.status = FUNDED
THEN PaymentInstrument MUST exist
AND PaymentInstrument.settlementBeneficiary = LIQUIDITY_PROVIDER
```

**Rationale:** When an LP funds an early payment, the instrument's settlement beneficiary must flip to LIQUIDITY_PROVIDER so the LP gets repaid at settlement.

**Severity:** CRITICAL

---

### INV-006: PaymentLock amount must equal PO amount

```
IF PaymentLock exists for PO
THEN PaymentLock.amount = PO.amount
```

**Rationale:** The locked amount must exactly match the PO value. Any mismatch means either too much or too little is held in escrow.

**Severity:** HIGH

---

### INV-007: PaymentLock currency must match PO currency

```
IF PaymentLock exists for PO
THEN PaymentLock.currency = PO.currency
```

**Rationale:** Cross-currency lock/PO mismatch would mean the lock is denominated in the wrong currency.

**Severity:** HIGH

---

### INV-008: PaymentInstrument amount must equal PO amount

```
IF PaymentInstrument exists for PO
THEN PaymentInstrument.amount = PO.amount
```

**Rationale:** The instrument must track the exact PO value for correct settlement arithmetic.

**Severity:** HIGH

---

### INV-009: PaymentInstrument currency must match PO currency

```
IF PaymentInstrument exists for PO
THEN PaymentInstrument.currency = PO.currency
```

**Rationale:** Similar to INV-007 — instrument currency must match the PO currency.

**Severity:** HIGH

---

### INV-010: SHIPPED PO requires LOCKED PaymentLock

```
IF PO.status = SHIPPED
THEN PaymentLock MUST exist AND PaymentLock.status = LOCKED
```

**Rationale:** Goods in transit must still have escrow locked. A SHIPPED PO without a locked payment means the supplier shipped without financial protection.

**Severity:** CRITICAL

---

### INV-011: DELIVERED PO requires LOCKED PaymentLock

```
IF PO.status = DELIVERED
THEN PaymentLock MUST exist AND PaymentLock.status = LOCKED
```

**Rationale:** After delivery, funds remain locked until verification. A DELIVERED PO without a locked payment means funds were released prematurely.

**Severity:** CRITICAL

---

### INV-012: VERIFIED PO requires LOCKED PaymentLock

```
IF PO.status = VERIFIED
THEN PaymentLock MUST exist AND PaymentLock.status = LOCKED
```

**Rationale:** Verified but not yet settled — funds must still be held. Premature release before settlement would lose buyer protection.

**Severity:** CRITICAL

---

## Terminal States (Excluded from Scanning)

POs in the following states are excluded from most invariant checks because they represent completed lifecycles:

- **SETTLED** — checked only for INV-002, INV-003
- **CANCELLED** — checked only for INV-004

POs in pre-escrow states (`DRAFT`, `PENDING_APPROVAL`, `SENT`, `NEGOTIATION`, `ACCEPTED`) are excluded from lock/instrument invariants since those entities haven't been created yet.

---

## Severity Levels

| Severity | Description | Action |
|----------|-------------|--------|
| CRITICAL | Financial inconsistency — funds at risk | Immediate investigation required |
| HIGH | Data inconsistency — may indicate a bug | Investigate within 24 hours |
| MEDIUM | Cosmetic or non-financial inconsistency | Track for next sprint |

---

## Implementation Notes

- The `IntegrityService` runs all invariants in a single database round-trip where possible (batch query with includes)
- Each violation is returned with: `{ invariantId, purchaseOrderId, expected, actual, severity }`
- The integrity checker is exposed via `GET /api/admin/integrity-check` (admin-only)
- A cron job runs the checker on a configurable interval (`INTEGRITY_CHECK_INTERVAL_MINUTES`, default: 60, tests: 0)
- Results are logged and returned — no database persistence of results (kept lightweight; the reconciliation service handles persistent reporting)
