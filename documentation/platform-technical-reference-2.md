# SME Payments Platform — Technical Reference

**Version:** 2.1  
**Date:** 11 March 2026  
**Audience:** Engineering team, auditors, integration partners, regulators  
**Status:** Production-ready (312/312 tests passing, 19 test suites, isolated test database)

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Architecture Overview](#2-architecture-overview)
3. [Purchase Order State Machine](#3-purchase-order-state-machine)
   - 3.1 [All PO States](#31-all-po-states)
   - 3.2 [Complete Transition Table](#32-complete-transition-table)
   - 3.3 [PO State Diagram](#33-po-state-diagram)
   - 3.4 [PO Creation & Validation](#34-po-creation--validation)
   - 3.5 [Approval Chain](#35-approval-chain)
   - 3.6 [Negotiation (Counter-Proposals)](#36-negotiation-counter-proposals)
   - 3.7 [Fulfilment Flow](#37-fulfilment-flow)
   - 3.8 [Settlement Flow](#38-settlement-flow)
   - 3.9 [Dispute Resolution](#39-dispute-resolution)
4. [Early Payment State Machine](#4-early-payment-state-machine)
   - 4.1 [All Early Payment States](#41-all-early-payment-states)
   - 4.2 [Complete Transition Table](#42-complete-transition-table)
   - 4.3 [Early Payment State Diagram](#43-early-payment-state-diagram)
   - 4.4 [LP Funding Policy & Risk Controls](#44-lp-funding-policy--risk-controls)
   - 4.5 [Expiry Logic](#45-expiry-logic)
5. [Payment Lock State Machine](#5-payment-lock-state-machine)
6. [Settlement State Machine](#6-settlement-state-machine)
7. [Dispute State Machine](#7-dispute-state-machine)
8. [The Immutable Ledger](#8-the-immutable-ledger)
   - 8.1 [Design Principles](#81-design-principles)
   - 8.2 [Hash Chain Algorithm](#82-hash-chain-algorithm)
   - 8.3 [Canonical JSON Serialization](#83-canonical-json-serialization)
   - 8.4 [Concurrency & Retry Logic](#84-concurrency--retry-logic)
   - 8.5 [Event Types Reference](#85-event-types-reference)
9. [Merkle Tree Anchoring & External Notarization](#9-merkle-tree-anchoring--external-notarization)
   - 9.1 [Overview](#91-overview)
   - 9.2 [Merkle Tree Algorithm](#92-merkle-tree-algorithm)
   - 9.3 [Anchor Creation Flow](#93-anchor-creation-flow)
   - 9.4 [External Anchoring via Sigstore Rekor](#94-external-anchoring-via-sigstore-rekor)
   - 9.5 [Anchor Provider Architecture](#95-anchor-provider-architecture)
   - 9.6 [Inclusion Proofs](#96-inclusion-proofs)
   - 9.7 [Anchor Chain Verification](#97-anchor-chain-verification)
   - 9.8 [Auto-Anchoring Scheduler](#98-auto-anchoring-scheduler)
   - 9.9 [LedgerAnchor Schema](#99-ledgeranchor-schema)
10. [Passkey Signing (WebAuthn)](#10-passkey-signing-webauthn)
    - 10.1 [Challenge Generation](#101-challenge-generation)
    - 10.2 [Assertion Verification](#102-assertion-verification)
    - 10.3 [What Gets Stored](#103-what-gets-stored)
11. [Trust Envelope (Evidence Pack v2.0)](#11-trust-envelope-evidence-pack-v20)
    - 11.1 [Purpose](#111-purpose)
    - 11.2 [Generation Flow](#112-generation-flow)
    - 11.3 [Complete Envelope Structure](#113-complete-envelope-structure)
    - 11.4 [Section-by-Section Reference](#114-section-by-section-reference)
    - 11.5 [Integrity Hash Hierarchy](#115-integrity-hash-hierarchy)
    - 11.6 [Platform Signature](#116-platform-signature)
12. [Proof Bundles](#12-proof-bundles)
    - 12.1 [Structure](#121-structure)
    - 12.2 [Per-Event vs Per-Entity Generation](#122-per-event-vs-per-entity-generation)
    - 12.3 [Public Registries](#123-public-registries)
13. [Verification System](#13-verification-system)
    - 13.1 [Three Layers of Verification](#131-three-layers-of-verification)
    - 13.2 [Full Envelope Verification — 15 Checks](#132-full-envelope-verification--15-checks)
    - 13.3 [Standalone CLI Verifier](#133-standalone-cli-verifier)
    - 13.4 [Web Verification Service](#134-web-verification-service)
    - 13.5 [Proof Bundle Verification — 7 Steps](#135-proof-bundle-verification--7-steps)
14. [Cryptographic Primitives](#14-cryptographic-primitives)
    - 14.1 [Algorithms Used](#141-algorithms-used)
    - 14.2 [COSE → SPKI Key Conversion](#142-cose--spki-key-conversion)
    - 14.3 [DER Signature Encoding](#143-der-signature-encoding)
    - 14.4 [Platform Signing Key Management](#144-platform-signing-key-management)
15. [Evidence Attachments](#15-evidence-attachments)
16. [API Reference](#16-api-reference)
17. [Local Receipts (Layer 4)](#17-local-receipts-layer-4)
    - 17.1 [Trust Model Context](#171-trust-model-context)
    - 17.2 [Receipt Format](#172-receipt-format)
    - 17.3 [Backend: Receipt Generation](#173-backend-receipt-generation)
    - 17.4 [Frontend: IndexedDB Storage](#174-frontend-indexeddb-storage)
    - 17.5 [Verification Endpoint](#175-verification-endpoint)
    - 17.6 [My Receipts Dashboard](#176-my-receipts-dashboard)
18. [Testing Infrastructure](#18-testing-infrastructure)
    - 18.1 [Test Database Isolation](#181-test-database-isolation)
    - 18.2 [Test Lifecycle](#182-test-lifecycle)
19. [Security Considerations](#19-security-considerations)

---

## 1. Introduction

The SME Payments Platform is a B2B trade finance system that enables buyers and suppliers to manage purchase orders, lock payments, settle transactions, and — optionally — access early payment via liquidity partners (LPs). The platform is differentiated by its **cryptographic trust infrastructure**: every significant business action is recorded in an immutable, hash-chained ledger, optionally signed with the user's biometric passkey (WebAuthn FIDO2), and packaged into a **Trust Envelope** that any external party (bank, regulator, auditor) can independently verify without trusting the platform.

### Key Capabilities

- **Purchase Order Lifecycle** — Create, negotiate, approve, fulfil, verify, and settle POs with role-based guards at every transition
- **Payment Locks** — Buyer funds are reserved on PO acceptance and released on settlement, ensuring supplier confidence
- **Early Payment** — Suppliers can request early payment; liquidity partners fund advances against locked POs
- **Immutable Ledger** — Append-only event log with per-entity SHA-256 hash chains
- **Merkle Tree Anchoring** — Periodic global anchors: a binary SHA-256 Merkle tree over all entity head hashes, producing a single root that commits to the entire ledger state
- **External Notarization (Sigstore Rekor)** — Merkle roots are published to the Sigstore Rekor transparency log, providing independently verifiable, tamper-evident timestamps from a neutral third party
- **Passkey Signing** — Biometric WebAuthn signatures bind human approvals to specific business actions
- **Trust Envelopes** — Self-contained, cryptographically verifiable JSON documents proving the complete transaction lifecycle, including Merkle inclusion proofs and embedded Rekor receipts
- **Independent Verification** — 15-check verification pipeline, standalone CLI script (with `--live` Rekor verification), and public web verification service

---

## 2. Architecture Overview

### Core Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| **PurchaseOrdersService** | `src/purchase-orders/` | PO lifecycle state machine |
| **EarlyPaymentsService** | `src/early-payments/` | Early payment request/fund lifecycle |
| **PaymentLocksService** | `src/payment-locks/` | Payment lock lifecycle |
| **SettlementService** | `src/settlements/` | Fund reservation, release, refund via pluggable adapters |
| **LedgerService** | `src/ledger/` | Append-only event log with hash chain |
| **ProofGeneratorService** | `src/proofs/` | Self-contained proof bundles per event |
| **ProofVerifierService** | `src/proofs/` | Stateless per-bundle verification (7 steps) |
| **EvidenceService** | `src/evidence/` | File attachments + Trust Envelope assembly |
| **VerifyService** | `src/verify/` | Full envelope verification (15 checks) |
| **NodeCryptoService** | `src/crypto/` | All hashing, signing, verification (global DI) |
| **AnchorService** | `src/ledger/` | Merkle tree anchoring, inclusion proofs, anchor chain verification |
| **AnchorSchedulerService** | `src/ledger/` | Auto-anchoring on configurable interval |
| **RekorProvider** | `src/ledger/anchor-providers/` | External anchoring via Sigstore Rekor transparency log |
| **NoopProvider** | `src/ledger/anchor-providers/` | No-op anchor provider for development/testing |
| **ApprovalsService** | `src/approvals/` | Org policy-based multi-signature approval chain |
| **PoliciesService** | `src/policies/` | Configurable business rules (PO limits, approval thresholds, LP risk) |
| **DisputesService** | `src/disputes/` | Dispute lifecycle with ADMIN resolution |
| **PasskeysService** | `src/passkeys/` | WebAuthn credential registration and assertion |

### Data Flow — Transaction Lifecycle

```
Buyer creates PO
    → LedgerService.logEvent(PO_CREATED)
        → Hash chain extended (entity-scoped)

Supplier accepts PO
    → SettlementService.reserveForPO() — funds locked
    → LedgerService.logEvent(PO_ACCEPTED)
    → If passkey: WebAuthn signature stored with event

Supplier ships/delivers → ledger events

Buyer verifies delivery
    → LedgerService.logEvent(DELIVERY_VERIFIED)

Buyer acknowledges payment obligation
    → SettlementService.settlePO() — funds released
    → LedgerService.logEvent(SETTLEMENT_COMPLETED)
    → PO → SETTLED (terminal)

Periodic or manual: POST /api/ledger/anchor
    → AnchorService.createAnchor()
    → Merkle tree built from all entity head hashes
    → Merkle root signed with platform ECDSA P-256 key
    → Root published to Sigstore Rekor transparency log
    → LedgerAnchor record stored with Rekor receipt

At any point: GET /api/evidence/po/:id/pack
    → Trust Envelope generated on demand
    → All events, proofs, signatures, integrity hashes
    → Merkle inclusion proof for this entity
    → Embedded Rekor receipt for offline verification
    → Platform signature seals the envelope
```

### Settlement Adapter Pattern

The platform delegates actual money movement to a pluggable `SettlementAdapter` interface:

| Adapter | Purpose |
|---------|---------|
| `SimulatedAdapter` | In-memory balance tracking for development/demo |
| `KsaBankAdapter` | Saudi bank rail integration (production) |

This means the trust/evidence layer is independent of the actual payment rail.

---

## 3. Purchase Order State Machine

### 3.1 All PO States

| State | Description | Terminal? |
|-------|-------------|-----------|
| `DRAFT` | Initial state on creation | No |
| `PENDING_APPROVAL` | Awaiting org policy approval chain | No |
| `SENT` | Sent to supplier, ready for acceptance | No |
| `NEGOTIATION` | Counter-proposal in progress | No |
| `ACCEPTED` | Supplier accepted; payment locked | No |
| `IN_PROGRESS` | Work underway (also used after REWORK dispute resolution) | No |
| `SHIPPED` | Goods shipped by supplier | No |
| `DELIVERED` | Goods delivered; buyer can verify or dispute | No |
| `VERIFIED` | Buyer confirmed delivery | No |
| `SETTLED` | Payment released; lifecycle complete | **Yes** |
| `DISPUTED` | Buyer raised a formal dispute | No |
| `CANCELLED` | PO cancelled (rejection, negotiation failure, or full refund) | **Yes** |

### 3.2 Complete Transition Table

| # | From | To | Method | Actor | Guards | Ledger Event | Side Effects |
|---|------|-----|--------|-------|--------|-------------|--------------|
| 1 | — | `DRAFT` | `create()` | BUYER | Supplier exists with SUPPLIER role; amount within org policy limits (currency-aware: GBP £500–£250k, SAR ر.س1,875–ر.س937,500 defaults) | `PO_CREATED` | Tax computed; reference number generated |
| 2 | `DRAFT` | `PENDING_APPROVAL` | `send()` | BUYER | `po.buyerId === actorId`; org policy requires approval and does NOT auto-approve | `PO_APPROVAL_REQUESTED` | `ApprovalRequest` created with 7-day expiry |
| 3 | `DRAFT` | `SENT` | `send()` | BUYER | `po.buyerId === actorId`; no policy match OR policy auto-approves | `PO_AUTO_APPROVED` (if auto) + `PO_SENT` | — |
| 4 | `PENDING_APPROVAL` | `SENT` | `onApprovalComplete()` | SYSTEM (approval chain) | All required approvals received | `PO_APPROVAL_GRANTED` + `PO_SENT` | — |
| 5 | `SENT` | `ACCEPTED` | `accept()` | SUPPLIER | `po.supplierId === actorId`; buyer balance ≥ PO amount | `PO_ACCEPTED` | **Payment lock created** (buyer funds reserved); PaymentLock record (LOCKED); `PAYMENT_LOCK_CONFIRMED` event |
| 6 | `SENT` | `CANCELLED` | `reject()` | SUPPLIER | `po.supplierId === actorId` | `PO_CANCELLED` | — |
| 7 | `SENT` | `NEGOTIATION` | `counterPropose()` | SUPPLIER | `po.supplierId === actorId` | `PO_COUNTER_PROPOSED` | `PORevision` record created |
| 8 | `NEGOTIATION` | `NEGOTIATION` | `counterPropose()` | OTHER PARTY | Cannot counter own latest proposal; actor must be a PO party | `PO_COUNTER_PROPOSED` | Prior PENDING revision marked SUPERSEDED; new `PORevision` created |
| 9 | `NEGOTIATION` | `SENT` | `acceptCounter()` | OTHER PARTY | Latest revision is PENDING; cannot accept own proposal | `PO_COUNTER_ACCEPTED` | Revision's lineItems/amount/terms applied to PO; revision marked ACCEPTED |
| 10 | `NEGOTIATION` | `CANCELLED` | `rejectCounter()` | OTHER PARTY | Latest revision is PENDING; cannot reject own proposal | `PO_COUNTER_REJECTED` | Revision marked REJECTED |
| 11 | `ACCEPTED` / `IN_PROGRESS` | `SHIPPED` | `markShipped()` | SUPPLIER | `po.supplierId === actorId`; status is ACCEPTED or IN_PROGRESS | `GOODS_SHIPPED` | `shippedAt` set |
| 12 | `ACCEPTED` / `IN_PROGRESS` / `SHIPPED` | `DELIVERED` | `markDelivered()` | SUPPLIER | `po.supplierId === actorId`; status is ACCEPTED, IN_PROGRESS, or SHIPPED | `DELIVERY_MARKED` | `deliveredAt` set |
| 13 | `DELIVERED` | `VERIFIED` | `verifyDelivery()` | BUYER | `po.buyerId === actorId` | `DELIVERY_VERIFIED` | `verifiedAt` set |
| 14 | `VERIFIED` | `SETTLED` | `acknowledgeObligation()` | BUYER | `po.buyerId === actorId` | `OBLIGATION_ACKNOWLEDGED` + `SETTLEMENT_COMPLETED` | Settlement executed (see §3.8) |
| 15 | `DELIVERED` | `DISPUTED` | `dispute()` | BUYER | `po.buyerId === actorId` | `DELIVERY_DISPUTED` | Unfunded early payment auto-expired if exists |
| 16 | `DELIVERED` | `DISPUTED` | `DisputesService.raise()` | BUYER | Within dispute window (72h default); no active dispute | `DISPUTE_RAISED` | `Dispute` record created |
| 17 | `DISPUTED` | `CANCELLED` | `resolve(FULL_REFUND)` | ADMIN | Dispute exists and not RESOLVED | `DISPUTE_RESOLVED` | Full refund to buyer; PaymentLock → REFUNDED |
| 18 | `DISPUTED` | `SETTLED` | `resolve(PARTIAL_REFUND)` | ADMIN | `refundAmount > 0 && < po.amount` | `DISPUTE_RESOLVED` | Partial refund to buyer |
| 19 | `DISPUTED` | `VERIFIED` | `resolve(RELEASE_TO_SUPPLIER)` | ADMIN | Dispute exists | `DISPUTE_RESOLVED` | Full settlement to supplier (0.5% fee) |
| 20 | `DISPUTED` | `IN_PROGRESS` | `resolve(REWORK)` | ADMIN | Dispute exists | `DISPUTE_RESOLVED` | No settlement; supplier redoes work |

### 3.3 PO State Diagram

```
                                              ┌──────────┐
                                              │CANCELLED │ (terminal)
                                              └──────────┘
                                                ▲  ▲  ▲
                       reject() ────────────────┘  │  │
                       rejectCounter() ────────────┘  │
                       resolve(FULL_REFUND) ──────────┘
                                                      
 create()    send()              accept()
 ───────► DRAFT ───────► SENT ──────────► ACCEPTED
            │     ▲  │                      │   │
            │     │  │ counterPropose()     │   │
            │     │  ▼                      │   │
            │     │ NEGOTIATION ◄─┐         │   │
            │     │  │ ▲          │         │   │
            │     │  └─┘ counter  │         │   │
            │     │  loop         │         │   │
            │     └──── acceptCounter()     │   │
            │                               │   │
            ├──► PENDING_APPROVAL ──────► SENT  │
            │    (org policy gate)              │
            │                                   │
            │                   markShipped()   │
            │   ACCEPTED / IN_PROGRESS ───► SHIPPED
            │          │                      │
            │          │ markDelivered()       │ markDelivered()
            │          ▼                      ▼
            │       DELIVERED ◄───────────────┘
            │       │        │
            │  verifyDelivery()  dispute() / raise()
            │       │        │
            │       ▼        ▼
            │    VERIFIED   DISPUTED
            │       │       │   │   │   │
            │ acknowledge() │   │   │   │
            │       │       │   │   │   │
            │       ▼       │   │   │   │
            │    SETTLED    │   │   │   │
            │   (terminal)  │   │   │   │
            │               │   │   │   │
            │    ┌──────────┘   │   │   │
            │    │  FULL_REFUND │   │   │
            │    ▼              │   │   │
            │ CANCELLED         │   │   │
            │                   │   │   │
            │    ┌──────────────┘   │   │
            │    │ PARTIAL_REFUND   │   │
            │    ▼                  │   │
            │ SETTLED               │   │
            │                       │   │
            │    ┌──────────────────┘   │
            │    │ RELEASE_TO_SUPPLIER  │
            │    ▼                      │
            │ VERIFIED ──► SETTLED      │
            │                           │
            │    ┌──────────────────────┘
            │    │ REWORK
            │    ▼
            │ IN_PROGRESS ──► SHIPPED ──► DELIVERED ──► ... (cycle)
```

### 3.4 PO Creation & Validation

When a buyer creates a PO:

1. **Supplier validation** — The target user must exist and have the `SUPPLIER` role
2. **Amount limits** — The platform evaluates the buyer's organisation's `PO_ORDER_LIMITS` policy rule. Defaults:
   - GBP: £500 minimum, £250,000 maximum
   - SAR: ر.س1,875 minimum, ر.س937,500 maximum
3. **Tax computation** — VAT is computed based on jurisdiction (UK 20%, KSA 15%)
4. **Reference generation** — Unique PO reference number (e.g., `PO-ABCD1234-XY12`)

### 3.5 Approval Chain

The platform supports configurable multi-signature approval policies:

1. **Policy evaluation** — When the buyer calls `send()`, the system checks the buyer's org for an active `PO_APPROVAL` policy rule matching the PO amount range
2. **Auto-approve** — If no policy matches, or the policy has `autoApprove: true`, the PO goes directly to `SENT`
3. **Approval required** — If a policy matches, the PO enters `PENDING_APPROVAL` and an `ApprovalRequest` is created (7-day expiry, optional escalation)
4. **Voting** — Authorised users in the buyer's organisation submit approve/reject decisions. A single reject immediately rejects the request.
5. **Threshold** — When the number of approvals meets `requiredApprovals`, the request completes and the PO transitions to `SENT`

Each approval vote is logged to the ledger as `PO_APPROVAL_VOTE`.

### 3.6 Negotiation (Counter-Proposals)

The negotiation system supports multi-round counter-proposals:

1. **Initiation** — Only the supplier can initiate negotiation from `SENT` via `counterPropose()`
2. **Turn alternation** — Each counter-proposal must come from the opposite party. You cannot counter your own latest proposal.
3. **Revision tracking** — Each counter creates a `PORevision` record with the proposed changes (line items, amounts, terms). Prior pending revisions are marked `SUPERSEDED`.
4. **Resolution** — The receiving party can:
   - **Accept** (`acceptCounter()`) — Revision applied to PO; PO returns to `SENT` for formal acceptance
   - **Reject** (`rejectCounter()`) — PO moves to `CANCELLED`
   - **Counter again** — Creates another revision, stays in `NEGOTIATION`

### 3.7 Fulfilment Flow

After acceptance, the supplier progresses the PO through fulfilment:

| Action | Method | Allowed From | Result |
|--------|--------|--------------|--------|
| Ship goods | `markShipped()` | ACCEPTED, IN_PROGRESS | SHIPPED |
| Deliver goods | `markDelivered()` | ACCEPTED, IN_PROGRESS, SHIPPED | DELIVERED |
| Buyer verifies | `verifyDelivery()` | DELIVERED | VERIFIED |

Note: `markDelivered()` can be called directly from ACCEPTED (skipping SHIPPED), which supports digital/service POs where shipping doesn't apply.

### 3.8 Settlement Flow

When the buyer calls `acknowledgeObligation()` on a VERIFIED PO:

1. **Platform fee** — 0.5% (50 basis points) deducted from the locked amount
2. **Recipient determination**:
   - If an early payment request exists with status `FUNDED` and a `liquidityPartnerId`, the recipient is the **LP** (they recoup their advance)
   - Otherwise, the recipient is the **supplier**
3. **Early payment handling**:
   - If a `REQUESTED` (unfunded) early payment exists, it is auto-expired (`EARLY_PAY_EXPIRED` event)
   - If a `FUNDED` early payment exists, it is marked `SETTLED`
4. **Settlement execution** — `SettlementService.settlePO()` releases locked funds via the adapter
5. **Records created** — `Settlement` record (COMPLETED), `PlatformFee` record, PaymentLock → RELEASED
6. **Ledger events** — `OBLIGATION_ACKNOWLEDGED`, `PAYMENT_LOCK_RELEASED`, `SETTLEMENT_INITIATED`, `SETTLEMENT_COMPLETED`

### 3.9 Dispute Resolution

Buyers can dispute a delivered PO within the dispute window (default 72 hours):

| Resolution Outcome | PO Status | Financial Effect |
|--------------------|-----------|------------------|
| `FULL_REFUND` | CANCELLED | All locked funds returned to buyer |
| `PARTIAL_REFUND` | SETTLED | Specified amount returned to buyer; remainder settled |
| `RELEASE_TO_SUPPLIER` | VERIFIED (→ SETTLED) | Full amount settled to supplier (0.5% fee) |
| `REWORK` | IN_PROGRESS | No financial action; supplier repeats fulfilment cycle |

When a dispute is raised, any unfunded early payment request is auto-expired to prevent an LP from funding a disputed PO.

---

## 4. Early Payment State Machine

### 4.1 All Early Payment States

| State | Description | Terminal? |
|-------|-------------|-----------|
| `REQUESTED` | Supplier requested early payment from LP marketplace | No |
| `APPROVED` | Reserved for future use (pre-approval workflow) | — |
| `FUNDED` | LP has funded the advance to the supplier | No |
| `SETTLED` | PO settled; LP recoups from locked funds | **Yes** |
| `REJECTED` | Reserved for future use (LP rejection) | — |
| `DEFAULTED` | Reserved for future use (default handling) | — |
| `EXPIRED` | Auto-expired (PO settled without LP, PO disputed, or PO left fundable window) | **Yes** |

### 4.2 Complete Transition Table

| # | From | To | Trigger | Actor | Guards | Ledger Event | Side Effects |
|---|------|-----|---------|-------|--------|-------------|--------------|
| 1 | — | `REQUESTED` | `requestEarlyPayment()` | SUPPLIER | `po.supplierId === supplierId`; PO in {ACCEPTED, IN_PROGRESS, SHIPPED, DELIVERED}; PaymentLock is LOCKED; no existing early payment request | `EARLY_PAY_REQUESTED` | Fee calculated at 250 BPS (2.5%): `serviceFee`, `netAdvance`, `faceValue` |
| 2 | `REQUESTED` | `FUNDED` | `fund()` | LIQUIDITY_PARTNER | LP balance ≥ netAdvance; PO in fundable state; LP funding policy passes (exposure/concentration limits) | `EARLY_PAY_FUNDED` | LP pays supplier `netAdvance`; Settlement record (EARLY_PAY_ADVANCE); PlatformFee (EARLY_PAY_FACILITATION); `fundedAt` set |
| 3 | `REQUESTED` | `EXPIRED` | `fund()` (auto-expire) | SYSTEM | PO has left fundable state (not in ACCEPTED/IN_PROGRESS/SHIPPED/DELIVERED) | `EARLY_PAY_EXPIRED` | Stale request expired; 400 error returned to LP |
| 4 | `REQUESTED` | `EXPIRED` | `acknowledgeObligation()` | SYSTEM | PO is settling without LP funding | `EARLY_PAY_EXPIRED` | Reason: "PO settled without LP funding" |
| 5 | `REQUESTED` | `EXPIRED` | `dispute()` | SYSTEM | Buyer is disputing the PO | `EARLY_PAY_EXPIRED` | Reason: "PO disputed by buyer" |
| 6 | `FUNDED` | `SETTLED` | `acknowledgeObligation()` | BUYER (PO settlement) | Early payment is FUNDED with `liquidityPartnerId` | (part of `SETTLEMENT_COMPLETED`) | Locked funds released to LP; Settlement record (EARLY_PAY_SETTLEMENT); `settledAt` set |

### 4.3 Early Payment State Diagram

```
           requestEarlyPayment()
                [SUPPLIER]
                    │
                    ▼
              ┌───────────┐
              │ REQUESTED │
              └─────┬─────┘
               ╱    │    ╲
     fund()   ╱     │     ╲  PO settles without LP
     [LP]    ╱      │      ╲ PO disputed by buyer
            ╱       │       ╲ PO leaves fundable state
           ▼        │        ▼
     ┌────────┐     │   ┌─────────┐
     │ FUNDED │     │   │ EXPIRED │ (terminal)
     └───┬────┘     │   └─────────┘
         │          │
  PO settles        │
  (acknowledge)     │
         │          │
         ▼          │
     ┌─────────┐    │
     │ SETTLED │    │   (APPROVED, REJECTED, DEFAULTED — reserved)
     └─────────┘    │
     (terminal)     │
```

### 4.4 LP Funding Policy & Risk Controls

Before an LP can fund an early payment, the `PoliciesService.evaluateLPFunding()` checks:

| Check | Description |
|-------|-------------|
| **Total exposure ceiling** | LP's total outstanding funded amount must not exceed `maxExposureTotal` |
| **Per-buyer concentration** | Funded amount for any single buyer's POs must not exceed `maxExposurePerBuyer × maxExposureTotal` |
| **Per-supplier concentration** | Funded amount for any single supplier must not exceed `maxExposurePerSupplier × maxExposureTotal` |
| **Buyer whitelist** | If configured, buyer's org must be on the LP's approved buyer list |
| **Supplier whitelist** | If configured, supplier's org must be on the LP's approved supplier list |

The platform calculates LP exposure by summing `netAdvance` from all `FUNDED` early payment requests by members of the LP's organisation, grouped by buyer and supplier org.

### 4.5 Expiry Logic

Three scenarios cause automatic expiration of unfunded (`REQUESTED`) early payment requests:

| Scenario | Trigger Point | Reason in Ledger Event |
|----------|---------------|----------------------|
| PO settles without LP | `acknowledgeObligation()` in PO service | "PO settled without LP funding" |
| PO disputed by buyer | `dispute()` in PO service | "PO disputed by buyer" |
| LP tries to fund stale PO | `fund()` in early payments service | "Cannot fund — PO is already {status}" |

Additionally, the LP marketplace (`getMarketplace()`) filters out requests where the PO is not in a fundable state (`ACCEPTED`, `IN_PROGRESS`, `SHIPPED`, `DELIVERED`), so expired/stale requests don't appear.

---

## 5. Payment Lock State Machine

Payment locks represent reserved buyer funds. They are tightly coupled to the PO lifecycle.

| State | Description |
|-------|-------------|
| `PENDING` | Defined in schema; locks are created directly as LOCKED |
| `LOCKED` | Buyer funds reserved |
| `RELEASED` | Funds released to recipient (settlement) |
| `REFUNDED` | Funds returned to buyer (dispute/cancellation) |

### Transitions

| From | To | Trigger | Ledger Event |
|------|-----|---------|-------------|
| — | `LOCKED` | Supplier accepts PO → `SettlementService.reserveForPO()` | `PAYMENT_LOCK_CONFIRMED` |
| `LOCKED` | `RELEASED` | PO settlement → `SettlementService.settlePO()` | `PAYMENT_LOCK_RELEASED` + `SETTLEMENT_INITIATED` |
| `LOCKED` | `REFUNDED` | Dispute resolution (FULL_REFUND / PARTIAL_REFUND) → `SettlementService.refundPO()` | `PAYMENT_LOCK_REFUNDED` |

---

## 6. Settlement State Machine

| State | Description |
|-------|-------------|
| `PENDING` | Settlement initiated but not confirmed by payment rail |
| `COMPLETED` | Settlement confirmed |
| `FAILED` | Settlement failed on the rail |

Settlement types:
- **`STANDARD`** — Buyer → Supplier (normal PO settlement)
- **`EARLY_PAY_ADVANCE`** — LP → Supplier (early payment funding)
- **`EARLY_PAY_SETTLEMENT`** — Buyer locked funds → LP (PO settlement when LP funded early)

In the simulated adapter, settlements are created directly as `COMPLETED`. In production adapters, they start as `PENDING` and are updated via reconciliation.

---

## 7. Dispute State Machine

| State | Description |
|-------|-------------|
| `OPEN` | Buyer raised a dispute |
| `EVIDENCE_SUBMITTED` | Both parties have submitted evidence |
| `UNDER_REVIEW` | Admin is reviewing |
| `RESOLVED` | Admin has made a final decision |

### Transitions

| From | To | Method | Actor | Guards |
|------|-----|--------|-------|--------|
| — | `OPEN` | `raise()` | BUYER | PO DELIVERED; within 72h window; no active dispute |
| `OPEN` | `EVIDENCE_SUBMITTED` | `submitEvidence()` | BUYER / SUPPLIER | Both parties have ≥1 evidence item |
| `OPEN` / `EVIDENCE_SUBMITTED` | `UNDER_REVIEW` | `markUnderReview()` | ADMIN | Not already RESOLVED |
| Any non-RESOLVED | `RESOLVED` | `resolve()` | ADMIN | Outcome: FULL_REFUND / PARTIAL_REFUND / RELEASE_TO_SUPPLIER / REWORK |

### Dispute Outcome → PO State Mapping

| Dispute Outcome | PO Transitions To | Financial Effect |
|-----------------|--------------------|------------------|
| `FULL_REFUND` | `CANCELLED` | All locked funds → buyer |
| `PARTIAL_REFUND` | `SETTLED` | `refundAmount` → buyer; remainder → supplier |
| `RELEASE_TO_SUPPLIER` | `VERIFIED` | All locked funds → supplier (0.5% fee) |
| `REWORK` | `IN_PROGRESS` | No financial action; supplier redoes work |

---

## 8. The Immutable Ledger

### 8.1 Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Append-only** | Events are only ever inserted, never updated or deleted |
| **Entity-scoped hash chain** | Each entity (PO, payment lock, dispute, etc.) maintains its own hash chain. This allows parallel writes for different entities without a global mutex |
| **Per-entity sequencing** | Each entity has a monotonically increasing `entitySequence` counter (1, 2, 3…) |
| **Deterministic hashing** | Every hash is recomputable from the stored data — no hidden inputs |
| **Unique constraint** | `@@unique([entityId, entitySequence])` prevents duplicate sequence numbers |

### 8.2 Hash Chain Algorithm

Each event's `eventHash` is computed from a pipe-delimited string of 9 fields:

```
eventHash = SHA-256(
    previousHash | entityType | entityId | entitySequence |
    eventType | actorId | actorRole |
    canonicalStringify(payload) | timestamp.toISOString()
)
```

Where:
- `previousHash` = the `eventHash` of the preceding event **for the same entity** (or `"GENESIS"` for the first event)
- `canonicalStringify(payload)` = deterministic JSON serialization (see §8.3)
- `timestamp` = ISO-8601 string from `Date.toISOString()`
- All fields are joined by the pipe character `|`
- The resulting hex digest is stored in `event_log.event_hash`

**Tamper evidence**: Modifying any field in any event changes its hash, which breaks the chain for all subsequent events in that entity. An attacker would need to recompute every subsequent hash in the chain.

### 8.3 Canonical JSON Serialization

PostgreSQL's JSONB type does not preserve key order. When we store a payload and later read it back, the keys may appear in a different order. If we hash the raw JSON string, the hash would differ. The canonical serialization algorithm ensures deterministic hashing:

```
Rules:
1. Object keys are sorted lexicographically at every nesting level
2. Array element order is preserved
3. No whitespace between tokens
4. Dates become ISO-8601 strings
5. null and undefined serialize to "null"
```

Example:
```json
Input:  { "b": 2, "a": { "z": 1, "y": 2 } }
Output: {"a":{"y":2,"z":1},"b":2}
```

This function is used everywhere: hash chain computation, payload hashing, integrity hashing, and in the standalone verifier script.

### 8.4 Concurrency & Retry Logic

Because the entity-scoped chain requires reading the latest `eventHash` before inserting, two concurrent writes to the same entity could conflict. The system handles this with:

1. **Transaction isolation** — Each `logEvent()` call runs inside a `ReadCommitted` Prisma transaction
2. **Unique constraint** — `@@unique([entityId, entitySequence])` catches any concurrent insert with the same sequence number
3. **Retry with backoff** — On Prisma error `P2034` (serialization failure) or `P2002` (unique violation), the operation retries up to **5 times** with exponential backoff: `delay = 10 × 2^attempt + random(0–10) ms`

Different entities write in parallel without contention, since each has its own chain.

### 8.5 Event Types Reference

| Event Type | Entity Type | Description |
|------------|-------------|-------------|
| `PO_CREATED` | PURCHASE_ORDER | Buyer creates a PO |
| `PO_SENT` | PURCHASE_ORDER | PO sent to supplier |
| `PO_AUTO_APPROVED` | PURCHASE_ORDER | PO auto-approved by policy |
| `PO_APPROVAL_REQUESTED` | PURCHASE_ORDER | PO requires approval chain |
| `PO_APPROVAL_VOTE` | PURCHASE_ORDER | Approval chain vote submitted |
| `PO_APPROVAL_GRANTED` | PURCHASE_ORDER | All required approvals received |
| `PO_APPROVAL_REJECTED` | PURCHASE_ORDER | Approval chain rejected |
| `PO_ACCEPTED` | PURCHASE_ORDER | Supplier accepts PO |
| `PO_CANCELLED` | PURCHASE_ORDER | Supplier rejects PO |
| `PO_COUNTER_PROPOSED` | PURCHASE_ORDER | Counter-proposal submitted |
| `PO_COUNTER_ACCEPTED` | PURCHASE_ORDER | Counter-proposal accepted |
| `PO_COUNTER_REJECTED` | PURCHASE_ORDER | Counter-proposal rejected |
| `GOODS_SHIPPED` | PURCHASE_ORDER | Supplier marks goods shipped |
| `DELIVERY_MARKED` | PURCHASE_ORDER | Supplier marks goods delivered |
| `DELIVERY_VERIFIED` | PURCHASE_ORDER | Buyer verifies delivery |
| `DELIVERY_DISPUTED` | PURCHASE_ORDER | Buyer disputes delivery |
| `OBLIGATION_ACKNOWLEDGED` | PURCHASE_ORDER | Buyer acknowledges payment obligation |
| `SETTLEMENT_COMPLETED` | PURCHASE_ORDER | Settlement finalised |
| `PAYMENT_LOCK_CONFIRMED` | PAYMENT_LOCK | Buyer funds reserved |
| `PAYMENT_LOCK_RELEASED` | PAYMENT_LOCK | Funds released (settlement) |
| `PAYMENT_LOCK_REFUNDED` | PAYMENT_LOCK | Funds returned (refund) |
| `SETTLEMENT_INITIATED` | SETTLEMENT | Settlement record created |
| `EARLY_PAY_REQUESTED` | EARLY_PAYMENT | Supplier requests early payment |
| `EARLY_PAY_FUNDED` | EARLY_PAYMENT | LP funds advance |
| `EARLY_PAY_EXPIRED` | EARLY_PAYMENT | Unfunded request auto-expired |
| `DISPUTE_RAISED` | DISPUTE | Buyer raises formal dispute |
| `DISPUTE_RESOLVED` | DISPUTE | Admin resolves dispute |
| `EVIDENCE_UPLOADED` | PURCHASE_ORDER | File evidence attached |

---

## 9. Merkle Tree Anchoring & External Notarization

### 9.1 Overview

The platform periodically creates **global integrity anchors** — cryptographic snapshots of the entire ledger state. Each anchor builds a binary SHA-256 Merkle tree over all entity head hashes, producing a single root that commits to every entity chain simultaneously. This root is then:

1. **Signed** with the platform's ECDSA P-256 key
2. **Published** to the [Sigstore Rekor](https://rekor.sigstore.dev) transparency log, providing an independently verifiable, tamper-evident timestamp from a neutral third party
3. **Stored** as a `LedgerAnchor` record with the full Rekor receipt

Any external party can verify that a specific entity's events were included in a particular anchor by checking a **Merkle inclusion proof** — a compact path of sibling hashes from the entity's leaf to the root.

### 9.2 Merkle Tree Algorithm

**Type**: Binary SHA-256 Merkle tree  
**Implementation**: `src/crypto/merkle-tree.ts`

#### Leaf Construction

Input: All entity head hashes from the ledger (`entityId → lastEventHash`).

1. Entries are **sorted lexicographically by `entityId`** (deterministic ordering via `a.localeCompare(b)`)
2. Each leaf = `SHA-256("entityId:lastEventHash")` — colon-delimited, hex-encoded output

#### Interior Node Hashing

```
parentHash = SHA-256(leftChild + "|" + rightChild)
```

Interior nodes use **pipe-delimited concatenation** of the child hex strings, not raw byte concatenation. This matches the convention used throughout the platform's hash chain.

#### Edge Cases

| Condition | Handling |
|-----------|----------|
| **Odd leaf count** | Last leaf is **duplicated** (standard Merkle practice) |
| **Single leaf** | Root = the leaf itself (no further hashing) |
| **Zero entities** | Not permitted — `createAnchor()` requires at least one event |

#### Inclusion Proof

A Merkle inclusion proof is an array of `{ position: "left" | "right", hash: string }` steps from the target leaf to the root:

```
Verification algorithm:
    current = leafHash
    for each step in proof:
        if step.position === "left":
            current = SHA-256(step.hash + "|" + current)
        else:
            current = SHA-256(current + "|" + step.hash)
    return current === expectedRoot
```

The `position` indicates which side the **sibling** is on: `"left"` means the sibling hash goes on the left and the current value goes on the right.

### 9.3 Anchor Creation Flow

**Trigger**: `POST /api/ledger/anchor` (manual) or auto-anchoring scheduler (periodic)

`AnchorService.createAnchor()` step-by-step:

```
1. Gather entity heads:
   SELECT DISTINCT ON (entity_id) entity_id, event_hash
   FROM event_log ORDER BY entity_id, entity_sequence DESC
   → Record<entityId, lastEventHash>

2. Build Merkle tree from head hashes
   → merkleRoot = tree.root

3. anchorHash = merkleRoot (the anchor hash IS the Merkle root)

4. Build merkleLeaves array:
   [{ entityId, leafHash, headHash }] in sorted order

5. Get total event count (SELECT COUNT(*) FROM event_log)

6. Get previous anchor (latest by sequence)

7. UPGRADE CHECK (same hash as previous anchor):
   a) If previous anchor already has an external provider → return existing, skip
   b) If previous anchor has NO external provider → upgrade it:
      - Sign merkle root with platform key
      - Call anchorProvider.anchor(merkleRoot, signature, publicKeyPem)
      - Update existing LedgerAnchor record with Rekor receipt
   c) If upgrade not possible → return existing with externalAnchor: null

8. NEW ANCHOR (different hash):
   a) Sign merkle root with platform ECDSA P-256 key
   b) External anchoring (best-effort):
      - Call anchorProvider.anchor(merkleRoot, signature, publicKeyPem)
      - Failures are caught and logged — internal anchor still created
   c) Store LedgerAnchor with all fields:
      anchorHash, previousAnchorHash, eventCount, entityCount,
      headHashes, merkleLeaves, anchorProvider, externalId,
      externalProof, externalUrl, anchoredAt
```

The **upgrade logic** ensures that if events haven't changed since the last anchor, the system doesn't create a duplicate — instead it enriches the existing anchor with external notarization if not already present.

### 9.4 External Anchoring via Sigstore Rekor

[Sigstore Rekor](https://rekor.sigstore.dev) is a free, open-source transparency log for software supply chain integrity. The platform uses it as a **timestamping authority** — publishing Merkle roots to produce tamper-evident, independently verifiable timestamps.

#### How It Works

1. **Artifact hash**: `SHA-256(merkleRoot)` — the hex-encoded Merkle root is the "artifact"
2. **Entry format**: `hashedrekord` v0.0.1

```json
{
  "kind": "hashedrekord",
  "apiVersion": "0.0.1",
  "spec": {
    "data": {
      "hash": { "algorithm": "sha256", "value": "<SHA-256(merkleRoot)>" }
    },
    "signature": {
      "content": "<base64 ECDSA signature over merkleRoot>",
      "publicKey": { "content": "<base64-encoded PEM public key>" }
    }
  }
}
```

3. **POST** to `https://rekor.sigstore.dev/api/v1/log/entries`
4. **Response** contains a UUID key with the entry details

#### Rekor Receipt

The receipt stored in `externalProof` contains:

```json
{
  "logIndex": 1080109490,
  "logID": "<hex>",
  "integratedTime": 1741685412,
  "body": "<base64-encoded entry body>",
  "verification": {
    "inclusionProof": {
      "checkpoint": "...",
      "hashes": ["..."],
      "logIndex": 1080109490,
      "rootHash": "...",
      "treeSize": 156424756
    },
    "signedEntryTimestamp": "<base64>"
  }
}
```

| Field | Description |
|-------|-------------|
| `logIndex` | Monotonic position in Rekor's global log |
| `integratedTime` | Unix timestamp when entry was integrated |
| `body` | Base64-encoded entry body (contains the artifact hash for offline verification) |
| `verification.inclusionProof` | Rekor's own Merkle inclusion proof within its log |
| `verification.signedEntryTimestamp` | Rekor's signature over the entry |

**Verification URL**: `https://search.sigstore.dev/?logIndex=<logIndex>` — anyone can look up the entry directly.

### 9.5 Anchor Provider Architecture

External anchoring uses a pluggable provider pattern via dependency injection:

```typescript
interface AnchorProvider {
  readonly name: string;
  anchor(merkleRoot: string, signature: string, publicKeyPem: string): Promise<AnchorReceipt>;
  verify(receipt: AnchorReceipt): Promise<boolean>;
}

interface AnchorReceipt {
  provider: string;        // e.g. "sigstore-rekor"
  externalId: string;      // Rekor UUID, Bitcoin txId, etc.
  proof: Record<string, unknown>;  // Provider-specific proof data
  verificationUrl: string;
  anchoredAt: Date;
}
```

| Provider | `name` | Purpose | Configuration |
|----------|--------|---------|---------------|
| **RekorProvider** | `"sigstore-rekor"` | Production — publishes to Sigstore Rekor | `ANCHOR_PROVIDER=rekor`, `REKOR_URL=https://rekor.sigstore.dev/api/v1/log/entries` |
| **NoopProvider** | `"none"` | Development/testing — internal anchor only | `ANCHOR_PROVIDER=noop` (or unset) |

Provider selection is via the `ANCHOR_PROVIDER` environment variable. The `NoopProvider` creates a local-only receipt (`provider: "none"`, `externalId: "local-<timestamp>"`) and its `verify()` always returns `false`.

### 9.6 Inclusion Proofs

When generating a Trust Envelope, the `EvidenceService` requests a Merkle inclusion proof for the entity:

```
AnchorService.getInclusionProof(entityId):
    1. Fetch up to 20 most recent anchors (desc by sequence)
    2. For each anchor, check if headHashes[entityId] exists
    3. If found: rebuild Merkle tree from headHashes, compute proof path
    4. Return { anchor metadata, proof: { entityId, leafHash, headHash, path[] } }
```

The proof is embedded in the Trust Envelope's `notarization` section, allowing any verifier to confirm the entity was included in a specific global anchor without access to the full ledger.

### 9.7 Anchor Chain Verification

Anchors form their own chain — each anchor's `previousAnchorHash` links to the prior anchor's `anchorHash`.

`AnchorService.verifyAnchorChain()`:

1. Fetch all anchors ordered by `sequence ASC`
2. Verify first anchor has `previousAnchorHash === null`
3. Each subsequent anchor's `previousAnchorHash` must equal the prior anchor's `anchorHash`
4. For each anchor, **re-derive** the Merkle root from the stored `headHashes` and compare against `anchorHash`
5. Count externally anchored entries
6. Return `{ valid, anchorCount, externallyAnchored, details[] }`

### 9.8 Auto-Anchoring Scheduler

**Implementation**: `src/ledger/anchor-scheduler.service.ts`

| ENV Variable | Default | Description |
|-------------|---------|-------------|
| `ANCHOR_INTERVAL_MINUTES` | `0` (disabled) | Anchoring interval in minutes. Set to `0` or omit for manual-only |

When enabled (`> 0`):
- A `setInterval` timer fires every `N × 60,000` ms
- Each tick checks if there are new events since the last anchor
- If no new events → skip (avoids duplicate anchors for unchanged state)
- If new events exist → `AnchorService.createAnchor()` is called
- Timer is cleaned up on module destroy

When disabled (`0` or unset): anchoring is manual only via `POST /api/ledger/anchor`.

### 9.9 LedgerAnchor Schema

```prisma
model LedgerAnchor {
  id                 String    @id @default(uuid())
  sequence           Int       @default(autoincrement())
  anchorHash         String    @unique              // Merkle root
  previousAnchorHash String?                        // Chain link to prior anchor
  eventCount         Int                            // Total events at anchor time
  entityCount        Int                            // Total entities in the tree
  headHashes         Json                           // { entityId: lastEventHash }
  merkleLeaves       Json?                          // Ordered [{ entityId, leafHash, headHash }]

  // External anchoring
  anchorProvider     String?                        // "sigstore-rekor" | null
  externalId         String?                        // Rekor UUID
  externalProof      Json?                          // Full Rekor receipt JSON
  externalUrl        String?                        // Verification URL
  anchoredAt         DateTime?                      // External timestamp

  createdAt          DateTime  @default(now())
}
```

---

## 10. Passkey Signing (WebAuthn)

For high-trust actions (accepting a PO, funding an early payment, acknowledging obligation), the user's passkey produces a real ECDSA P-256 signature bound to the specific business action. This is a two-step flow.

### 10.1 Challenge Generation

```
POST /api/ledger/challenge
Body: { entityId: "po-uuid", eventType: "PO_ACCEPTED" }
```

The backend computes a **deterministic intent hash**:

```
intentHash = SHA-256(eventType | entityId | actorId) → base64url
```

This becomes the WebAuthn challenge. Unlike random nonces, this cryptographically binds the biometric signature to the **exact business action** — you cannot replay a PO_ACCEPTED signature for a PO_REJECTED action, or for a different PO.

The backend returns:
- The intent hash
- WebAuthn `PublicKeyCredentialRequestOptions` (with the intent hash as the challenge)

### 10.2 Assertion Verification

The frontend presents the challenge to the user's authenticator (Touch ID, Face ID, Windows Hello). The authenticator produces:

- **`clientDataJSON`** — Browser-produced JSON: `{ type: "webauthn.get", challenge: "<intentHash>", origin: "..." }`
- **`authenticatorData`** — RP ID hash + flags + signature counter
- **`signature`** — ECDSA P-256 over `authenticatorData || SHA-256(clientDataJSON)`

```
POST /api/ledger/events
Body: {
  entityType: "PURCHASE_ORDER",
  entityId: "po-uuid",
  eventType: "PO_ACCEPTED",
  payload: { ... },
  assertion: { id, rawId, response: { authenticatorData, clientDataJSON, signature }, ... }
}
```

The backend:
1. Verifies the WebAuthn assertion using `@simplewebauthn/server`
2. Extracts the raw signature, authenticator data, and public key
3. Calls `LedgerService.logEvent()` with all cryptographic materials

### 10.3 What Gets Stored

Every ledger event row includes:

| Column | Description |
|--------|-------------|
| `actor_signature` | ECDSA signature (base64) or `"SYSTEM"` for unsigned events |
| `authenticator_data` | WebAuthn authenticator data (base64, nullable) |
| `actor_public_key` | COSE public key (base64) or `"SYSTEM"` |
| `credential_id` | WebAuthn credential ID (nullable) |
| `intent_hash` | SHA-256 of business intent (base64url, nullable) |
| `client_data_json` | Raw WebAuthn clientDataJSON from browser (nullable) |

For unsigned events (system-triggered, or before the user has registered a passkey), `actorSignature` is `"SYSTEM"` and the WebAuthn fields are null. The event is still hash-chained.

---

## 11. Trust Envelope (Evidence Pack v2.0)

### 11.1 Purpose

A Trust Envelope is a **self-contained, cryptographically verifiable JSON document** that proves the complete lifecycle of a purchase order. It packages:

- The business document (PO snapshot)
- All participant identities and public keys
- The complete immutable event history across all related entities
- Passkey-signed approval records
- Per-event standalone cryptographic proof bundles
- File evidence with integrity hashes
- Computed integrity root hashes
- A platform digital signature sealing the entire envelope

**Any external party (bank, regulator, auditor) can verify the envelope without trusting the platform.** The verification can be done using the public API endpoint, the standalone CLI script, or manually using any FIDO2/WebAuthn library.

### 11.2 Generation Flow

```
GET /api/evidence/po/:poId/pack
```

Assembly steps inside `EvidenceService.buildEvidencePack()`:

```
1. Load PO with all relations (buyer, supplier, paymentLock,
   settlements, disputes, earlyPaymentRequest, revisions)

2. Load all evidence attachments for the PO

3. Collect all related entity IDs:
   PO + paymentLock + earlyPaymentRequest + all settlements + all disputes

4. Load ALL ledger events across all related entities

5. Verify file integrity:
   For each attachment, recompute SHA-256 of file on disk vs stored hash

6. Generate proof bundles for each related entity chain:
   proofGenerator.generateEntityProofs(entityId) × N entities

7. Build document section (PO snapshot)
   Compute documentHash = SHA-256(canonicalStringify(document))

8. Build actors[] — deduplicate from proof bundles + buyer/supplier
   Each actor includes credentials (public keys) and resolution URIs

9. Build approvals[] — extract passkey-signed events as approval records

10. Build ledger section — group events by entityId into entityChains

11. Compute integrity hashes:
    ledgerRootHash  = SHA-256(eventHash₁ | eventHash₂ | ... | eventHashₙ)
    attachmentsHash = SHA-256(fileHash₁ | fileHash₂ | ...) or SHA-256("NONE")
    envelopeHash    = SHA-256(documentHash | ledgerRootHash | attachmentsHash)

12. Platform signature:
    Sign envelopeHash with platform's ECDSA P-256 private key

13. Check for ledger anchor (Merkle inclusion proof + external notarization via Rekor)

14. Assemble all sections into the final Trust Envelope JSON
```

### 11.3 Complete Envelope Structure

```json
{
  "metadata": { ... },
  "actors": [ ... ],
  "document": { ... },
  "attachments": [ ... ],
  "ledger": {
    "chainAlgorithm": "SHA-256",
    "hashInputFormat": "previousHash|entityType|...",
    "entityChains": { ... },
    "events": [ ... ]
  },
  "approvals": [ ... ],
  "proofBundles": [ ... ],
  "integrity": { ... },
  "verification": { ... },
  "platformSignature": { ... },
  "notarization": { ... }
}
```

### 11.4 Section-by-Section Reference

#### metadata

```json
{
  "envelopeId": "tenv_<uuid>",
  "packVersion": "2.0",
  "schemaVersion": "trust-envelope-v1",
  "generatedAt": "2026-03-10T14:30:00.000Z",
  "generator": "sme-payments-trust-ledger",
  "hashAlgorithm": "SHA-256",
  "signatureAlgorithm": "WebAuthn-FIDO2-ES256 (ECDSA P-256)",
  "canonicalization": {
    "algorithm": "Recursive key-sorted JSON, no whitespace, dates as ISO-8601",
    "implementation": "Object.keys(obj).sort() applied recursively; arrays preserve order"
  }
}
```

| Field | Purpose |
|-------|---------|
| `envelopeId` | Unique identifier for this envelope |
| `packVersion` | Envelope format version (2.0) |
| `schemaVersion` | Schema identifier for backward compatibility |
| `generator` | System that produced this envelope |
| `hashAlgorithm` | Cryptographic hash used throughout |
| `signatureAlgorithm` | Signature scheme used for passkey signing |
| `canonicalization` | Documents how JSON is normalized before hashing |

#### actors

Deduplicated array of all participants, extracted from proof bundles and PO data:

```json
[
  {
    "id": "user-uuid",
    "role": "BUYER",
    "name": "Alice Smith",
    "email": "buyer@acme.co.uk",
    "companyName": "ACME Procurement Ltd",
    "jurisdiction": "UK",
    "credentials": [
      {
        "credentialId": "base64url",
        "publicKeyBase64": "base64 (COSE format)",
        "deviceType": "multiDevice",
        "backedUp": true,
        "registeredAt": "ISO-8601",
        "publicKeyResolutionUri": "GET /api/proofs/registry/credentials/:id"
      }
    ],
    "identityResolutionUri": "GET /api/proofs/identity/signers/:id"
  }
]
```

Resolution URIs are **public, unauthenticated endpoints** that allow any external verifier to independently confirm that a credential belongs to the claimed user.

#### document

Snapshot of the purchase order at envelope generation time, plus a hash:

```json
{
  "type": "PURCHASE_ORDER",
  "id": "po-uuid",
  "reference": "PO-ABCD1234-XY12",
  "amount": 700000,
  "currency": "SAR",
  "status": "SETTLED",
  "documentHash": "<SHA-256 of canonical(document)>",
  "buyer": { "id": "...", "name": "...", "company": "..." },
  "supplier": { "id": "...", "name": "...", "company": "..." },
  "lineItems": [ ... ],
  "paymentTerms": "IMMEDIATE",
  "deliveryTerms": "EX_WORKS",
  "createdAt": "ISO-8601",
  "acceptedAt": "ISO-8601",
  "settledAt": "ISO-8601"
}
```

#### attachments

Evidence files with content hashes:

```json
[
  {
    "id": "att-uuid",
    "type": "DELIVERY_NOTE",
    "filename": "receipt.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 12345,
    "sha256Hash": "hex",
    "uploadedBy": { "id": "...", "name": "...", "role": "..." },
    "createdAt": "ISO-8601"
  }
]
```

Supported types: `DELIVERY_NOTE`, `SIGNED_RECEIPT`, `PHOTO_PROOF`, `INVOICE`, `INSPECTION_REPORT`, `SHIPPING_DOCUMENT`, `PO_DOCUMENT`, `OTHER`.

#### ledger

The immutable event history, grouped by entity and also provided flat:

```json
{
  "chainAlgorithm": "SHA-256",
  "hashInputFormat": "previousHash|entityType|entityId|entitySequence|eventType|actorId|actorRole|canonicalPayload|timestamp",
  "entityChains": {
    "po-uuid": {
      "entityType": "PURCHASE_ORDER",
      "eventCount": 8,
      "firstHash": "abc...",
      "lastHash": "xyz..."
    },
    "lock-uuid": {
      "entityType": "PAYMENT_LOCK",
      "eventCount": 2,
      "firstHash": "def...",
      "lastHash": "ghi..."
    }
  },
  "events": [
    {
      "id": "event-uuid",
      "sequence": 42,
      "entitySequence": 5,
      "entityType": "PURCHASE_ORDER",
      "entityId": "po-uuid",
      "eventType": "PO_ACCEPTED",
      "actorId": "user-uuid",
      "actorRole": "SUPPLIER",
      "payload": { ... },
      "timestamp": "ISO-8601",
      "eventHash": "hex",
      "previousHash": "hex | GENESIS",
      "actorSignature": "base64 | SYSTEM",
      "intentHash": "base64url | null"
    }
  ]
}
```

The `entityChains` map provides a summary for each entity's chain (event count, first/last hash). The flat `events` array contains all events across all related entities.

#### approvals

Passkey-signed events extracted as explicit approval records:

```json
[
  {
    "eventId": "proof-uuid",
    "eventType": "PO_ACCEPTED",
    "actorId": "user-uuid",
    "actorRole": "SUPPLIER",
    "method": "passkey",
    "credentialId": "base64url",
    "intentHash": "base64url",
    "signature": "base64",
    "timestamp": "ISO-8601"
  }
]
```

This makes it easy for a bank to see which human approvals occurred without parsing raw proof bundles.

#### proofBundles

Full standalone proof bundles for every event (see §11 for detailed structure). These contain all the raw cryptographic materials needed for independent verification.

#### integrity

Computed hashes that seal the envelope. If any data changes, these hashes break:

```json
{
  "documentHash": "hex — SHA-256 of canonical(document)",
  "ledgerRootHash": "hex — SHA-256 of pipe-joined event hashes",
  "attachmentsHash": "hex — SHA-256 of pipe-joined file hashes (or 'NONE')",
  "envelopeHash": "hex — SHA-256(docHash | ledgerRoot | attachmentsHash)",
  "eventCount": 12,
  "attachmentCount": 2,
  "signedEventCount": 4,
  "unsignedEventCount": 8,
  "fileIntegrity": [
    {
      "attachmentId": "att-uuid",
      "filename": "receipt.pdf",
      "valid": true,
      "sha256": "hex"
    }
  ]
}
```

#### verification

Human-readable verification instructions:

```json
{
  "instructions": "node verify-evidence-pack.mjs <this-file.json>",
  "scriptHash": "SHA-256 of the verification script",
  "checksToPerform": [
    "Verify ledger hash chain integrity",
    "Verify event hash recomputation",
    "Verify payload hash matches canonical payload",
    "Verify WebAuthn intent hash binding",
    "Verify ECDSA P-256 signatures against embedded public keys",
    "Verify integrity root hashes",
    "Verify attachment content hashes",
    "Cross-check actor identities via public registry URIs"
  ]
}
```

#### platformSignature

Platform-level ECDSA P-256 signature over the envelope hash:

```json
{
  "algorithm": "ECDSA-P256-SHA256",
  "signature": "base64",
  "publicKey": "base64 (SPKI DER)",
  "signedAt": "ISO-8601",
  "signedFields": "envelopeHash"
}
```

#### notarization

Merkle tree anchor with optional external notarization via Sigstore Rekor:

```json
{
  "merkleRoot": "hex (SHA-256 root of the binary Merkle tree over all entity head hashes)",
  "merkleProof": {
    "entityId": "uuid (the entity this envelope covers)",
    "leafHash": "hex (SHA-256 of 'entityId:headEventHash')",
    "headHash": "hex (the head event hash for this entity at anchor time)",
    "path": [
      { "position": "left | right", "hash": "hex (sibling hash at this tree level)" }
    ]
  },
  "anchor": {
    "anchorId": "uuid",
    "anchorHash": "hex (SHA-256 of all anchor fields)",
    "previousAnchorHash": "hex | null (links to prior anchor — forms anchor chain)",
    "eventCount": 42,
    "entityCount": 8,
    "createdAt": "ISO-8601"
  },
  "externalAnchor": {
    "provider": "sigstore-rekor",
    "externalId": "uuid (Rekor entry UUID)",
    "verificationUrl": "https://search.sigstore.dev/?logIndex=...",
    "anchoredAt": "ISO-8601",
    "proof": {
      "logIndex": 1080109490,
      "logID": "hex",
      "integratedTime": 1741649039,
      "body": "base64 (hashedrekord v0.0.1 entry — decode to verify spec.data.hash.value === SHA-256(merkleRoot))",
      "verification": {
        "signedEntryTimestamp": "base64",
        "inclusionProof": { "logIndex": 1080109490, "rootHash": "hex", "treeSize": 171195583, "hashes": ["hex", "..."] }
      }
    }
  },
  "algorithm": "SHA-256-Merkle-Tree",
  "verificationUri": "/api/ledger/anchors/verify"
}
```

### 11.5 Integrity Hash Hierarchy

```
envelopeHash = SHA-256(documentHash | ledgerRootHash | attachmentsHash)
    │
    ├── documentHash = SHA-256(canonicalStringify(document))
    │       └── Any change to PO fields breaks this
    │
    ├── ledgerRootHash = SHA-256(eventHash₁ | eventHash₂ | ... | eventHashₙ)
    │       └── Any change to any event breaks this
    │           └── Each eventHash is chained to previous (tamper-evident chain)
    │
    └── attachmentsHash = SHA-256(fileHash₁ | fileHash₂ | ... | fileHashₙ)
            └── Any added/removed/modified file breaks this

platformSignature = ECDSA-P256(envelopeHash)
    └── Any change to documentHash, ledgerRootHash, or attachmentsHash
        breaks the platform signature
```

**Consequence**: Modifying any single field, event, or file anywhere in the envelope cascades upward and invalidates the platform signature.

### 11.6 Platform Signature

The platform holds an ECDSA P-256 key pair used exclusively to seal Trust Envelopes:

- **Production**: Set `PLATFORM_SIGNING_KEY` env var to a base64-encoded PKCS8 DER private key
- **Development**: If the env var is absent, a key pair is auto-generated at startup (warning logged)

The signing process:
1. Compute `envelopeHash` from the integrity section
2. `createSign("SHA256").update(envelopeHash).sign(privateKey)` → DER signature
3. Embed signature (base64) + public key (SPKI DER base64) in the envelope

The public key is embedded in the envelope itself, making the pack self-verifying. For production, the public key should be pinned or distributed via a separate trust channel.

---

## 12. Proof Bundles

### 12.1 Structure

A proof bundle is a **self-contained JSON document** for a single event. It contains everything needed to verify that event independently, without database access:

```json
{
  "version": "1.0",
  "proofId": "uuid",
  "generatedAt": "ISO-8601",

  "intent": {
    "eventType": "PO_ACCEPTED",
    "entityType": "PURCHASE_ORDER",
    "entityId": "po-uuid",
    "payload": { "...full business data snapshot..." },
    "payloadHash": "SHA-256(canonicalStringify(payload))",
    "timestamp": "ISO-8601"
  },

  "signer": {
    "userId": "user-uuid",
    "name": "Jane Supplier",
    "email": "supplier@brightworks.co.uk",
    "role": "SUPPLIER",
    "organisation": {
      "id": "org-uuid",
      "name": "Brightworks Ltd",
      "type": "SUPPLIER",
      "jurisdiction": "UK"
    }
  },

  "credential": {
    "credentialId": "base64url",
    "publicKeyBase64": "base64 (COSE format)",
    "deviceType": "multiDevice",
    "backedUp": true,
    "registeredAt": "ISO-8601",
    "publicKeyResolutionUri": "GET /api/proofs/registry/credentials/:id"
  },

  "assertion": {
    "intentHash": "base64url — SHA-256(eventType|entityId|actorId)",
    "clientDataJSON": "base64 — raw browser WebAuthn JSON",
    "authenticatorData": "base64 — raw RP ID hash + flags + counter",
    "signature": "base64 — ECDSA P-256 signature"
  },

  "issuer": {
    "platform": "sme-payments",
    "rpId": "localhost",
    "origin": "http://localhost:3000",
    "registryUri": "GET /api/proofs/registry/credentials",
    "identityUri": "GET /api/proofs/identity/signers"
  },

  "chain": {
    "eventHash": "hex",
    "previousHash": "hex | GENESIS",
    "entitySequence": 5,
    "hashAlgorithm": "SHA-256",
    "hashInputFormat": "previousHash|entityType|entityId|entitySequence|eventType|actorId|actorRole|canonicalPayload|timestamp"
  },

  "evidence": [ ],

  "verification": {
    "steps": [
      "1. Verify intent hash: SHA-256(eventType|entityId|userId) = intentHash",
      "2. Verify challenge binding: decode clientDataJSON, check challenge = intentHash",
      "3. Verify payload hash: SHA-256(canonical(payload)) = payloadHash",
      "4. Optionally resolve public key from: GET /api/proofs/registry/credentials/:id",
      "5. Verify ECDSA P-256 signature: signedData = authenticatorData || SHA-256(clientDataJSON)",
      "6. Verify hash chain: recompute eventHash from pipe-delimited fields",
      "7. Confirm signer identity via: GET /api/proofs/identity/signers/:id"
    ]
  }
}
```

For unsigned events (where `actorSignature === "SYSTEM"`), the `assertion` section is null and `verification.steps` contains only the hash chain check.

### 12.2 Per-Event vs Per-Entity Generation

| API | Description |
|-----|-------------|
| `GET /api/proofs/event/:eventId` | Generate a proof bundle for a single event |
| `GET /api/proofs/entity/:entityId` | Generate proof bundles for all events in an entity, plus verify the hash chain in-process |

The entity-level generation also returns `chainValid: true/false` and a summary of the chain verification.

### 12.3 Public Registries

Two **public, unauthenticated** endpoints allow external verifiers to independently confirm identities:

| Endpoint | Returns |
|----------|---------|
| `GET /api/proofs/registry/credentials/:credentialId` | Public key in COSE format, device type, registration date |
| `GET /api/proofs/identity/signers/:userId` | User name, email, role, organisation details, list of credentials |

These enable verification without platform trust — the verifier can fetch the public key and check the signature independently.

---

## 13. Verification System

### 13.1 Three Layers of Verification

| Layer | Scope | API | Auth |
|-------|-------|-----|------|
| **Per-event** | Single proof bundle | `POST /api/proofs/verify` | Public |
| **Per-entity chain** | Hash chain for one entity | `GET /api/ledger/verify/:entityId` | JWT |
| **Full envelope** | All 15 checks on the Trust Envelope | `POST /api/verify` or CLI script | Public |

### 13.2 Full Envelope Verification — 15 Checks

The `VerifyService` (and the equivalent CLI script) performs these checks on a Trust Envelope:

| # | Check | What It Verifies | Verdict |
|---|-------|-----------------|---------|
| **0** | **Pack Structure & Version** | Schema version is recognized. `metadata` has required fields (`generator`, `hashAlgorithm`, `signatureAlgorithm`, `canonicalization`, `envelopeId`). `document` section present. Event/bundle counts match. Entity chain breakdown reported. | PASS / FAIL |
| **1** | **Hash Chain Integrity** | For every proof bundle: recompute `SHA-256(previousHash\|entityType\|entityId\|entitySequence\|eventType\|actorId\|actorRole\|canonicalPayload\|timestamp)`. Computed hash must match `chain.eventHash`. | PASS / FAIL |
| **2** | **Entity Chain Continuity** | Group bundles by `entityId`. First event's `previousHash === "GENESIS"`. Each subsequent event's `previousHash === previous event's eventHash`. Supports multiple independent entity chains (PO, payment lock, early payment, etc.). | PASS / FAIL |
| **3** | **Payload Hash Verification** | For every bundle: `SHA-256(canonicalStringify(payload)) === intent.payloadHash`. Confirms event payloads have not been altered. | PASS / FAIL |
| **4** | **Intent Hash Verification** | For passkey-signed events: `SHA-256_base64url(eventType\|entityId\|actorId) === assertion.intentHash`. Supports **cross-entity fallback** — tries `payload.purchaseOrderId` as alternate entityId, and event type aliases (e.g., `EARLY_PAY_REQUESTED` ↔ `EARLY_PAYMENT_REQUESTED`). | PASS / WARN |
| **5** | **WebAuthn Challenge Binding** | Decode `clientDataJSON` (base64url). Verify `type === "webauthn.get"`. Verify `challenge === intentHash` (with base64url decode fallback). Confirms the biometric was presented for this exact business action. | PASS / FAIL |
| **6** | **ECDSA P-256 Signature Verification** | Decode `authenticatorData`, `clientDataJSON`, `signature`. Compute `signedData = authenticatorData \|\| SHA-256(clientDataJSON_bytes)`. Verify ECDSA P-256 signature against embedded COSE public key. Handles COSE→SPKI conversion and IEEE P1363→DER signature format conversion. | PASS / FAIL |
| **7** | **Integrity Root Hashes** | Recompute `documentHash` (canonical document minus documentHash field). Recompute `ledgerRootHash` (pipe-joined eventHashes). Recompute `attachmentsHash` (pipe-joined file hashes or "NONE"). Recompute `envelopeHash = SHA-256(docHash\|ledgerRoot\|attachmentsHash)`. Verify event count matches. | PASS / FAIL |
| **8** | **Actors & Approvals** | All actors have at least one credential. All proof bundle signers appear in `actors[]` array. Actor public keys match proof bundle credentials. All `approvals[]` entries correspond to signed proof bundles. | PASS / FAIL |
| **9** | **Cross-Consistency** | PO amount matches `PO_ACCEPTED` payload amount. PO status is consistent with the event trail (e.g., SETTLED PO must have `SETTLEMENT_COMPLETED` event). Buyer ≠ Supplier. Both parties appear as signers. Negotiation analysis (turn alternation, price changes). Payment lock validation. | PASS / WARN |
| **10** | **Credential Uniqueness** | Each `credentialId` is bound to exactly one user across all proof bundles. Detects if a credential is shared between users (fraud indicator). | PASS / FAIL |
| **11** | **Timestamp Ordering** | Events within each entity chain are chronologically ordered. Reports total time span of the transaction. | PASS / WARN |
| **12** | **External Verification URIs** | Reports all `registryUri`, `identityUri`, `publicKeyResolutionUri` values. Warns if pointing to `localhost` (non-production). | INFO / WARN |
| **13** | **Platform Signature & Notarization** | Verifies `platformSignature.signature` over `integrity.envelopeHash` using `createVerify("SHA256")` with the embedded SPKI DER public key. Reports whether notarization section is present. | PASS / FAIL |
| **14** | **Merkle Proof & External Anchor** | Verifies the Merkle inclusion proof: walks `merkleProof.path` from `leafHash` to root using `SHA-256(left + "|" + right)` and confirms the result equals `merkleRoot`. Cross-checks the external anchor: for Sigstore Rekor, decodes the embedded `proof.body` (base64 → JSON), extracts `spec.data.hash.value`, and verifies it equals `SHA-256(merkleRoot)`. Reports anchor metadata (provider, logIndex, verification URL). With `--live` flag (CLI) or live mode: fetches the Rekor entry directly and cross-checks `integratedTime`. | PASS / WARN / FAIL |

**Overall Verdict**:
- `PASSED` — All checks pass
- `PASSED_WITH_WARNINGS` — No failures, but some warnings
- `FAILED` — One or more checks failed

### 13.3 Standalone CLI Verifier

**File**: `scripts/verify-evidence-pack.mjs`  
**Lines**: ~1,297  
**Dependencies**: Zero (uses only Node.js built-in `crypto`)

```bash
node verify-evidence-pack.mjs <evidence-pack.json> [--live]
```

**Flags**:
- `--live` — Enable live external verification. For Sigstore Rekor anchors, the script fetches the Rekor transparency log entry via HTTPS and cross-checks the `integratedTime` and entry body against the embedded proof. Without this flag, the script performs **offline cross-checking** only (decodes the embedded proof body and verifies hash consistency).

**Exit codes**:
- `0` — All checks passed  
- `1` — One or more failures  
- `2` — Invalid input (file not found, invalid JSON)

The CLI script is a **complete reimplementation** of the verification pipeline in a single file, including:

- Canonical JSON serialization (same algorithm as the backend)
- Minimal CBOR parser for COSE key extraction
- COSE → SPKI DER key conversion
- IEEE P1363 → DER signature format conversion
- All 15 verification checks (including Merkle proof & external anchor verification)
- Support for both Trust Envelope v2.0 and legacy Evidence Pack v1.x formats

**Merkle & Anchor Verification (Check #14)**:
- **Offline mode** (default): Decodes `notarization.externalAnchor.proof.body` from base64 to JSON, extracts `spec.data.hash.value`, and verifies it equals `SHA-256(merkleRoot)`. Walks the `merkleProof.path` from leaf to root using pipe-delimited interior hashing.
- **Live mode** (`--live`): Additionally fetches the Rekor entry at `https://rekor.sigstore.dev/api/v1/log/entries/{uuid}` with a 10-second timeout. Verifies the fetched entry's body matches the embedded proof. Reports `logIndex`, `integratedTime`, and verification URL.

**Why a standalone script?** Banks, auditors, and regulators can download this single file and verify an evidence pack on their own machine. No platform access needed. No dependencies to install. No Docker. Just `node`.

**Output format**: ANSI-colored terminal report with pass/fail/warn icons (`✓`/`✗`/`⚠`/`ℹ`), grouped into titled sections. Final summary:

```
─────────────────────────────────────
 VERIFICATION SUMMARY
─────────────────────────────────────
 ✓ Passed:   12
 ⚠ Warnings: 2
 ✗ Failed:   0

 VERDICT: PASSED WITH WARNINGS
─────────────────────────────────────
```

#### Key Implementation Details

**v1 ↔ v2 Normalisation**: The script's `normalisePack()` function detects the pack version and maps both formats to a common internal shape. v2.0 reads from `metadata`, `ledger.events`, `actors`, `approvals`, `platformSignature`, `notarization`. v1.x reads from top-level `packVersion`, `purchaseOrder`, `ledgerEvents`.

**Cross-Entity Intent Hash**: Check #4 handles the case where a proof bundle's entity (e.g., an EARLY_PAYMENT entity) has a different `entityId` from the PO. The script tries the `payload.purchaseOrderId` as an alternate entityId when computing the expected intent hash, and handles event type aliases (`EARLY_PAY_REQUESTED` ↔ `EARLY_PAYMENT_REQUESTED`).

**COSE/CBOR Parsing**: The script includes a minimal hand-rolled CBOR parser that extracts P-256 EC key coordinates from COSE format. This avoids any external CBOR library dependency.

### 13.4 Web Verification Service

**Backend Endpoint**:

```
POST /api/verify
Content-Type: application/json
Body: <Trust Envelope JSON>
Response: VerifyReport
```

- **No authentication required** — this is a public verification service
- Accepts arbitrary JSON (validation pipe bypassed)
- Body size limit: 5 MB (evidence packs can be large)
- Returns the same structured report as the backend's `VerifyService`

**Frontend Page**: `/verify` (standalone, outside the dashboard layout — no login required)

Features:
- Drag-and-drop file upload for `.json` files
- Sends file contents to `POST /api/verify`
- Displays verdict banner (green/yellow/red)
- Per-section result cards with pass/fail/warn/info icons
- "Verify Another Pack" reset button
- Also accessible from the LP dashboard sidebar ("Verify Evidence" link)

### 13.5 Proof Bundle Verification — 7 Steps

The `ProofVerifierService` verifies a single proof bundle with up to 7 steps:

| Step | Name | Logic |
|------|------|-------|
| 1 | **Bundle structure** | Check `version === "1.0"`, required sections present, assertion exists if claimed signed |
| 2 | **Intent hash** | Recompute `SHA-256_base64url(eventType\|entityId\|userId)` → must equal `assertion.intentHash` |
| 3 | **Challenge binding** | Decode `clientDataJSON`, verify `challenge === intentHash` and `type === "webauthn.get"` |
| 4 | **Payload hash** | Recompute `SHA-256(canonicalStringify(payload))` → must equal `intent.payloadHash` |
| 5 | **Public key cross-check** | If externally resolved key provided, verify it matches `credential.publicKeyBase64` |
| 6 | **WebAuthn signature** | `signedData = authenticatorData \|\| SHA-256(clientDataJSON)` → verify ECDSA P-256 signature |
| 7 | **Hash chain** | Recompute event hash from chain fields using the documented pipe-delimited format |

For unsigned events, only steps 1 and 7 are run.

Endpoints:
- `POST /api/proofs/verify` — Verify with optional registry lookup for public key cross-check
- `POST /api/proofs/verify/offline` — Verify without any external lookups

---

## 14. Cryptographic Primitives

### 14.1 Algorithms Used

| Purpose | Algorithm | Standard |
|---------|-----------|----------|
| Event hashing | SHA-256 | FIPS 180-4 |
| Integrity hashing | SHA-256 | FIPS 180-4 |
| File content hashing | SHA-256 | FIPS 180-4 |
| Merkle tree (leaves) | SHA-256(`entityId:headEventHash`) | FIPS 180-4 |
| Merkle tree (interior) | SHA-256(`left\|right`) pipe-delimited | FIPS 180-4 |
| External anchoring | SHA-256(merkleRoot) → Sigstore Rekor `hashedrekord` v0.0.1 | Sigstore / RFC 6962 |
| Passkey signatures | ECDSA P-256 (ES256) | FIPS 186-4 / WebAuthn |
| Platform signature | ECDSA P-256 (SHA-256) | FIPS 186-4 |
| Public key format | COSE (CBOR) | RFC 8152 |
| Key export format | SPKI DER | RFC 5280 |
| Private key format | PKCS8 DER | RFC 5958 |
| Intent binding | SHA-256 → base64url | RFC 4648 §5 |

All cryptographic operations use Node.js's native `crypto` module, which binds to OpenSSL.

### 14.2 COSE → SPKI Key Conversion

WebAuthn stores public keys in COSE format (CBOR-encoded). Node.js `crypto.createVerify()` expects SPKI DER. The conversion process:

1. **Parse COSE map** — Custom minimal CBOR parser extracts `x` and `y` coordinates (COSE labels `-2` and `-3` for EC2 P-256 keys)
2. **Construct uncompressed EC point** — `0x04 || x || y` (65 bytes)
3. **Wrap in ASN.1 DER** — `SEQUENCE { AlgorithmIdentifier(ecPublicKey, prime256v1), BIT STRING(point) }`

The same conversion is implemented in both the backend `NodeCryptoService` and the standalone verifier script.

### 14.3 DER Signature Encoding

WebAuthn produces signatures in IEEE P1363 format (`r || s`, 64 bytes for P-256). OpenSSL expects DER-encoded signatures. The conversion:

1. Split the 64-byte raw signature into `r` (32 bytes) and `s` (32 bytes)
2. Trim leading zeros from each, then add a leading zero byte if the high bit is set (negative-looking integer)
3. Encode as ASN.1 DER: `SEQUENCE { INTEGER r, INTEGER s }`
4. Already-DER-encoded signatures are detected and passed through

### 14.4 Platform Signing Key Management

| Environment | Key Source |
|-------------|-----------|
| **Production** | `PLATFORM_SIGNING_KEY` env var — base64-encoded PKCS8 DER EC P-256 private key |
| **Development** | Auto-generated EC P-256 key pair at startup (warning logged) |

The public key is derived from the private key as SPKI DER and embedded in every Trust Envelope's `platformSignature` section.

---

## 15. Evidence Attachments

Physical evidence files (PDFs, images, spreadsheets) can be uploaded and linked to a PO.

### Upload Flow

```
POST /api/evidence/upload (multipart/form-data)
Fields: file, purchaseOrderId, type, description
```

1. **Validate** — PO exists, user is buyer or supplier, file size ≤ 10 MB
2. **Allowed MIME types** — PDF, JPEG, PNG, WebP, CSV, XLSX
3. **Hash** — `SHA-256(file buffer)` → stored as `sha256Hash`
4. **Store** — File written to `uploads/` directory with UUID filename
5. **Record** — `EvidenceAttachment` DB record created
6. **Ledger** — `EVIDENCE_UPLOADED` event logged with file metadata (attachment ID, type, filename, size, hash)

### Verification

```
GET /api/evidence/:id/verify
```

Re-reads the file from disk, recomputes SHA-256, compares to stored hash. Returns `{ valid: true/false, storedHash, computedHash }`.

### Attachment Types

| Type | Description |
|------|-------------|
| `DELIVERY_NOTE` | Proof of delivery |
| `SIGNED_RECEIPT` | Signed acceptance |
| `PHOTO_PROOF` | Photographic evidence |
| `INVOICE` | Commercial invoice |
| `INSPECTION_REPORT` | Quality inspection |
| `SHIPPING_DOCUMENT` | Bill of lading, etc. |
| `PO_DOCUMENT` | The PO itself |
| `OTHER` | Catch-all |

---

## 16. API Reference

### Ledger APIs (JWT required)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/ledger` | List events (optional `?entityId` filter) |
| `GET` | `/api/ledger/verify` | Verify all entity chains |
| `GET` | `/api/ledger/verify/:entityId` | Verify a single entity's chain |
| `GET` | `/api/ledger/proof/:eventId` | Get proof bundle for a single event |
| `POST` | `/api/ledger/challenge` | Get WebAuthn challenge (intent hash) |
| `POST` | `/api/ledger/events` | Submit signed event with WebAuthn assertion |
| `POST` | `/api/ledger/anchor` | Create global integrity anchor |
| `GET` | `/api/ledger/anchors` | Get latest anchor |
| `GET` | `/api/ledger/anchors/verify` | Verify anchor chain |
| `GET` | `/api/ledger/anchors/proof/:entityId` | Get Merkle inclusion proof for an entity |

### Proof APIs (mixed auth)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/proofs/event/:eventId` | JWT | Proof bundle for single event |
| `GET` | `/api/proofs/entity/:entityId` | JWT | Proof bundles for all entity events |
| `POST` | `/api/proofs/verify` | **Public** | Verify proof bundle (with registry lookup) |
| `POST` | `/api/proofs/verify/offline` | **Public** | Verify proof bundle (no external lookups) |
| `GET` | `/api/proofs/registry/credentials/:id` | **Public** | Lookup credential public key |
| `GET` | `/api/proofs/identity/signers/:id` | **Public** | Lookup signer identity |

### Evidence APIs (JWT required)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/evidence/upload` | Upload evidence file |
| `GET` | `/api/evidence/po/:poId` | List evidence for a PO |
| `GET` | `/api/evidence/:id/download` | Download attachment |
| `GET` | `/api/evidence/:id/verify` | Verify file integrity |
| `GET` | `/api/evidence/po/:poId/pack` | **Generate Trust Envelope** |

### Verification APIs (public)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/verify` | **Public** | Verify a full Trust Envelope (15 checks) |
| `GET` | `/api/verify/health` | **Public** | Health check |

---

## 17. Local Receipts (Layer 4)

Local receipts complete the four-layer trust model by ensuring the platform **"can't omit"** events. At the moment a user performs a signed action, the platform returns a cryptographically signed receipt that the client stores locally in IndexedDB. If the platform were to later remove or alter an event, the user holds irrefutable proof of the platform's prior commitment.

### 17.1 Trust Model Context

| Layer | Property | Mechanism | Section |
|-------|----------|-----------|---------|
| 1 | Self-contained proof (can't deny) | WebAuthn ECDSA P-256 signatures | §10 |
| 2 | Hash chain (can't reorder) | Per-entity SHA-256 chain | §8 |
| 3 | Merkle anchor (can't alter after) | Binary Merkle tree + Sigstore Rekor | §9 |
| **4** | **Local receipts (can't omit)** | **Platform-signed receipts in IndexedDB** | **§17** |

### 17.2 Receipt Format

Each `EventReceipt` has version `"1.0"` and contains:

```typescript
interface EventReceipt {
  version: "1.0";
  eventId: string;           // UUID of the ledger event
  entityId: string;          // Entity (PO / early-payment) ID
  entityType: string;        // "PURCHASE_ORDER" | "EARLY_PAYMENT"
  eventType: string;         // e.g. "PO_SENT", "PO_ACCEPTED"
  entitySequence: number;    // Per-entity sequence number
  eventHash: string;         // SHA-256 hash of the event record
  previousHash: string;      // Previous hash in entity chain
  actorId: string;           // User who performed the action
  timestamp: string;         // ISO-8601 event timestamp
  payloadHash: string;       // SHA-256 of canonical payload JSON
  signed: boolean;           // Whether passkey-signed
  intentHash: string | null; // WebAuthn intent hash (if signed)
  platformAttestation: {
    receiptHash: string;     // Deterministic hash of all receipt fields
    signature: string;       // ECDSA P-256 signature over receiptHash
    publicKey: string;       // Platform's public key (base64)
    signedAt: string;        // ISO-8601 signing timestamp
  };
}
```

**Receipt hash** is computed as `SHA-256` of a deterministic pipe-delimited string:
```
eventId|entityId|entityType|eventType|entitySequence|eventHash|previousHash|actorId|timestamp|payloadHash|signed|intentHash
```

The platform signs this hash with its ECDSA P-256 private key, creating a non-repudiable commitment.

### 17.3 Backend: Receipt Generation

`LedgerService.buildReceipt(event)` constructs and signs a receipt from a raw event record:

1. Computes `payloadHash = SHA-256(canonicalStringify(event.payload))`
2. Determines `signed` status from presence of WebAuthn signature fields
3. Builds deterministic `receiptHash` from pipe-joined fields
4. Signs with `ICryptoService.signWithPlatformKey(receiptHash)`
5. Returns the complete `EventReceipt`

Every user-signed service method (14 across PO + early payment services) now returns the receipt alongside the entity:

```typescript
// PurchaseOrdersService — 12 methods:
// send (2 paths), accept, reject, counterPropose, acceptCounter,
// rejectCounter, markShipped, markDelivered, verifyDelivery,
// acknowledgeObligation, dispute

// EarlyPaymentsService — 2 methods:
// requestEarlyPayment, fund

return { ...formatPO(entity), _receipt: this.ledger.buildReceipt(event) };
```

System-generated events (auto-approval, settlement completion, expiry) do **not** generate receipts — they are platform-initiated and do not require client-side non-repudiation.

### 17.4 Frontend: IndexedDB Storage

The receipt store (`frontend/src/lib/receipt-store.ts`) provides:

| Function | Description |
|----------|-------------|
| `storeReceipt(apiResponse)` | Extracts `_receipt` from API response, stores in IndexedDB |
| `getReceipts(actorId?)` | Retrieves all receipts, optionally filtered by actor |
| `getReceiptsByEntity(entityId)` | Retrieves receipts for a specific entity |
| `getReceiptCount()` | Returns total stored receipt count |
| `exportReceipts()` | JSON export for external verification/backup |

**IndexedDB schema:**
- Database: `sme-receipts`
- Object store: `receipts` (keyPath: `eventId`)
- Indexes: `entityId`, `actorId`, `eventType`, `timestamp`

All functions are SSR-safe (check `typeof window`). Storage failures never block the UI — they log a warning and return `null`.

**Integration points** — receipts are captured in `onSuccess` of every signing mutation:
- Purchase Order detail page (`makeSignedAction` helper, 12 mutation types)
- Early Payments page (`requestMutation`, `fundMutation`)

### 17.5 Verification Endpoint

```
POST /api/ledger/receipts/verify
```

**Request body:**
```json
{
  "receipts": [
    {
      "eventId": "uuid",
      "eventHash": "sha256-hex",
      "entityId": "uuid",
      "entitySequence": 3
    }
  ]
}
```

**Response:**
```json
{
  "total": 10,
  "verified": 9,
  "missing": 1,
  "mismatched": 0,
  "allVerified": false,
  "results": [
    {
      "eventId": "uuid",
      "entityId": "uuid",
      "status": "VERIFIED",
      "detail": "Event hash and sequence match"
    },
    {
      "eventId": "uuid",
      "entityId": "uuid",
      "status": "MISSING",
      "detail": "Event not found in ledger"
    }
  ]
}
```

**Status codes:** `VERIFIED` | `MISSING` | `HASH_MISMATCH` | `SEQUENCE_MISMATCH`

The endpoint performs a bulk lookup of events by ID and compares hashes and sequence numbers against the stored receipt stubs.

### 17.6 My Receipts Dashboard

The `/dashboard/receipts` page provides:

- **Receipt count** — total receipts stored in browser IndexedDB
- **Receipt log table** — event type, entity ID (truncated), sequence, signed status, timestamp, event hash (truncated), verification status
- **Verify All** button — sends all receipt stubs to the verification endpoint, color-codes results (green = verified, red = missing/mismatch)
- **Export JSON** — downloads all receipts as a JSON file for external backup or independent verification
- **Summary cards** — total, verified, missing, mismatched counts after verification
- **Verification banner** — green (all match) or red (discrepancies found) with explanatory text

---

## 18. Testing Infrastructure

### 18.1 Test Database Isolation

Tests execute against a dedicated `sme_payments_test` database, completely isolated from the development database. The lifecycle is managed by Jest hooks:

| Phase | File | Action |
|-------|------|--------|
| **Global Setup** | `test/global-setup.ts` | Creates `sme_payments_test` database (idempotent — checks `pg_database` catalogue first). Runs `prisma migrate deploy` and `ts-node prisma/seed.ts` against the test DB. |
| **Before Each File** | `test/set-test-env.ts` (via `setupFiles`) | Sets `DATABASE_URL=postgresql://sme_user:sme_password@localhost:5433/sme_payments_test`, `ANCHOR_PROVIDER=noop`, `ANCHOR_INTERVAL_MINUTES=0` |
| **Global Teardown** | `test/global-teardown.ts` | Terminates all active connections via `pg_terminate_backend`, then `DROP DATABASE IF EXISTS sme_payments_test` |

**No `.env.test` file** — all test environment variables are hardcoded in the setup files to ensure deterministic behaviour.

### 18.2 Anchor Configuration in Tests

| Variable | Test Value | Production Value |
|----------|------------|-----------------|
| `ANCHOR_PROVIDER` | `noop` | `rekor` (Sigstore Rekor) |
| `ANCHOR_INTERVAL_MINUTES` | `0` (disabled) | Non-zero (auto-anchoring cron) |

The `NoopProvider` returns a synthetic anchor response without making any external network calls, keeping tests fast and deterministic.

### 18.3 Test Suite Inventory

| Category | Suites | Tests |
|----------|--------|-------|
| **Unit tests** (`.spec.ts`) | 8 | 85 |
| **E2E tests** (`.e2e-spec.ts`) | 11 | 238 |
| **Total** | **19** | **323** |

Both Jest configs (`jest.config.ts` and `test/jest-e2e.config.ts`) share the same `globalSetup`, `globalTeardown`, and `setupFiles` entries.

### 18.4 Shell Integration Test

`e2e-test.sh` is a separate **curl-based** integration script that exercises a running backend (port 3001) and frontend (port 3002) through 18 sequential steps: multi-user login → PO creation → negotiation → early payment → LP funding → delivery → settlement → verification → admin statistics → frontend page checks.

---

## 19. Security Considerations

| Area | Approach |
|------|----------|
| **Ledger immutability** | Append-only inserts; no UPDATE/DELETE on event_log; entity-scoped hash chain makes tampering detectable |
| **Concurrent writes** | Per-entity chains allow parallel writes; unique constraint + retry prevents sequence conflicts |
| **Biometric binding** | WebAuthn intent hash = `SHA-256(eventType\|entityId\|actorId)` — non-replayable, action-specific |
| **Signature non-repudiation** | ECDSA P-256 signature stored with raw WebAuthn materials; verifiable offline |
| **Platform key** | ECDSA P-256; production key via env var; development auto-generates (logged warning) |
| **File integrity** | SHA-256 computed on upload; re-verified on download and in evidence packs |
| **Role-based access** | Every state transition validates the actor's role (BUYER, SUPPLIER, ADMIN, LIQUIDITY_PARTNER) |
| **PO ownership** | Every PO operation validates `po.buyerId === actorId` or `po.supplierId === actorId` |
| **Fund reservation** | Buyer balance checked before PO acceptance; funds locked atomically with acceptance |
| **Early payment guards** | PO must be in fundable state for LP funding; stale requests auto-expire |
| **Dispute window** | Configurable dispute window (default 72h) after delivery |
| **Approval policies** | Configurable per-org thresholds, multi-signature support, auto-approve for low-value |
| **LP risk controls** | Exposure ceilings, per-buyer/per-supplier concentration limits, whitelist enforcement |
| **Verification independence** | Public APIs (proof verify, envelope verify, credential registry) require no auth — anyone can verify |
| **Zero-dependency verifier** | Standalone CLI script reimplements all crypto from scratch; no supply chain trust required |
| **Merkle tree anchoring** | Binary SHA-256 Merkle tree over all entity head hashes; inclusion proofs let any entity verify membership without full ledger access |
| **External notarization** | Merkle roots anchored to Sigstore Rekor transparency log — tamper-evident third-party timestamps; offline cross-check via embedded proof body |
| **Anchor chain integrity** | Each `LedgerAnchor` hashes the previous anchor's hash, forming an ordered chain; gaps or reordering are detectable |
| **Local receipt non-repudiation** | Platform-signed ECDSA P-256 receipts stored client-side in IndexedDB; if platform omits an event, user holds cryptographic proof of prior commitment |
| **Receipt verification** | Bulk `POST /ledger/receipts/verify` compares local receipt stubs against live ledger; detects omissions, hash mismatches, and sequence gaps |
| **Test isolation** | Dedicated `sme_payments_test` database created/destroyed per test run; `ANCHOR_PROVIDER=noop` prevents external calls during tests |

---

*Generated 11 March 2026. This document reflects the current production codebase (312 tests, 19 suites, all passing). Updated for Layer 4 (Local Receipts) implementation.*
