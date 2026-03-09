# Core Event Model

## Overview

The SME Payments platform records every significant business action as an immutable ledger event. This event model serves as the **single source of truth** for what happened, when, and who authorised it — enabling auditors, regulators, counter-parties, and liquidity providers to independently verify the entire procurement-to-settlement lifecycle without trusting the platform itself.

This document describes:

1. **Why** the event model exists (design rationale)
2. **How** the ledger works (hash chain, signatures, verification)
3. **What** events are emitted (the complete 30-event catalogue)
4. **When** each event fires in the PO lifecycle
5. **Where** each event originates in the codebase

---

## 1. Design Rationale

### The Problem

In traditional SME trade finance, trust between buyers, suppliers, and funders relies on emails, phone calls, and paper trails. No single party can independently prove what was agreed, delivered, or paid. This creates friction, delays, and fraud risk — especially when a liquidity provider needs confidence that goods were actually delivered before releasing funds.

### The Solution: One Immutable Event Ledger

Rather than running the entire application on a blockchain (which would hurt performance, UX, and cost), we use a pragmatic architecture:

```
Operational Services (Postgres)     →    generates events
    ↓                                          ↓
Purchase Orders, Settlements,        Immutable Event Ledger
Approvals, Disputes, etc.            (hash-chained, signed)
```

The operational database handles speed and flexibility. Every important action emits an event into a **single, globally hash-chained event log** that forms the trust infrastructure layer.

### Why One Global Chain (Not Per-Entity)

An earlier design used per-entity hash chains (one chain per PO). This was replaced with a single global chain because:

- **Stronger tamper evidence** — deleting or reordering any event, even across different POs, breaks the chain
- **Single audit trail** — regulators and banks want one timeline, not thousands of independent chains
- **Simpler verification** — `GET /ledger/verify` checks the entire history in one pass
- **Cross-entity integrity** — settlement events that span POs, payment locks, and early payments all link into the same chain

### Why Every Event Matters

The 13-event lifecycle from the original architectural feedback has been expanded to **30 distinct events** across 10 categories. The principle is: **if a party needs to prove it happened, it gets an event**. This includes not just the happy path (create → ship → deliver → settle) but also approvals, disputes, evidence, risk snapshots, and funding blocks — because real-world audits ask about edge cases.

---

## 2. Ledger Architecture

### 2.1 Event Record Schema

Every event stored in the `event_log` table contains:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | Primary key |
| `sequence` | Auto-increment integer | Global insertion order |
| `entitySequence` | Integer | Ordering within an entity (e.g. 3rd event for PO-ABC) |
| `entityType` | String | Domain aggregate: `PURCHASE_ORDER`, `PAYMENT_LOCK`, `EARLY_PAYMENT`, `SETTLEMENT`, `DISPUTE`, `LP_RISK` |
| `entityId` | String | Foreign key to the domain entity |
| `eventType` | String | Action identifier (e.g. `PO_CREATED`, `GOODS_SHIPPED`) |
| `actorId` | String | The user who performed the action |
| `actorRole` | String | `BUYER`, `SUPPLIER`, `LIQUIDITY_PARTNER`, `ADMIN`, or `SYSTEM` |
| `payload` | JSON | Structured data specific to the event type |
| `timestamp` | DateTime | When the event was recorded |
| `previousHash` | String | SHA-256 hash of the preceding event (`GENESIS` for the first) |
| `eventHash` | String (unique) | SHA-256 hash of this event's content + previousHash |
| `actorSignature` | String | WebAuthn/FIDO2 passkey signature (base64), or `SYSTEM` |
| `authenticatorData` | String? | WebAuthn authenticator data (for passkey-signed events) |
| `actorPublicKey` | String | Actor's public key (base64), or `SYSTEM` |
| `credentialId` | String? | Which passkey credential produced the signature |
| `intentHash` | String? | SHA-256 of the business intent, used as the WebAuthn challenge |
| `clientDataJSON` | String? | Raw WebAuthn clientDataJSON containing challenge + origin |

### 2.2 Global Hash Chain

Every event links to its predecessor via SHA-256 hashing:

```
Event 1 (GENESIS) → Event 2 → Event 3 → ... → Event N
     ↑                  ↑          ↑              ↑
  previousHash      previousHash  previousHash   previousHash
  = "GENESIS"       = hash(E1)    = hash(E2)     = hash(E(N-1))
```

The hash input for each event is a pipe-delimited string:

```
previousHash | entityType | entityId | entitySequence | eventType
| actorId | actorRole | canonicalStringify(payload) | timestamp
```

**Canonical serialization** (`canonicalStringify`) ensures deterministic key ordering in the payload JSON, preventing PostgreSQL's JSONB key-reordering from breaking hash verification.

### 2.3 Concurrency Safety

The "read last hash → compute new hash → insert" cycle runs inside a **SERIALIZABLE transaction**. Without this, two concurrent writers would read the same `previousHash` and fork the chain.

When PostgreSQL detects a serialization conflict (error code `40001` / Prisma `P2034`), the service retries with **exponential back-off** (up to 5 attempts). This guarantees a strictly linear chain even under concurrent load.

### 2.4 Passkey Signatures (WebAuthn/FIDO2)

Users can register FIDO2 passkeys (Touch ID, Face ID, hardware keys). When a passkey-signed action occurs:

1. The platform computes an **intent hash**: `SHA-256(eventType | entityId | actorId)`
2. This intent hash becomes the **WebAuthn challenge** — binding the biometric to this exact business action
3. The user's authenticator signs the challenge
4. The signature, authenticator data, public key, credential ID, and raw `clientDataJSON` are stored alongside the event

This means each passkey-signed event is **self-contained proof** that a specific person, using a specific device, authorised a specific action at a specific time. No platform trust required — any third party can verify it.

Events without passkey signatures are recorded with `actorSignature = "SYSTEM"`, indicating the action was authenticated via JWT but not biometrically signed.

### 2.5 Proof Bundles

The platform can export **standalone proof bundles** (`GET /api/proofs/:entityId`) that package:

- The event data and its hash chain context
- The signer's identity and credential info
- The issuer (platform) information
- A public key resolution URI
- Step-by-step verification instructions

These bundles can be verified:
- **Online**: `POST /api/proofs/verify` — resolves the public key from the credential registry
- **Offline**: `POST /api/proofs/verify/offline` — uses the embedded public key (trust-on-first-use)

### 2.6 Chain Verification

`GET /api/ledger/verify` performs a full integrity check:

1. Walks every event in insertion order
2. Confirms the first event has `previousHash = "GENESIS"`
3. Confirms each subsequent event's `previousHash` matches the preceding event's `eventHash`
4. Recomputes each event's hash from its content and confirms it matches the stored `eventHash`
5. Reports total event count, signed vs. system event counts

If any event has been tampered with, deleted, or reordered, verification fails with a precise error indicating where the chain broke.

---

## 3. PO Status Lifecycle

Before cataloguing events, it helps to understand the Purchase Order state machine that drives most of them:

```
DRAFT ──→ PENDING_APPROVAL ──→ SENT ──→ ACCEPTED ──→ SHIPPED ──→ DELIVERED ──→ VERIFIED ──→ SETTLED
  │              │                │          │            │           │
  └──→ CANCELLED └──→ CANCELLED   └──→ CANCELLED        │           └──→ DISPUTED
                                       │                 │
                                       └──→ IN_PROGRESS ─┘
```

### Status Transition Table

| From | To | Trigger |
|------|----|---------|
| `DRAFT` | `SENT` | Buyer sends PO (no approval required) |
| `DRAFT` | `PENDING_APPROVAL` | Policy requires multi-sig approval |
| `DRAFT` | `CANCELLED` | Buyer cancels draft |
| `PENDING_APPROVAL` | `SENT` | All required approvals received |
| `PENDING_APPROVAL` | `CANCELLED` | An approver rejects |
| `SENT` | `ACCEPTED` | Supplier accepts; payment lock created |
| `SENT` | `CANCELLED` | Supplier rejects |
| `ACCEPTED` | `SHIPPED` | Supplier marks goods shipped |
| `ACCEPTED` | `IN_PROGRESS` | Work begins (for service POs) |
| `IN_PROGRESS` | `SHIPPED` | Supplier marks goods shipped |
| `IN_PROGRESS` | `DELIVERED` | Supplier marks delivery (skipping ship) |
| `SHIPPED` | `DELIVERED` | Supplier confirms delivery |
| `DELIVERED` | `VERIFIED` | Buyer confirms receipt |
| `DELIVERED` | `DISPUTED` | Buyer disputes delivery |
| `VERIFIED` | `SETTLED` | Buyer acknowledges obligation; settlement executes |

### Why SHIPPED and VERIFIED Are Separate Steps

The original design went directly from ACCEPTED → DELIVERED → SETTLED. Based on architectural feedback recommending a 13-event lifecycle, two intermediate states were added:

- **SHIPPED** — The supplier can record that goods have left their facility before they arrive. This is standard in logistics and gives the buyer visibility into transit. Event: `GOODS_SHIPPED`.
- **VERIFIED** — The buyer confirms goods were received (DELIVERED → VERIFIED) as a separate step from acknowledging the payment obligation (VERIFIED → SETTLED). This separation is critical because:
  - Verifying delivery is a **logistics confirmation** ("the goods arrived")
  - Acknowledging obligation is a **financial commitment** ("I agree to pay")
  - Splitting them gives the buyer a window to inspect goods before triggering irreversible fund movement
  - The `OBLIGATION_ACKNOWLEDGED` event creates an explicit, auditable record of the buyer's payment intent

---

## 4. Complete Event Catalogue

### 4.1 Commercial Events (PO Lifecycle)

These events track the creation, approval, and acceptance of purchase orders.

| Event Type | Actor | Entity Type | Emitted By | Description |
|-----------|-------|-------------|------------|-------------|
| `PO_CREATED` | BUYER | PURCHASE_ORDER | `PurchaseOrdersService.create()` | A new purchase order has been created in DRAFT status |
| `PO_APPROVAL_REQUESTED` | BUYER | PURCHASE_ORDER | `PurchaseOrdersService.send()` | The PO requires multi-sig approval per org policy; parked in PENDING_APPROVAL |
| `PO_AUTO_APPROVED` | BUYER | PURCHASE_ORDER | `PurchaseOrdersService.send()` | Policy required approval but auto-approve rule matched (e.g. amount under threshold) |
| `PO_SENT` | BUYER | PURCHASE_ORDER | `PurchaseOrdersService.send()` | PO has been dispatched to the supplier. May fire via direct send or after approval chain completes |
| `PO_APPROVAL_GRANTED` | BUYER | PURCHASE_ORDER | `PurchaseOrdersService` (approval callback) | The full approval chain is complete; all required approvers have voted APPROVE |
| `PO_ACCEPTED` | SUPPLIER | PURCHASE_ORDER | `PurchaseOrdersService.accept()` | Supplier accepts the PO; payment lock is reserved simultaneously |
| `PO_CANCELLED` | SUPPLIER | PURCHASE_ORDER | `PurchaseOrdersService.reject()` | Supplier rejects the PO |

**Payload examples:**

```jsonc
// PO_CREATED
{ "reference": "PO-M3K5-X7YZ", "supplierId": "...", "amount": 500000, "lineItemCount": 3 }

// PO_ACCEPTED
{ "amount": 500000, "externalRef": "SIM-RSV-...", "settlementRail": "SIMULATED" }

// PO_APPROVAL_REQUESTED
{ "supplierId": "...", "requiredApprovals": 2, "requiredRoles": ["APPROVER", "FINANCE"], "policyRuleId": "..." }
```

### 4.2 Approval Events

These track individual votes within a multi-signature approval chain. The `entityType` and `entityId` are inherited from the entity being approved (currently always `PURCHASE_ORDER`).

| Event Type | Actor | Entity Type | Emitted By | Description |
|-----------|-------|-------------|------------|-------------|
| `PO_APPROVAL_VOTE` | *(dynamic org role)* | *(inherited)* | `ApprovalsService.submitDecision()` | An approver votes APPROVE. May or may not complete the chain |
| `PO_APPROVAL_REJECTED` | *(dynamic org role)* | *(inherited)* | `ApprovalsService.submitDecision()` | An approver votes REJECT. Immediately terminates the approval request |

**Why `PO_APPROVAL_VOTE` is separate from `PO_APPROVAL_GRANTED`:**
An individual vote ("I approve") is a different action from the chain completing ("all required approvers have approved"). Using distinct event types prevents audit confusion — you can trace exactly who voted, when, and whether that vote was the decisive one.

```jsonc
// PO_APPROVAL_VOTE
{ "approvalRequestId": "...", "policyRuleName": "high-value-orders", "decision": "APPROVE", "approvalCount": "2/3" }

// PO_APPROVAL_REJECTED
{ "approvalRequestId": "...", "policyRuleName": "high-value-orders", "comment": "Budget not confirmed" }
```

### 4.3 Logistics Events

These track the physical movement of goods from supplier to buyer.

| Event Type | Actor | Entity Type | Emitted By | Description |
|-----------|-------|-------------|------------|-------------|
| `GOODS_SHIPPED` | SUPPLIER | PURCHASE_ORDER | `PurchaseOrdersService.markShipped()` | Goods have left the supplier's facility. Transitions PO to SHIPPED |
| `DELIVERY_MARKED` | SUPPLIER | PURCHASE_ORDER | `PurchaseOrdersService.markDelivered()` | Supplier confirms goods have been delivered. Transitions PO to DELIVERED |
| `DELIVERY_VERIFIED` | BUYER | PURCHASE_ORDER | `PurchaseOrdersService.verifyDelivery()` | Buyer confirms receipt of goods. Transitions PO to VERIFIED |
| `DELIVERY_DISPUTED` | BUYER | PURCHASE_ORDER | `PurchaseOrdersService.dispute()` | Buyer disputes the delivery (quality, quantity, or non-receipt). Transitions PO to DISPUTED |

```jsonc
// GOODS_SHIPPED
{ "shippedAt": "2026-03-09T14:30:00.000Z" }

// DELIVERY_MARKED
{ "deliveredAt": "2026-03-10T09:15:00.000Z" }

// DELIVERY_VERIFIED
{ "verifiedAt": "2026-03-10T14:00:00.000Z" }
```

### 4.4 Financial Verification Events

This category covers the buyer's explicit acknowledgement of payment obligation — a critical step that separates "I received the goods" from "I agree to pay."

| Event Type | Actor | Entity Type | Emitted By | Description |
|-----------|-------|-------------|------------|-------------|
| `OBLIGATION_ACKNOWLEDGED` | BUYER | PURCHASE_ORDER | `PurchaseOrdersService.acknowledgeObligation()` | Buyer formally acknowledges the payment obligation. Fires immediately before settlement. Creates an auditable record of financial intent |
| `SETTLEMENT_COMPLETED` | BUYER | PURCHASE_ORDER | `PurchaseOrdersService.acknowledgeObligation()` | Funds have been released and the PO is settled. Includes fee breakdown and rail metadata |

**Why `OBLIGATION_ACKNOWLEDGED` exists:**
In regulated trade finance, there must be a clear, timestamped record that the buyer committed to pay — distinct from merely confirming delivery. This event:
- Satisfies audit requirements for explicit financial consent
- Gives liquidity providers confidence that the buyer has acknowledged the debt
- Creates a clean separation between logistics (delivery verified) and finance (payment committed)

```jsonc
// OBLIGATION_ACKNOWLEDGED
{ "totalAmount": 500000, "currency": "GBP", "recipientId": "...", "acknowledgedAt": "2026-03-10T14:05:00.000Z" }

// SETTLEMENT_COMPLETED
{ "totalAmount": 500000, "feeAmount": 2500, "recipientReceives": 497500,
  "earlyPaySettlement": false, "recipientId": "...",
  "settlementRail": "SIMULATED", "externalRef": "SIM-REL-..." }
```

### 4.5 Payment Lock Events

Payment locks represent **escrowed funds** — money reserved from the buyer's balance when a PO is accepted, guaranteeing the supplier will be paid. These events are emitted by the `SettlementService`, which manages the actual fund movements via a pluggable adapter (simulated in dev, bank API in production).

| Event Type | Actor | Entity Type | Emitted By | Description |
|-----------|-------|-------------|------------|-------------|
| `PAYMENT_LOCK_CONFIRMED` | BUYER | PAYMENT_LOCK | `SettlementService.reserveForPO()` | Funds have been locked (escrowed) against the buyer's balance. Fires when supplier accepts |
| `PAYMENT_LOCK_RELEASED` | SYSTEM | PAYMENT_LOCK | `SettlementService.settlePO()` | Locked funds released to the recipient as part of settlement |
| `PAYMENT_LOCK_REFUNDED` | SYSTEM | PAYMENT_LOCK | `SettlementService.refundPO()` | Locked funds returned to the buyer (PO cancelled after lock, or dispute full-refund) |

**Why SYSTEM as actor for release/refund:**
These operations are triggered programmatically by the settlement engine, not by a user clicking a button. Using `SYSTEM` makes the audit trail honest — a human triggered the upstream action (acknowledge obligation or resolve dispute), but the fund movement itself was automatic.

```jsonc
// PAYMENT_LOCK_CONFIRMED
{ "purchaseOrderId": "...", "amount": 500000, "currency": "GBP",
  "externalRef": "SIM-RSV-...", "settlementRail": "SIMULATED" }

// PAYMENT_LOCK_RELEASED
{ "purchaseOrderId": "...", "amount": 500000, "currency": "GBP" }

// PAYMENT_LOCK_REFUNDED
{ "purchaseOrderId": "...", "amount": 500000, "currency": "GBP",
  "reason": "Dispute resolved: FULL_REFUND", "externalRef": "SIM-RFD-..." }
```

### 4.6 Settlement Events

These record the creation of settlement records — the actual movement of money between parties.

| Event Type | Actor | Entity Type | Emitted By | Description |
|-----------|-------|-------------|------------|-------------|
| `SETTLEMENT_INITIATED` | SYSTEM | SETTLEMENT | `SettlementService.settlePO()` | A settlement record has been created. Includes fee breakdown and settlement type (`STANDARD` or `EARLY_PAY_SETTLEMENT`) |
| `EARLY_PAY_FUNDED` | LIQUIDITY_PARTNER | SETTLEMENT | `SettlementService.transferAdvance()` | LP-to-supplier advance transfer has been recorded as a settlement |

```jsonc
// SETTLEMENT_INITIATED
{ "purchaseOrderId": "...", "recipientId": "...", "totalAmount": 500000,
  "feeAmount": 2500, "netAmount": 497500, "currency": "GBP",
  "settlementRail": "SIMULATED", "externalRef": "SIM-REL-...", "type": "STANDARD" }

// EARLY_PAY_FUNDED (settlement-level)
{ "purchaseOrderId": "...", "earlyPaymentRequestId": "...", "lpId": "...",
  "supplierId": "...", "amount": 450000, "currency": "GBP",
  "settlementRail": "SIMULATED", "externalRef": "SIM-TRF-..." }
```

### 4.7 Liquidity / Early Payment Events

These track the early payment lifecycle — where a supplier requests advance funding against an accepted PO and a liquidity partner provides it.

| Event Type | Actor | Entity Type | Emitted By | Description |
|-----------|-------|-------------|------------|-------------|
| `EARLY_PAY_REQUESTED` | SUPPLIER | EARLY_PAYMENT | `EarlyPaymentsService.request()` | Supplier requests early payment against an accepted/in-progress/delivered PO |
| `EARLY_PAY_FUNDED` | LIQUIDITY_PARTNER | EARLY_PAYMENT | `EarlyPaymentsService.fund()` | LP successfully funds the request; supplier receives the advance |
| `EARLY_PAY_BLOCKED` | LIQUIDITY_PARTNER | EARLY_PAYMENT | `EarlyPaymentsService.fund()` | LP funding attempt blocked by risk policy (concentration limit, exposure cap, etc.) |

**Note:** `EARLY_PAY_FUNDED` appears in two categories — once at the EARLY_PAYMENT entity level (recording the logical funding decision) and once at the SETTLEMENT entity level (recording the actual fund transfer). These are two events in the same chain, providing both the business context and the financial execution record.

```jsonc
// EARLY_PAY_REQUESTED
{ "purchaseOrderId": "...", "faceValue": 500000, "serviceFee": 12500, "netAdvance": 487500 }

// EARLY_PAY_FUNDED (early-payment-level)
{ "netAdvance": 487500, "serviceFee": 12500, "faceValue": 500000,
  "settlementRail": "SIMULATED", "externalRef": "SIM-TRF-..." }

// EARLY_PAY_BLOCKED
{ "reason": "Buyer concentration exceeds limit", "currentExposure": 750000,
  "limits": { "maxBuyerConcentration": 500000 }, "requestedAmount": 300000 }
```

### 4.8 Dispute Events

These track the formal dispute resolution process when a buyer challenges a delivery.

| Event Type | Actor | Entity Type | Emitted By | Description |
|-----------|-------|-------------|------------|-------------|
| `DISPUTE_RAISED` | BUYER | DISPUTE | `DisputesService.raise()` | Buyer raises a formal dispute on a delivered PO |
| `DISPUTE_EVIDENCE_SUBMITTED` | BUYER or SUPPLIER | DISPUTE | `DisputesService.submitEvidence()` | Either party submits evidence for an open dispute |
| `DISPUTE_UNDER_REVIEW` | ADMIN | DISPUTE | `DisputesService.markUnderReview()` | Admin marks the dispute as under review |
| `DISPUTE_RESOLVED` | ADMIN | DISPUTE | `DisputesService.resolve()` | Admin resolves the dispute with an outcome |

**Dispute outcomes:** `FULL_REFUND`, `PARTIAL_REFUND`, `RELEASE_TO_SUPPLIER`, `REWORK`

```jsonc
// DISPUTE_RAISED
{ "purchaseOrderId": "...", "reason": "Goods damaged in transit", "evidenceIds": ["...", "..."] }

// DISPUTE_RESOLVED
{ "outcome": "PARTIAL_REFUND", "refundAmount": 250000,
  "resolutionNotes": "50% refund for damaged items", "purchaseOrderId": "..." }
```

### 4.9 Evidence Events

| Event Type | Actor | Entity Type | Emitted By | Description |
|-----------|-------|-------------|------------|-------------|
| `EVIDENCE_UPLOADED` | *(dynamic)* | PURCHASE_ORDER | `EvidenceService.upload()` | File evidence (delivery note, photo, invoice, etc.) uploaded. Includes SHA-256 hash of the file for tamper detection |

```jsonc
// EVIDENCE_UPLOADED
{ "attachmentId": "...", "type": "DELIVERY_NOTE", "filename": "delivery-001.pdf",
  "mimeType": "application/pdf", "sizeBytes": 245000, "sha256Hash": "a1b2c3..." }
```

### 4.10 Risk Events

| Event Type | Actor | Entity Type | Emitted By | Description |
|-----------|-------|-------------|------------|-------------|
| `EXPOSURE_SNAPSHOT` | LIQUIDITY_PARTNER | LP_RISK | `LpRiskService.snapshot()` | Periodic LP exposure snapshot. Only logged when risk alerts are detected |

```jsonc
// EXPOSURE_SNAPSHOT
{ "snapshotId": "...", "totalExposure": 1500000, "fundingLimit": 2000000,
  "utilisationPct": 75, "alertCount": 2, "fundingSuspended": false }
```

---

## 5. Complete Lifecycle Example

Here is a typical happy-path flow showing every event that would appear in the ledger for a standard PO from creation to settlement:

```
Seq  Event                      Actor          Status After
───  ─────────────────────────  ─────────────  ────────────
 1   PO_CREATED                 Buyer          DRAFT
 2   PO_SENT                    Buyer          SENT
 3   PO_ACCEPTED                Supplier       ACCEPTED
 4   PAYMENT_LOCK_CONFIRMED     Buyer          (lock created)
 5   GOODS_SHIPPED              Supplier       SHIPPED
 6   DELIVERY_MARKED            Supplier       DELIVERED
 7   DELIVERY_VERIFIED          Buyer          VERIFIED
 8   OBLIGATION_ACKNOWLEDGED    Buyer          (settlement begins)
 9   PAYMENT_LOCK_RELEASED      System         (funds unlocked)
10   SETTLEMENT_INITIATED       System         (settlement record)
11   SETTLEMENT_COMPLETED       Buyer          SETTLED
```

### With Early Payment

If the supplier requested early payment after acceptance:

```
Seq  Event                      Actor          Status After
───  ─────────────────────────  ─────────────  ────────────
 1   PO_CREATED                 Buyer          DRAFT
 2   PO_SENT                    Buyer          SENT
 3   PO_ACCEPTED                Supplier       ACCEPTED
 4   PAYMENT_LOCK_CONFIRMED     Buyer          (lock created)
 5   EARLY_PAY_REQUESTED        Supplier       (EP requested)
 6   EARLY_PAY_FUNDED (EP)      LP             (EP funded)
 7   EARLY_PAY_FUNDED (settle)  LP             (transfer record)
 8   GOODS_SHIPPED              Supplier       SHIPPED
 9   DELIVERY_MARKED            Supplier       DELIVERED
10   DELIVERY_VERIFIED          Buyer          VERIFIED
11   OBLIGATION_ACKNOWLEDGED    Buyer          (settlement begins)
12   PAYMENT_LOCK_RELEASED      System         (funds unlocked)
13   SETTLEMENT_INITIATED       System         (settlement → LP)
14   SETTLEMENT_COMPLETED       Buyer          SETTLED
```

### With Multi-Sig Approval

If the buyer's organisation has a policy requiring multiple approvers:

```
Seq  Event                      Actor          Status After
───  ─────────────────────────  ─────────────  ────────────
 1   PO_CREATED                 Buyer          DRAFT
 2   PO_APPROVAL_REQUESTED      Buyer          PENDING_APPROVAL
 3   PO_APPROVAL_VOTE           Approver 1     (1/2 approved)
 4   PO_APPROVAL_VOTE           Approver 2     (2/2 approved)
 5   PO_APPROVAL_GRANTED        Buyer          PENDING_APPROVAL
 6   PO_SENT                    Buyer          SENT
     ... (continues as standard flow)
```

### With Dispute

```
Seq  Event                         Actor         Status After
───  ────────────────────────────  ────────────  ────────────
 ...  (standard flow up to DELIVERED)
 7   DELIVERY_DISPUTED             Buyer          DISPUTED
 8   DISPUTE_RAISED                Buyer          (dispute created)
 9   EVIDENCE_UPLOADED             Buyer          (photo evidence)
10   DISPUTE_EVIDENCE_SUBMITTED    Buyer          (evidence attached)
11   DISPUTE_UNDER_REVIEW          Admin          (under review)
12   DISPUTE_RESOLVED              Admin          (outcome decided)
13   PAYMENT_LOCK_REFUNDED         System         (funds returned)
```

---

## 6. Entity Types

Events are grouped by entity type. A single purchase order flow produces events across multiple entity types:

| Entity Type | Description | Examples |
|------------|-------------|----------|
| `PURCHASE_ORDER` | The core commercial agreement | `PO_CREATED`, `GOODS_SHIPPED`, `DELIVERY_VERIFIED` |
| `PAYMENT_LOCK` | Escrowed buyer funds | `PAYMENT_LOCK_CONFIRMED`, `_RELEASED`, `_REFUNDED` |
| `EARLY_PAYMENT` | Supplier advance funding request | `EARLY_PAY_REQUESTED`, `_FUNDED`, `_BLOCKED` |
| `SETTLEMENT` | Actual fund transfer record | `SETTLEMENT_INITIATED`, `EARLY_PAY_FUNDED` |
| `DISPUTE` | Formal dispute process | `DISPUTE_RAISED`, `_EVIDENCE_SUBMITTED`, `_RESOLVED` |
| `LP_RISK` | Liquidity partner exposure | `EXPOSURE_SNAPSHOT` |

---

## 7. Settlement Rail Abstraction

All settlement events include `settlementRail` and `externalRef` in their payloads. The settlement service uses a **pluggable adapter pattern**:

| Adapter | `settlementRail` Value | `externalRef` Pattern | Purpose |
|---------|----------------------|----------------------|---------|
| `SimulatedAdapter` | `SIMULATED` | `SIM-RSV-*`, `SIM-REL-*`, `SIM-TRF-*`, `SIM-RFD-*` | Development and testing |
| `KSABankTransferAdapter` | `KSA_BANK_TRANSFER` | `SARIE-RSV-*`, `SARIE-REL-*`, `SARIE-TRF-*`, `SARIE-RFD-*` | Saudi Arabia via SARIE/ACH rails |

The external reference is stored in the ledger event payload, creating a bridge between the platform's event chain and external banking systems. This allows reconciliation: given a bank reference, you can find the corresponding ledger event and trace it back to the original PO.

---

## 8. Cryptographic Guarantees

### What the ledger proves:

1. **Ordering** — Events have a strict global sequence. No event can be inserted between two existing events without breaking the hash chain.
2. **Completeness** — Removing any event breaks the chain at that point.
3. **Integrity** — Modifying any event's content (payload, actor, timestamp) changes its hash, which breaks the link from the next event.
4. **Non-repudiation** (for passkey-signed events) — The WebAuthn signature binds a specific person's biometric to a specific business action. The intent hash in the challenge proves what was being authorised.
5. **Independent verifiability** — Proof bundles contain everything needed to verify a signature without trusting the platform.

### What the ledger does NOT prove:

- **Real-world truth** — The ledger proves that someone clicked "Mark Delivered," not that goods actually arrived. Physical verification remains out of scope.
- **Timestamp accuracy** — Timestamps come from the application server. A compromised server could backdate events (though the hash chain would still enforce ordering).
- **Key authenticity** — For passkey-signed events, the public key is resolved from the platform's credential registry. A compromised registry could substitute keys. The proof bundle includes a resolution URI for external validation.

---

## 9. Source Map

For developers working with the codebase, here is where each event category is emitted:

| Service | File | Events |
|---------|------|--------|
| `PurchaseOrdersService` | `backend/src/purchase-orders/purchase-orders.service.ts` | `PO_CREATED`, `PO_SENT`, `PO_ACCEPTED`, `PO_CANCELLED`, `PO_APPROVAL_REQUESTED`, `PO_AUTO_APPROVED`, `PO_APPROVAL_GRANTED`, `GOODS_SHIPPED`, `DELIVERY_MARKED`, `DELIVERY_VERIFIED`, `DELIVERY_DISPUTED`, `OBLIGATION_ACKNOWLEDGED`, `SETTLEMENT_COMPLETED` |
| `ApprovalsService` | `backend/src/approvals/approvals.service.ts` | `PO_APPROVAL_VOTE`, `PO_APPROVAL_REJECTED` |
| `SettlementService` | `backend/src/settlements/settlement.service.ts` | `PAYMENT_LOCK_CONFIRMED`, `PAYMENT_LOCK_RELEASED`, `PAYMENT_LOCK_REFUNDED`, `SETTLEMENT_INITIATED`, `EARLY_PAY_FUNDED` (settlement-level) |
| `EarlyPaymentsService` | `backend/src/early-payments/early-payments.service.ts` | `EARLY_PAY_REQUESTED`, `EARLY_PAY_FUNDED` (EP-level), `EARLY_PAY_BLOCKED` |
| `DisputesService` | `backend/src/disputes/disputes.service.ts` | `DISPUTE_RAISED`, `DISPUTE_EVIDENCE_SUBMITTED`, `DISPUTE_UNDER_REVIEW`, `DISPUTE_RESOLVED` |
| `EvidenceService` | `backend/src/evidence/evidence.service.ts` | `EVIDENCE_UPLOADED` |
| `LpRiskService` | `backend/src/risk/lp-risk.service.ts` | `EXPOSURE_SNAPSHOT` |
| `LedgerController` | `backend/src/ledger/ledger.controller.ts` | Generic passkey-signed events (delegates to `logEvent`) |

All events flow through `LedgerService.logEvent()` in `backend/src/ledger/ledger.service.ts`, which handles hash chaining, serialization safety, and persistence.

---

## 10. Shared Enum Definitions

All event types and entity types are defined as TypeScript enums in `packages/shared/src/constants/enums.ts`, shared between backend and frontend. This ensures type safety across the stack and prevents typos in event type strings.

The `EventType` enum is organised by category with comments matching the sections in this document. Any new event type must be added there first.
