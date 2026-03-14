# SME Payments Platform — Technical Reference

**Version:** 2.9  
**Date:** 14 March 2026  
**Audience:** Engineering team, auditors, integration partners, regulators  
**Status:** Production-ready (501/501 tests passing, 30 test suites, isolated test database)

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
   - 3.8.1 [Settlement Router Service](#381-settlement-router-service)
   - 3.9 [Dispute Resolution](#39-dispute-resolution)
4. [Early Payment State Machine](#4-early-payment-state-machine)
   - 4.1 [All Early Payment States](#41-all-early-payment-states)
   - 4.2 [Complete Transition Table](#42-complete-transition-table)
   - 4.3 [Early Payment State Diagram](#43-early-payment-state-diagram)
   - 4.4 [LP Funding Policy & Risk Controls](#44-lp-funding-policy--risk-controls)
   - 4.5 [Expiry Logic](#45-expiry-logic)
5. [Payment Lock State Machine](#5-payment-lock-state-machine)
6. [Payment Instrument State Machine](#6-payment-instrument-state-machine)
   - 6.1 [Instrument States](#61-instrument-states)
   - 6.2 [Settlement Beneficiary](#62-settlement-beneficiary)
   - 6.3 [Transition Table](#63-transition-table)
   - 6.4 [State Diagram](#64-state-diagram)
   - 6.5 [Atomic Locking (`SELECT FOR UPDATE`)](#65-atomic-locking-select-for-update)
   - 6.6 [Compensating Transactions](#66-compensating-transactions)
7. [Settlement State Machine](#7-settlement-state-machine)
8. [Dispute State Machine](#8-dispute-state-machine)
9. [The Immutable Ledger](#9-the-immutable-ledger)
   - 9.1 [Design Principles](#91-design-principles)
   - 9.2 [Hash Chain Algorithm](#92-hash-chain-algorithm)
   - 9.3 [Canonical JSON Serialization](#93-canonical-json-serialization)
   - 9.4 [Concurrency & Retry Logic](#94-concurrency--retry-logic)
   - 9.5 [Event Types Reference](#95-event-types-reference)
10. [Merkle Tree Anchoring & External Notarization](#10-merkle-tree-anchoring--external-notarization)
    - 10.1 [Overview](#101-overview)
    - 10.2 [Merkle Tree Algorithm](#102-merkle-tree-algorithm)
    - 10.3 [Anchor Creation Flow](#103-anchor-creation-flow)
    - 10.4 [External Anchoring via Sigstore Rekor](#104-external-anchoring-via-sigstore-rekor)
    - 10.5 [Anchor Provider Architecture](#105-anchor-provider-architecture)
    - 10.6 [Inclusion Proofs](#106-inclusion-proofs)
    - 10.7 [Anchor Chain Verification](#107-anchor-chain-verification)
    - 10.8 [Auto-Anchoring Scheduler](#108-auto-anchoring-scheduler)
    - 10.9 [LedgerAnchor Schema](#109-ledgeranchor-schema)
11. [Passkey Signing (WebAuthn)](#11-passkey-signing-webauthn)
    - 11.1 [Challenge Generation](#111-challenge-generation)
    - 11.2 [Assertion Verification](#112-assertion-verification)
    - 11.3 [What Gets Stored](#113-what-gets-stored)
12. [Trust Envelope (Evidence Pack v2.0)](#12-trust-envelope-evidence-pack-v20)
    - 12.1 [Purpose](#121-purpose)
    - 12.2 [Generation Flow](#122-generation-flow)
    - 12.3 [Complete Envelope Structure](#123-complete-envelope-structure)
    - 12.4 [Section-by-Section Reference](#124-section-by-section-reference)
    - 12.5 [Integrity Hash Hierarchy](#125-integrity-hash-hierarchy)
    - 12.6 [Platform Signature](#126-platform-signature)
13. [Proof Bundles](#13-proof-bundles)
    - 13.1 [Structure](#131-structure)
    - 13.2 [Per-Event vs Per-Entity Generation](#132-per-event-vs-per-entity-generation)
    - 13.3 [Public Registries](#133-public-registries)
14. [Verification System](#14-verification-system)
    - 14.1 [Three Layers of Verification](#141-three-layers-of-verification)
    - 14.2 [Full Envelope Verification — 15 Checks](#142-full-envelope-verification--15-checks)
    - 14.3 [Standalone CLI Verifier](#143-standalone-cli-verifier)
    - 14.4 [Web Verification Service](#144-web-verification-service)
    - 14.5 [Proof Bundle Verification — 7 Steps](#145-proof-bundle-verification--7-steps)
15. [Cryptographic Primitives](#15-cryptographic-primitives)
    - 15.1 [Algorithms Used](#151-algorithms-used)
    - 15.2 [COSE → SPKI Key Conversion](#152-cose--spki-key-conversion)
    - 15.3 [DER Signature Encoding](#153-der-signature-encoding)
    - 15.4 [Platform Signing Key Management](#154-platform-signing-key-management)
16. [Evidence Attachments](#16-evidence-attachments)
17. [API Reference](#17-api-reference)
18. [Local Receipts (Layer 4)](#18-local-receipts-layer-4)
    - 18.1 [Trust Model Context](#181-trust-model-context)
    - 18.2 [Receipt Format](#182-receipt-format)
    - 18.3 [Backend: Receipt Generation](#183-backend-receipt-generation)
    - 18.4 [Frontend: IndexedDB Storage](#184-frontend-indexeddb-storage)
    - 18.5 [Verification Endpoint](#185-verification-endpoint)
    - 18.6 [My Receipts Dashboard](#186-my-receipts-dashboard)
19. [Testing Infrastructure](#19-testing-infrastructure)
    - 19.1 [Test Database Isolation](#191-test-database-isolation)
    - 19.2 [Test Configuration](#192-test-configuration)
20. [Security Considerations](#20-security-considerations)
21. [Financial Integrity Checker](#21-financial-integrity-checker)
    - 21.1 [Invariant Catalogue](#211-invariant-catalogue)
    - 21.2 [IntegrityService Architecture](#212-integrityservice-architecture)
    - 21.3 [Admin Endpoint & Frontend](#213-admin-endpoint--frontend)
    - 21.4 [Scheduled Cron](#214-scheduled-cron)
22. [Idempotent Financial Operations](#22-idempotent-financial-operations)
    - 22.1 [Design Overview](#221-design-overview)
    - 22.2 [IdempotencyRecord Schema](#222-idempotencyrecord-schema)
    - 22.3 [IdempotencyService](#223-idempotencyservice)
    - 22.4 [HTTP-Level Idempotency (Interceptor)](#224-http-level-idempotency-interceptor)
    - 22.5 [Service-Level Idempotency Guards](#225-service-level-idempotency-guards)
    - 22.6 [Protected Endpoints](#226-protected-endpoints)
    - 22.7 [Client Integration Guide](#227-client-integration-guide)
    - 22.8 [Configuration](#228-configuration)
23. [Escrow Transaction Journal](#23-escrow-transaction-journal)
    - 23.1 [EscrowTransaction Model](#231-escrowtransaction-model)
    - 23.2 [EscrowAccountingService](#232-escrowaccountingservice)
    - 23.3 [Integration Points](#233-integration-points)
    - 23.4 [Admin Endpoints](#234-admin-endpoints)
    - 23.5 [Reconciliation Enhancement](#235-reconciliation-enhancement)
    - 23.6 [Frontend Statement View](#236-frontend-statement-view)
24. [Lifecycle Stress Testing](#24-lifecycle-stress-testing)
    - 24.1 [Scenario Runner](#241-scenario-runner)
    - 24.2 [Stress Orchestrator](#242-stress-orchestrator)
    - 24.3 [Race Condition E2E Tests](#243-race-condition-e2e-tests)
    - 24.4 [npm Scripts](#244-npm-scripts)
25. [Feature Flag & Pilot Gating](#25-feature-flag--pilot-gating)
    - 25.1 [Architecture](#251-architecture)
    - 25.2 [Flag Catalogue](#252-flag-catalogue)
    - 25.3 [Admin API](#253-admin-api)
    - 25.4 [Frontend Page](#254-frontend-page)
    - 25.5 [Guard Integration Points](#255-guard-integration-points)

---

## 1. Introduction

The SME Payments Platform is a B2B trade finance system that enables buyers and suppliers to manage purchase orders, lock payments, settle transactions, and — optionally — access early payment via liquidity partners (LPs). The platform is differentiated by its **cryptographic trust infrastructure**: every significant business action is recorded in an immutable, hash-chained ledger, optionally signed with the user's biometric passkey (WebAuthn FIDO2), and packaged into a **Trust Envelope** that any external party (bank, regulator, auditor) can independently verify without trusting the platform.

### Key Capabilities

- **Purchase Order Lifecycle** — Create, negotiate, approve, fulfil, verify, and settle POs with role-based guards at every transition
- **2-Step Escrow Funding** — Buyer initiates escrow funding (sees bank details: bank name, IBAN, reference); a simulated bank callback (configurable delay via `ESCROW_CONFIRM_DELAY_MS`) confirms the deposit; only then does the PO advance to FULFILLMENT. The simulation is swap-ready for real bank API integration.
- **Payment Locks** — Buyer funds are reserved on PO acceptance and released on settlement, ensuring supplier confidence
- **Multi-Currency Architecture** — All monetary amounts stored as integer minor units (pence/halalah) with an explicit `Currency` companion field; currency is derived from organisation jurisdiction (`UK→GBP`, `KSA→SAR`) and propagated immutably from PO through every downstream record (lock, instrument, settlement, fee, dispute)
- **Double-Payment Prevention** — Atomic `SELECT FOR UPDATE` transactions on the `PaymentInstrument` row prevent the race condition between LP funding and buyer settlement; a `settlementBeneficiary` field is the single source of truth for who receives escrow funds
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
| **InstrumentService** | `src/settlements/` | Payment instrument lifecycle with atomic `SELECT FOR UPDATE` transitions; owns `settlementBeneficiary` |
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
| **IdempotencyService** | `src/idempotency/` | Request-level idempotency: cache check, response recording, TTL-based cleanup |
| **EscrowAccountingService** | `src/settlements/` | Escrow transaction journal: per-account statements, balance verification, audit trail |
| **PoliciesService** | `src/policies/` | Configurable business rules (PO limits, approval thresholds, LP risk) — currency-aware per-org limits |
| **FraudControlsService** | `src/risk/` | Velocity checks, evidence thresholds — all limits currency-specific |
| **DisputesService** | `src/disputes/` | Dispute lifecycle with ADMIN resolution |
| **PasskeysService** | `src/passkeys/` | WebAuthn credential registration and assertion |

### Data Flow — Transaction Lifecycle

```
Buyer creates PO (currency inherited from buyer's Organisation)
    → Currency propagated: PO.currency = Organisation.currency
    → LedgerService.logEvent(PO_CREATED)
        → Hash chain extended (entity-scoped)

Supplier accepts PO
    → LedgerService.logEvent(PO_ACCEPTED)
    → If passkey: WebAuthn signature stored with event

Buyer initiates escrow funding (fundEscrow — Step 1)
    → SettlementService.reserveForPO() — funds reserved from buyer balance
    → PaymentLock created (LOCKED, status PENDING until bank confirms)
    → LedgerService.logEvent(ESCROW_FUNDING_INITIATED)
    → Returns escrow account details (bank, IBAN, label, currency, country)
    → Simulated bank callback scheduled (configurable delay)

Bank confirms deposit (confirmEscrowFunding — Step 2)
    → Escrow account balance credited
    → PO transitions ACCEPTED → FULFILLMENT
    → LedgerService.logEvent(ESCROW_FUNDED)
    → Production: replace setTimeout with real bank webhook

Supplier ships/delivers → ledger events

Buyer verifies delivery
    → LedgerService.logEvent(DELIVERY_VERIFIED)

Buyer acknowledges payment obligation
    → InstrumentService.requestSettlement() — atomic SELECT FOR UPDATE; reads settlementBeneficiary
    → SettlementService.settlePO() — funds released to beneficiary (supplier or LP)
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
| `SimulatedAdapter` | In-memory balance tracking for development/demo (supports GBP + SAR) |
| `KsaBankAdapter` | Saudi bank rail integration via SARIE (SAR only) |

Each adapter declares its `supportedCurrencies` array. The settlement service validates that the transaction currency is supported by the selected adapter before execution.

### Currency Propagation Rule

```
Organisation.currency (from jurisdiction)
    → PurchaseOrder.currency (immutable after creation)
        → PaymentLock.currency
        → PaymentInstrument.currency
        → Settlement.currency
        → PlatformFee.currency
        → EarlyPaymentRequest.currency
        → Dispute.currency
```

Currency is set once at PO creation from the buyer's org default and **never changes**. All downstream records inherit the PO's currency. See §7 for the full multi-currency design.

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
| `FULFILLMENT` | Work underway; escrow funded and confirmed (also used after REWORK dispute resolution) | No |
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
| 5 | `SENT` | `ACCEPTED` | `accept()` | SUPPLIER | `po.supplierId === actorId` | `PO_ACCEPTED` | PO accepted; buyer can now initiate escrow funding |
| 5a | `ACCEPTED` | `ACCEPTED` | `fundEscrow()` (Step 1) | BUYER | `po.buyerId === actorId`; buyer balance ≥ PO amount; no existing lock | `ESCROW_FUNDING_INITIATED` | Buyer funds reserved; PaymentLock created (LOCKED); escrow bank details returned (bank, IBAN, reference); simulated bank callback scheduled |
| 5b | `ACCEPTED` | `FULFILLMENT` | `confirmEscrowFunding()` (Step 2) | SYSTEM (bank callback) | PO is ACCEPTED; lock is LOCKED | `ESCROW_FUNDED` | Escrow account balance credited; PO → FULFILLMENT; `paymentLocked = true` |
| 6 | `SENT` | `CANCELLED` | `reject()` | SUPPLIER | `po.supplierId === actorId` | `PO_CANCELLED` | — |
| 7 | `SENT` | `NEGOTIATION` | `counterPropose()` | SUPPLIER | `po.supplierId === actorId` | `PO_COUNTER_PROPOSED` | `PORevision` record created |
| 8 | `NEGOTIATION` | `NEGOTIATION` | `counterPropose()` | OTHER PARTY | Cannot counter own latest proposal; actor must be a PO party | `PO_COUNTER_PROPOSED` | Prior PENDING revision marked SUPERSEDED; new `PORevision` created |
| 9 | `NEGOTIATION` | `SENT` | `acceptCounter()` | OTHER PARTY | Latest revision is PENDING; cannot accept own proposal | `PO_COUNTER_ACCEPTED` | Revision's lineItems/amount/terms applied to PO; revision marked ACCEPTED |
| 10 | `NEGOTIATION` | `CANCELLED` | `rejectCounter()` | OTHER PARTY | Latest revision is PENDING; cannot reject own proposal | `PO_COUNTER_REJECTED` | Revision marked REJECTED |
| 11 | `FULFILLMENT` | `SHIPPED` | `markShipped()` | SUPPLIER | `po.supplierId === actorId`; status is FULFILLMENT; PaymentLock must be LOCKED | `GOODS_SHIPPED` | `shippedAt` set |
| 12 | `SHIPPED` | `DELIVERED` | `markDelivered()` | SUPPLIER | `po.supplierId === actorId`; status is SHIPPED | `DELIVERY_MARKED` | `deliveredAt` set |
| 13 | `DELIVERED` | `VERIFIED` | `verifyDelivery()` | BUYER | `po.buyerId === actorId` | `DELIVERY_VERIFIED` | `verifiedAt` set |
| 14 | `VERIFIED` | `SETTLED` | `acknowledgeObligation()` | BUYER | `po.buyerId === actorId` | `OBLIGATION_ACKNOWLEDGED` + `SETTLEMENT_COMPLETED` | Settlement executed (see §3.8) |
| 15 | `DELIVERED` | `DISPUTED` | `dispute()` | BUYER | `po.buyerId === actorId` | `DELIVERY_DISPUTED` | Unfunded early payment auto-expired if exists |
| 16 | `DELIVERED` | `DISPUTED` | `DisputesService.raise()` | BUYER | Within dispute window (72h default); no active dispute | `DISPUTE_RAISED` | `Dispute` record created |
| 17 | `DISPUTED` | `CANCELLED` | `resolve(FULL_REFUND)` | ADMIN | Dispute exists and not RESOLVED | `DISPUTE_RESOLVED` | Full refund to buyer; PaymentLock → REFUNDED |
| 18 | `DISPUTED` | `SETTLED` | `resolve(PARTIAL_REFUND)` | ADMIN | `refundAmount > 0 && < po.amount` | `DISPUTE_RESOLVED` | Partial refund to buyer |
| 19 | `DISPUTED` | `VERIFIED` | `resolve(RELEASE_TO_SUPPLIER)` | ADMIN | Dispute exists | `DISPUTE_RESOLVED` | Full settlement to supplier (0.5% fee) |
| 20 | `DISPUTED` | `FULFILLMENT` | `resolve(REWORK)` | ADMIN | Dispute exists | `DISPUTE_RESOLVED` | No settlement; supplier redoes work |

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
            │          fundEscrow() (Step 1)    │
            │          ───────► (funds reserved,│
            │           escrow details shown)   │
            │                                   │
            │          confirmEscrowFunding()    │
            │          (Step 2: bank callback)  │
            │                    │              │
            │                    ▼              │
            │              FULFILLMENT          │
            │                    │              │
            │           markShipped()           │
            │                    │              │
            │                    ▼              │
            │                SHIPPED            │
            │                    │              │
            │           markDelivered()         │
            │                    │              │
            │                    ▼              │
            │                DELIVERED          │
            │               │        │          │
            │  verifyDelivery()  dispute() / raise()
            │               │        │
            │               ▼        ▼
            │            VERIFIED   DISPUTED
            │               │       │   │   │   │
            │     acknowledge()     │   │   │   │
            │               │       │   │   │   │
            │               ▼       │   │   │   │
            │            SETTLED    │   │   │   │
            │           (terminal)  │   │   │   │
            │                       │   │   │   │
            │    ┌──────────────────┘   │   │   │
            │    │  FULL_REFUND         │   │   │
            │    ▼                      │   │   │
            │ CANCELLED                 │   │   │
            │                           │   │   │
            │    ┌──────────────────────┘   │   │
            │    │ PARTIAL_REFUND           │   │
            │    ▼                          │   │
            │ SETTLED                       │   │
            │                               │   │
            │    ┌──────────────────────────┘   │
            │    │ RELEASE_TO_SUPPLIER          │
            │    ▼                              │
            │ VERIFIED ──► SETTLED              │
            │                                   │
            │    ┌──────────────────────────────┘
            │    │ REWORK
            │    ▼
            │ FULFILLMENT ──► SHIPPED ──► DELIVERED ──► ... (cycle)
```

### 3.4 PO Creation & Validation

When a buyer creates a PO:

1. **Supplier validation** — The target user must exist and have the `SUPPLIER` role
2. **Currency assignment** — The PO's `currency` is set from `buyerOrg.currency` (which is derived from the org's jurisdiction: `UK→GBP`, `KSA→SAR`). Currency is **immutable** after creation.
3. **Amount limits** — The platform evaluates the buyer's organisation's `PO_ORDER_LIMITS` policy rule using **currency-specific thresholds**:
   - GBP: £500 minimum, £250,000 maximum
   - SAR: ر.س1,875 minimum, ر.س937,500 maximum
4. **Tax computation** — VAT is computed based on jurisdiction (UK 20%, KSA 15%)
5. **Reference generation** — Unique PO reference number (e.g., `PO-ABCD1234-XY12`)

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

After acceptance, the buyer funds the escrow (2-step flow), then the supplier progresses through fulfilment:

#### 3.7.1 Escrow Funding (2-Step Async Flow)

The escrow funding process is designed as a **simulation-first architecture** — the current implementation uses a configurable `setTimeout` that can be swapped for a real bank API (e.g., webhook from SARIE/ACH rail) without changing the frontend or PO state machine.

| Step | Method | Actor | Input State | Output State | Description |
|------|--------|-------|-------------|--------------|-------------|
| 1 | `fundEscrow()` | BUYER | ACCEPTED | ACCEPTED (unchanged) | Reserves buyer funds, creates PaymentLock (LOCKED), returns escrow bank details (bank, IBAN, label, currency, country). Schedules simulated bank callback. |
| 2 | `confirmEscrowFunding()` | SYSTEM (bank callback) | ACCEPTED + Lock LOCKED | FULFILLMENT | Credits escrow account balance, sets `paymentLocked = true`, transitions PO to FULFILLMENT. |

**Escrow details returned by Step 1:**
```json
{
  "escrowDetails": {
    "bank": "Barclays Bank UK",
    "iban": "GB29BARC20035394427492",
    "label": "UK Escrow – GBP",
    "currency": "GBP",
    "country": "UK"
  },
  "fundingPending": true
}
```

**Simulation configuration:**
- `ESCROW_CONFIRM_DELAY_MS` — delay before auto-confirm (default: 4000ms, tests: 999999ms to disable)
- `PATCH /api/purchase-orders/:id/confirm-escrow` — admin endpoint for manual/test triggering

**Idempotency:** If `fundEscrow()` is called again on a PO that has progressed past ACCEPTED (e.g. already in FULFILLMENT), the service-level guard returns the existing PO state with a 200 response instead of throwing an error. Additionally, if the PO is still ACCEPTED but already has a LOCKED PaymentLock, it returns the existing escrow details without creating a duplicate lock. See §22 for the full idempotency framework.

**Production integration path:** Replace `scheduleEscrowConfirmation()` (setTimeout) with a webhook handler on the existing `POST /api/settlements/webhooks/bank-callback` endpoint (HMAC-SHA256 verified).

#### 3.7.2 Supplier Fulfilment Steps

| Action | Method | Allowed From | Result |
|--------|--------|--------------|--------|
| Ship goods | `markShipped()` | FULFILLMENT | SHIPPED |
| Deliver goods | `markDelivered()` | SHIPPED | DELIVERED |
| Buyer verifies | `verifyDelivery()` | DELIVERED | VERIFIED |

**Strict state guards:**
- `markShipped()` requires PO status `FULFILLMENT` **and** PaymentLock status `LOCKED` (payment must be secured before shipping)
- `markDelivered()` requires PO status `SHIPPED` only (no skip from FULFILLMENT to DELIVERED)
- This enforces the linear progression: **FULFILLMENT → SHIPPED → DELIVERED**

### 3.8 Settlement Flow

When the buyer calls `acknowledgeObligation()` on a VERIFIED PO:

0. **Idempotency guard** — If the PO is already `SETTLED`, the method returns the existing PO state (200) without re-executing settlement. See §22 for the full idempotency framework.
1. **Query the Payment Instrument** — `PaymentInstrument` is loaded by `purchaseOrderId` (instrument and payment lock are independent models that both reference the PO)
2. **Auto-expire stale early payments** — If a `REQUESTED` (unfunded) early payment exists, it is auto-expired (`EARLY_PAY_EXPIRED` event); if the instrument was `FINANCING_REQUESTED`, it is reverted to `LOCKED` via `InstrumentService.revertFinancing()`
3. **Resolve settlement plan** — `SettlementRouterService.resolveSettlement(poId)` returns a `SettlementPlan` containing:
   - The **recipient** (`SUPPLIER` or `LIQUIDITY_PROVIDER`), determined by the instrument's `settlementBeneficiary` field
   - **Fee breakdown**: `grossAmount`, `platformFee` (50 BPS / 0.5%), `netAmount`, `feeBps`
   - **Currency** and recipient bank account reference
   - **`earlyPaymentRequestId`** if the recipient is the LP (for recoup tracking)
4. **Atomic settlement gate** — `InstrumentService.requestSettlement()` transitions the instrument to `SETTLEMENT_PENDING` using `SELECT FOR UPDATE`. This atomically blocks any concurrent LP `fund()` call
5. **Settlement execution** — `SettlementService.settlePO()` receives the plan's values and releases locked funds via the adapter to the beneficiary
6. **Records created** — `Settlement` record (COMPLETED), `PlatformFee` record, PaymentLock → RELEASED, instrument → confirmed SETTLED
7. **Ledger events** — `OBLIGATION_ACKNOWLEDGED` (includes `recipient`, `feeBps`), `SETTLEMENT_INITIATED`, `PAYMENT_LOCK_RELEASED`, `SETTLEMENT_COMPLETED`

#### 3.8.1 Settlement Router Service

`SettlementRouterService` (`backend/src/settlements/settlement-router.service.ts`) is the **single source of truth** for settlement routing decisions. It centralises:

- **Recipient resolution** — determines who gets paid based on the instrument's `settlementBeneficiary` field
- **Fee calculation** — uses the `PLATFORM_TRANSACTION_FEE_BPS` constant (50 BPS), replacing previously hardcoded inline values
- **Dispute outcome mapping** — translates dispute outcomes into ordered settlement action lists

```
┌─────────────────────────────────┐
│     SettlementRouterService     │
│                                 │
│  resolveSettlement(poId)        │──→ SettlementPlan
│    → recipient (SUPPLIER / LP)  │      { recipient, recipientUserId,
│    → fee breakdown              │        grossAmount, platformFee,
│    → currency, account ref      │        netAmount, feeBps, currency }
│                                 │
│  resolveDisputeSettlement(      │──→ DisputeSettlementPlan
│    poId, outcome, refundAmt?)   │      { outcome, newPoStatus,
│    → ordered action list        │        actions: (REFUND|SETTLE|NOOP)[] }
│                                 │
│  resolveRecipient() [private]   │
│    → SUPPLIER / LP / BUYER      │
└─────────────────────────────────┘
         ▲                ▲
         │                │
  PurchaseOrdersService   DisputesService
  acknowledgeObligation() executeDisputeSettlement()
```

**Module registration:** `SettlementRouterService` lives in `SettlementsModule` (providers + exports). `OrganisationsModule` is imported for bank IBAN lookups. Both `PurchaseOrdersModule` and `DisputesModule` import `SettlementsModule` and receive the router automatically.

#### Double-Payment Prevention

The race condition between LP `fund()` and buyer `acknowledgeObligation()` is prevented at the database level:

- Both `fund()` (via `InstrumentService.confirmFinancing()`) and `acknowledgeObligation()` (via `InstrumentService.requestSettlement()`) use `SELECT ... FOR UPDATE` on the same `PaymentInstrument` row
- PostgreSQL serializes these concurrent transactions — one wins, the other blocks until the first commits
- If `fund()` wins: instrument becomes `FINANCING_FUNDED` with `settlementBeneficiary = LIQUIDITY_PROVIDER`; subsequent `requestSettlement()` sees the LP beneficiary and routes escrow to LP
- If `acknowledgeObligation()` wins: instrument becomes `SETTLEMENT_PENDING`; subsequent `confirmFinancing()` rejects because `SETTLEMENT_PENDING` is not a valid source state for financing
- If `fund()`'s bank adapter call fails after the beneficiary flip, a compensating transaction (`revertFinancing()`) atomically resets beneficiary to `SUPPLIER`

### 3.9 Dispute Resolution

Buyers can dispute a delivered PO within the dispute window (default 72 hours):

| Resolution Outcome | PO Status | Financial Effect |
|--------------------|-----------|------------------|
| `FULL_REFUND` | CANCELLED | All locked funds returned to buyer via `REFUND` action |
| `PARTIAL_REFUND` | SETTLED | Specified amount returned to buyer via `REFUND` action |
| `RELEASE_TO_SUPPLIER` | VERIFIED (→ SETTLED) | Full amount settled to supplier via `SETTLE` action (0.5% fee) |
| `REWORK` | FULFILLMENT | `NOOP` action; supplier redoes work |

When a dispute is resolved, `DisputesService.executeDisputeSettlement()` delegates to `SettlementRouterService.resolveDisputeSettlement()`, which returns a `DisputeSettlementPlan` containing an ordered list of typed actions (`REFUND`, `SETTLE`, or `NOOP`). The disputes service executes each action sequentially via `SettlementService.refundPO()` or `settlePO()`.

**Known gap (Phase 3+):** `PARTIAL_REFUND` currently refunds the partial amount to the buyer but does not settle the remainder to the supplier in the same operation. This is because `refundPO()` marks the payment lock as `REFUNDED`, which prevents a subsequent `settlePO()` call. A future `PARTIALLY_REFUNDED` lock state will enable this two-step flow.

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
| 1 | — | `REQUESTED` | `requestEarlyPayment()` | SUPPLIER | `po.supplierId === supplierId`; PO in {ACCEPTED, FULFILLMENT, SHIPPED, DELIVERED}; PaymentLock is LOCKED; no existing early payment request | `EARLY_PAY_REQUESTED` | Fee calculated at 250 BPS (2.5%): `serviceFee`, `netAdvance`, `faceValue`; instrument transitions LOCKED → FINANCING_REQUESTED via `InstrumentService.requestFinancing()` |
| 2 | `REQUESTED` | `FUNDED` | `fund()` | LIQUIDITY_PARTNER | LP balance ≥ netAdvance; PO in fundable state; LP funding policy passes (exposure/concentration limits); instrument `SELECT FOR UPDATE` succeeds (not already SETTLEMENT_PENDING) | `EARLY_PAY_FUNDED` | LP pays supplier `netAdvance`; `InstrumentService.confirmFinancing()` atomically flips `settlementBeneficiary` to LIQUIDITY_PROVIDER; Settlement record (EARLY_PAY_ADVANCE); PlatformFee (EARLY_PAY_FACILITATION); `fundedAt` set. On adapter failure: `revertFinancing()` compensating transaction resets beneficiary to SUPPLIER |
| 3 | `REQUESTED` | `EXPIRED` | `fund()` (auto-expire) | SYSTEM | PO has left fundable state (not in ACCEPTED/FULFILLMENT/SHIPPED/DELIVERED) | `EARLY_PAY_EXPIRED` | Stale request expired; 400 error returned to LP |
| 4 | `REQUESTED` | `EXPIRED` | `acknowledgeObligation()` | SYSTEM | PO is settling without LP funding | `EARLY_PAY_EXPIRED` | Reason: "PO settled without LP funding"; instrument reverted from FINANCING_REQUESTED → LOCKED via `revertFinancing()` if applicable |
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

Additionally, the LP marketplace (`getMarketplace()`) filters out requests where the PO is not in a fundable state (`ACCEPTED`, `FULFILLMENT`, `SHIPPED`, `DELIVERED`), so expired/stale requests don't appear.

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
| — | `LOCKED` | Buyer initiates escrow funding → `SettlementService.reserveForPO()` (Step 1 of 2-step flow) | `PAYMENT_LOCK_CONFIRMED` |
| `LOCKED` | `RELEASED` | PO settlement → `SettlementService.settlePO()` | `PAYMENT_LOCK_RELEASED` + `SETTLEMENT_INITIATED` |
| `LOCKED` | `REFUNDED` | Dispute resolution (FULL_REFUND / PARTIAL_REFUND) → `SettlementService.refundPO()` | `PAYMENT_LOCK_REFUNDED` |

---

## 6. Payment Instrument State Machine

The `PaymentInstrument` is the **financial twin** of a PO — it tracks the state of the escrow money and, critically, records **who is entitled to receive** escrow funds at settlement time via the `settlementBeneficiary` field.

> **Key invariant**: `settlementBeneficiary` is the single source of truth for recipient determination. The `acknowledgeObligation()` flow reads this field to decide where escrow funds go — it never derives the recipient from the early payment status.

### 6.1 Instrument States

| State | Description | Terminal? |
|-------|-------------|-----------|
| `CREATED` | Instrument created when PO is submitted | No |
| `LOCK_REQUESTED` | Lock request sent to the payment rail/adapter | No |
| `LOCKED` | Buyer funds successfully reserved in escrow | No |
| `FINANCING_REQUESTED` | Supplier has requested early payment; LP marketplace is open | No |
| `FINANCING_FUNDED` | LP has funded the supplier; beneficiary flipped to LP | No |
| `SETTLEMENT_PENDING` | Settlement initiated; blocks any further financing | No |
| `SETTLED` | Escrow released to beneficiary; lifecycle complete | **Yes** |
| `REFUNDED` | Escrow returned to buyer (dispute/cancellation) | **Yes** |
| `FAILED` | Irrecoverable adapter failure | **Yes** |

### 6.2 Settlement Beneficiary

The `settlementBeneficiary` field on `PaymentInstrument` determines who receives escrow funds:

| Value | Meaning | Set By |
|-------|---------|--------|
| `SUPPLIER` | Default — supplier receives escrow at settlement | `create()` (initial) or `revertFinancing()` (compensating) |
| `LIQUIDITY_PROVIDER` | LP funded early payment — LP receives escrow at settlement | `confirmFinancing()` (atomic flip) |
| `BUYER` | Escrow returned to buyer (refund scenario) | `refund()` |

### 6.3 Transition Table

| # | From | To | Method | Actor | Atomic? | Ledger Event | Side Effects |
|---|------|-----|--------|-------|---------|--------------|--------------|
| 1 | — | `CREATED` | `create()` | SYSTEM | No | `INSTRUMENT_CREATED` | `settlementBeneficiary = SUPPLIER`; `buyerOrgId`, `supplierOrgId` denormalized |
| 2 | `CREATED` | `LOCK_REQUESTED` | `requestLock()` | SYSTEM | No | `INSTRUMENT_LOCK_REQUESTED` | Sent to payment adapter |
| 3 | `LOCK_REQUESTED` | `LOCKED` | `confirmLock()` | SYSTEM | No | `INSTRUMENT_LOCKED` | `bankReference`, `escrowReference` stored |
| 4 | `LOCKED` | `FINANCING_REQUESTED` | `requestFinancing()` | SUPPLIER | `SELECT FOR UPDATE` | `FINANCING_REQUESTED` | Instrument opened for LP marketplace |
| 5 | `FINANCING_REQUESTED` | `FINANCING_FUNDED` | `confirmFinancing()` | LP | `SELECT FOR UPDATE` | `FINANCING_CONFIRMED` | `settlementBeneficiary` flipped to `LIQUIDITY_PROVIDER`; `financingPartnerId` set |
| 6 | `FINANCING_FUNDED` / `FINANCING_REQUESTED` | `LOCKED` | `revertFinancing()` | SYSTEM | `SELECT FOR UPDATE` | `FINANCING_REVERTED` | Compensating transaction: `settlementBeneficiary` reset to `SUPPLIER`; `financingPartnerId` cleared |
| 7 | `LOCKED` / `FINANCING_FUNDED` | `SETTLEMENT_PENDING` | `requestSettlement()` | BUYER | `SELECT FOR UPDATE` | `SETTLEMENT_INITIATED` | Atomic gate — blocks LP funding |
| 8 | `SETTLEMENT_PENDING` | `SETTLED` | `confirmSettlement()` | SYSTEM | No | `INSTRUMENT_SETTLED` | `bankReference` stored; `settledAt` set |
| 9 | `LOCKED` | `REFUNDED` | `refund()` | SYSTEM | No | `INSTRUMENT_REFUNDED` | `settlementBeneficiary` set to `BUYER`; `settledAt` set |
| 10 | Any non-terminal | `FAILED` | `fail()` | SYSTEM | No | `INSTRUMENT_FAILED` | Terminal state on irrecoverable error |

### 6.4 State Diagram

```
                      create()
                         │
                         ▼
                    ┌─────────┐
                    │ CREATED │
                    └────┬────┘
                         │ requestLock()
                         ▼
                  ┌──────────────┐
                  │ LOCK_REQUESTED│
                  └──────┬───────┘
                         │ confirmLock()
                         ▼
                    ┌────────┐
         ┌──────────│ LOCKED │──────────┐
         │          └───┬────┘          │
         │              │               │
    requestFinancing()  │  requestSettlement()   refund()
         │              │               │          │
         ▼              │               │          ▼
  ┌──────────────────┐  │               │   ┌──────────┐
  │FINANCING_REQUESTED│  │               │   │ REFUNDED │
  └───────┬──────────┘  │               │   └──────────┘
          │             │               │
    confirmFinancing()  │               │
  (beneficiary → LP)    │               │
          │             │               │
          ▼             │               │
  ┌──────────────────┐  │               │
  │ FINANCING_FUNDED │──┘               │
  └──────────────────┘                  │
          │ requestSettlement()         │
          │                             │
          └──────────┐     ┌────────────┘
                     ▼     ▼
              ┌──────────────────┐
              │ SETTLEMENT_PENDING│
              └────────┬─────────┘
                       │ confirmSettlement()
                       ▼
                  ┌─────────┐
                  │ SETTLED  │
                  └─────────┘

  ── revertFinancing() ──
  FINANCING_FUNDED/FINANCING_REQUESTED → LOCKED
  (compensating transaction on adapter failure)

  ── fail() ──
  Any non-terminal → FAILED
```

### 6.5 Atomic Locking (`SELECT FOR UPDATE`)

Four instrument transitions use PostgreSQL row-level locking to prevent race conditions:

| Method | SQL Pattern | Why |
|--------|-------------|-----|
| `requestFinancing()` | `SELECT * FROM payment_instruments WHERE id = $1 FOR UPDATE` | Prevents concurrent financing + settlement on same PO |
| `confirmFinancing()` | Same | Prevents two LPs funding the same request |
| `revertFinancing()` | Same | Prevents revert racing with settlement |
| `requestSettlement()` | Same | The **settlement gate** — atomically blocks LP funding |

All four methods run inside a `prisma.$transaction()` block. The `SELECT FOR UPDATE` acquires an exclusive row lock — any concurrent transaction attempting the same row blocks until the first commits or rolls back.

### 6.6 Compensating Transactions

The `fund()` flow in `EarlyPaymentsService` uses a **compensating transaction** pattern:

```
1. confirmFinancing()         ← atomic SELECT FOR UPDATE
   beneficiary: SUPPLIER → LIQUIDITY_PROVIDER
   status: FINANCING_REQUESTED → FINANCING_FUNDED

2. adapter.transferAdvance()  ← call bank rail

3a. If success → commit earlyPay as FUNDED ✓
3b. If failure → revertFinancing()  ← compensating transaction
    beneficiary: LIQUIDITY_PROVIDER → SUPPLIER
    status: → LOCKED
```

This ensures the database state is always consistent even if the external bank call fails after the beneficiary flip.

---

## 7. Multi-Currency Architecture

The platform stores all monetary amounts as **integer minor units** (pence for GBP, halalah for SAR) with an explicit `currency` field on every model that holds a monetary value. Currency is derived from the organisation's jurisdiction and propagated immutably through the entire transaction lifecycle.

### 7.1 Design Principles

| Principle | Rule |
|-----------|------|
| **One currency per transaction** | A PO and all downstream records (lock, instrument, settlement, fee) share a single currency |
| **Organisation-driven default** | Currency comes from `Organisation.currency`, which is set from `jurisdiction` (`UK→GBP`, `KSA→SAR`) |
| **Immutable after creation** | Once a PO is created, its currency cannot change |
| **Integer minor units** | All amounts stored as `Int` — never floating point; pence (GBP) or halalah (SAR) |
| **No FX in v1** | No cross-currency conversions; each transaction is single-currency end-to-end |
| **Explicit pairing** | Every `Int` amount field has a companion `Currency` column — no orphan amounts |

### 7.2 Currency Enum

Defined as a Prisma enum and used across all models:

```prisma
enum Currency {
  GBP
  SAR
}
```

| Currency | Region | Minor Unit | Units/Major | Symbol |
|----------|--------|------------|-------------|--------|
| `GBP` | United Kingdom | pence | 100 | £ |
| `SAR` | Saudi Arabia | halalah | 100 | SAR |

Additional currencies (AED, USD, EUR) can be added when expanding to those markets — no schema redesign required.

### 7.3 Currency Propagation Chain

```
Organisation (jurisdiction → currency)
    │
    ▼
PurchaseOrder.currency ← set at creation, immutable
    │
    ├──► PaymentLock.currency
    ├──► PaymentInstrument.currency
    ├──► EarlyPaymentRequest.currency
    ├──► Settlement.currency
    ├──► PlatformFee.currency
    └──► Dispute.currency
```

Every service that creates a downstream record copies `currency` from the PO. No record infers currency from context or defaults — it is always explicitly set.

### 7.4 Currency-Specific Limits & Thresholds

#### PO Amount Limits (per-currency)

| Currency | Minimum | Maximum |
|----------|---------|---------|
| GBP | £500 (50,000 minor) | £250,000 (25,000,000 minor) |
| SAR | SAR 1,875 (187,500 minor) | SAR 937,500 (93,750,000 minor) |

#### Fraud Control Thresholds (per-currency)

| Threshold | GBP | SAR |
|-----------|-----|-----|
| Max daily value per buyer | £500,000 | SAR 1,875,000 |
| Mandatory evidence threshold | £100,000 | SAR 375,000 |

Thresholds are approximately equivalent in real value; they are maintained as separate per-currency configurations.

### 7.5 Settlement Adapter Currency Support

| Adapter | Supported Currencies | Validation |
|---------|---------------------|------------|
| `SimulatedAdapter` | `GBP`, `SAR` | Accepts both; operates on simulated `User.balance` |
| `KsaBankAdapter` | `SAR` only | Rejects non-SAR transactions; SARIE threshold at 20k SAR |

Each adapter declares a `supportedCurrencies` array. The settlement service validates `request.currency ∈ adapter.supportedCurrencies` before executing any fund lock, transfer, or settlement.

### 7.6 Currency Formatting

The shared package provides a currency-aware formatting utility:

```typescript
CURRENCY_META: Record<string, {
  subUnit: string;        // "pence" | "halalah"
  subUnitsPerUnit: number; // 100
  symbol: string;          // "£" | "SAR"
  locale: string;          // "en-GB" | "en-SA"
}>
```

`formatCurrency(amountMinor, currency)` converts minor units to a locale-appropriate display string:

```
formatCurrency(70000000, "SAR") → "SAR 700,000.00"
formatCurrency(15000000, "GBP") → "£150,000.00"
```

All frontend pages pass the entity's `currency` field to this formatter — no page defaults to a hardcoded currency.

### 7.7 Naming Convention — Minor Units

API response fields use the `*Minor` suffix for monetary amounts (e.g., `amountMinor`, `totalAmountMinor`, `faceValueMinor`) to remain currency-neutral. Every response object that includes a `*Minor` field also includes a `currency` field at the same level.

| API Field | Description | Companion |
|-----------|-------------|-----------|
| `amountMinor` | PO/lock/settlement amount in minor units | `currency` |
| `totalAmountMinor` | PO gross amount (net + tax) in minor units | `currency` |
| `faceValueMinor` | Early payment face value | `currency` |
| `serviceFeeMinor` | Early payment service fee | `currency` |
| `netAdvanceMinor` | Early payment net advance to supplier | `currency` |

### 7.8 Admin Aggregation by Currency

Admin dashboard statistics and reconciliation reports are grouped by currency:

```json
{
  "volumeByCurrency": { "GBP": 8000000, "SAR": 43456780 },
  "feesByCurrency":   { "GBP": 40000,   "SAR": 217283 }
}
```

This prevents the meaningless mixing of GBP and SAR amounts into a single total. LP exposure snapshots and reconciliation reports are also per-currency.

### 7.9 Future Expansion

| Phase | Scope |
|-------|-------|
| **Current (v1)** | GBP + SAR only; single currency per transaction; no FX |
| **Regional expansion** | Add AED, USD to `Currency` enum; per-currency escrow accounts |
| **Cross-border trade** | FX conversion layer; multi-currency escrow; LP hedging |

The schema and propagation chain already support N currencies — adding a new currency requires only an enum value addition and per-currency configuration entries.

---

## 8. Settlement State Machine

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

## 8. Dispute State Machine

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
| `REWORK` | `FULFILLMENT` | No financial action; supplier redoes work |

---

## 9. The Immutable Ledger

### 9.1 Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Append-only** | Events are only ever inserted, never updated or deleted |
| **Entity-scoped hash chain** | Each entity (PO, payment lock, dispute, etc.) maintains its own hash chain. This allows parallel writes for different entities without a global mutex |
| **Per-entity sequencing** | Each entity has a monotonically increasing `entitySequence` counter (1, 2, 3…) |
| **Deterministic hashing** | Every hash is recomputable from the stored data — no hidden inputs |
| **Unique constraint** | `@@unique([entityId, entitySequence])` prevents duplicate sequence numbers |

### 9.2 Hash Chain Algorithm

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
- `canonicalStringify(payload)` = deterministic JSON serialization (see §9.3)
- `timestamp` = ISO-8601 string from `Date.toISOString()`
- All fields are joined by the pipe character `|`
- The resulting hex digest is stored in `event_log.event_hash`

**Tamper evidence**: Modifying any field in any event changes its hash, which breaks the chain for all subsequent events in that entity. An attacker would need to recompute every subsequent hash in the chain.

### 9.3 Canonical JSON Serialization

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

### 9.4 Concurrency & Retry Logic

Because the entity-scoped chain requires reading the latest `eventHash` before inserting, two concurrent writes to the same entity could conflict. The system handles this with:

1. **Transaction isolation** — Each `logEvent()` call runs inside a `ReadCommitted` Prisma transaction
2. **Unique constraint** — `@@unique([entityId, entitySequence])` catches any concurrent insert with the same sequence number
3. **Retry with backoff** — On Prisma error `P2034` (serialization failure) or `P2002` (unique violation), the operation retries up to **5 times** with exponential backoff: `delay = 10 × 2^attempt + random(0–10) ms`

Different entities write in parallel without contention, since each has its own chain.

### 9.5 Event Types Reference

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
| `ESCROW_FUNDING_INITIATED` | PURCHASE_ORDER | Buyer initiates escrow funding (Step 1 — funds reserved, bank details shown) |
| `ESCROW_FUNDED` | PURCHASE_ORDER | Bank confirms escrow deposit (Step 2 — PO → FULFILLMENT) |
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
| `INSTRUMENT_CREATED` | PAYMENT_INSTRUMENT | Payment instrument created for PO |
| `INSTRUMENT_LOCK_REQUESTED` | PAYMENT_INSTRUMENT | Lock request sent to adapter |
| `INSTRUMENT_LOCKED` | PAYMENT_INSTRUMENT | Escrow funds locked |
| `FINANCING_REQUESTED` | PAYMENT_INSTRUMENT | Supplier requested early payment; instrument opened for LP marketplace |
| `FINANCING_CONFIRMED` | PAYMENT_INSTRUMENT | LP funded advance; `settlementBeneficiary` flipped to LIQUIDITY_PROVIDER |
| `FINANCING_REVERTED` | PAYMENT_INSTRUMENT | Compensating transaction: beneficiary reset to SUPPLIER (adapter failure) |
| `SETTLEMENT_INITIATED` | PAYMENT_INSTRUMENT | Settlement gate: instrument transitioned to SETTLEMENT_PENDING |
| `INSTRUMENT_SETTLED` | PAYMENT_INSTRUMENT | Escrow released to beneficiary |
| `INSTRUMENT_REFUNDED` | PAYMENT_INSTRUMENT | Escrow returned to buyer |
| `INSTRUMENT_FAILED` | PAYMENT_INSTRUMENT | Irrecoverable adapter failure |
| `EARLY_PAY_REQUESTED` | EARLY_PAYMENT | Supplier requests early payment |
| `EARLY_PAY_FUNDED` | EARLY_PAYMENT | LP funds advance |
| `EARLY_PAY_EXPIRED` | EARLY_PAYMENT | Unfunded request auto-expired |
| `DISPUTE_RAISED` | DISPUTE | Buyer raises formal dispute |
| `DISPUTE_RESOLVED` | DISPUTE | Admin resolves dispute |
| `EVIDENCE_UPLOADED` | PURCHASE_ORDER | File evidence attached |

---

## 10. Merkle Tree Anchoring & External Notarization

### 10.1 Overview

The platform periodically creates **global integrity anchors** — cryptographic snapshots of the entire ledger state. Each anchor builds a binary SHA-256 Merkle tree over all entity head hashes, producing a single root that commits to every entity chain simultaneously. This root is then:

1. **Signed** with the platform's ECDSA P-256 key
2. **Published** to the [Sigstore Rekor](https://rekor.sigstore.dev) transparency log, providing an independently verifiable, tamper-evident timestamp from a neutral third party
3. **Stored** as a `LedgerAnchor` record with the full Rekor receipt

Any external party can verify that a specific entity's events were included in a particular anchor by checking a **Merkle inclusion proof** — a compact path of sibling hashes from the entity's leaf to the root.

### 10.2 Merkle Tree Algorithm

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

### 10.3 Anchor Creation Flow

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

### 10.4 External Anchoring via Sigstore Rekor

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

### 10.5 Anchor Provider Architecture

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

### 10.6 Inclusion Proofs

When generating a Trust Envelope, the `EvidenceService` requests a Merkle inclusion proof for the entity:

```
AnchorService.getInclusionProof(entityId):
    1. Fetch up to 20 most recent anchors (desc by sequence)
    2. For each anchor, check if headHashes[entityId] exists
    3. If found: rebuild Merkle tree from headHashes, compute proof path
    4. Return { anchor metadata, proof: { entityId, leafHash, headHash, path[] } }
```

The proof is embedded in the Trust Envelope's `notarization` section, allowing any verifier to confirm the entity was included in a specific global anchor without access to the full ledger.

### 10.7 Anchor Chain Verification

Anchors form their own chain — each anchor's `previousAnchorHash` links to the prior anchor's `anchorHash`.

`AnchorService.verifyAnchorChain()`:

1. Fetch all anchors ordered by `sequence ASC`
2. Verify first anchor has `previousAnchorHash === null`
3. Each subsequent anchor's `previousAnchorHash` must equal the prior anchor's `anchorHash`
4. For each anchor, **re-derive** the Merkle root from the stored `headHashes` and compare against `anchorHash`
5. Count externally anchored entries
6. Return `{ valid, anchorCount, externallyAnchored, details[] }`

### 10.8 Auto-Anchoring Scheduler

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

### 10.9 LedgerAnchor Schema

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

## 11. Passkey Signing (WebAuthn)

For high-trust actions (accepting a PO, funding an early payment, acknowledging obligation), the user's passkey produces a real ECDSA P-256 signature bound to the specific business action. This is a two-step flow.

### 11.1 Challenge Generation

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

### 11.2 Assertion Verification

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

### 11.3 What Gets Stored

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

## 12. Trust Envelope (Evidence Pack v2.0)

### 12.1 Purpose

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

### 12.2 Generation Flow

```
GET /api/evidence/po/:poId/pack
```

Assembly steps inside `EvidenceService.buildEvidencePack()`:

```
1. Load PO with all relations (buyer, supplier, paymentLock,
   settlements, disputes, earlyPaymentRequest, revisions,
   paymentInstrument)

2. Load all evidence attachments for the PO

3. Collect all related entity IDs:
   PO + paymentLock + paymentInstrument + earlyPaymentRequest + all settlements + all disputes

4. Load ALL ledger events across all related entities
   (includes FINANCING_REQUESTED, FINANCING_CONFIRMED, INSTRUMENT_SETTLED, etc.)

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

11. Build paymentInstrument section:
    - Instrument ID, status, amount, currency
    - settlementBeneficiary (SUPPLIER | LIQUIDITY_PROVIDER | BUYER)
    - Lifecycle: CREATED → LOCKED → SETTLED (verified against ledger events)

12. Compute integrity hashes:
    ledgerRootHash  = SHA-256(eventHash₁ | eventHash₂ | ... | eventHashₙ)
    attachmentsHash = SHA-256(fileHash₁ | fileHash₂ | ...) or SHA-256("NONE")
    envelopeHash    = SHA-256(documentHash | ledgerRootHash | attachmentsHash)

13. Platform signature:
    Sign envelopeHash with platform's ECDSA P-256 private key

14. Check for ledger anchor (Merkle inclusion proof + external notarization via Rekor)

15. Assemble all sections into the final Trust Envelope JSON
```

### 12.3 Complete Envelope Structure

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
  "paymentInstrument": { ... },
  "approvals": [ ... ],
  "proofBundles": [ ... ],
  "integrity": { ... },
  "verification": { ... },
  "platformSignature": { ... },
  "notarization": { ... }
}
```

### 12.4 Section-by-Section Reference

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

#### paymentInstrument

The payment instrument section records the escrow state and settlement beneficiary:

```json
{
  "id": "instrument-uuid",
  "status": "SETTLED",
  "amount": 700000,
  "currency": "SAR",
  "settlementBeneficiary": "SUPPLIER",
  "lifecycle": "CREATED → LOCKED → SETTLED",
  "settledAt": "ISO-8601"
}
```

| Field | Purpose |
|-------|---------|
| `id` | Payment instrument ID |
| `status` | Final instrument status at envelope generation time |
| `amount` / `currency` | Escrow amount and currency |
| `settlementBeneficiary` | Who received (or will receive) escrow: `SUPPLIER`, `LIQUIDITY_PROVIDER`, or `BUYER` — the **single source of truth** for settlement routing |
| `lifecycle` | Human-readable state progression derived from ledger events |
| `settledAt` | Timestamp of settlement (if settled) |

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

Full standalone proof bundles for every event (see §13 for detailed structure). These contain all the raw cryptographic materials needed for independent verification.

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
    "Verify payment instrument lifecycle (CREATED → LOCKED → SETTLED)",
    "Verify settlementBeneficiary matches instrument state",
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

### 12.5 Integrity Hash Hierarchy

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

### 12.6 Platform Signature

The platform holds an ECDSA P-256 key pair used exclusively to seal Trust Envelopes:

- **Production**: Set `PLATFORM_SIGNING_KEY` env var to a base64-encoded PKCS8 DER private key
- **Development**: If the env var is absent, a key pair is auto-generated at startup (warning logged)

The signing process:
1. Compute `envelopeHash` from the integrity section
2. `createSign("SHA256").update(envelopeHash).sign(privateKey)` → DER signature
3. Embed signature (base64) + public key (SPKI DER base64) in the envelope

The public key is embedded in the envelope itself, making the pack self-verifying. For production, the public key should be pinned or distributed via a separate trust channel.

---

## 13. Proof Bundles

### 13.1 Structure

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

### 13.2 Per-Event vs Per-Entity Generation

| API | Description |
|-----|-------------|
| `GET /api/proofs/event/:eventId` | Generate a proof bundle for a single event |
| `GET /api/proofs/entity/:entityId` | Generate proof bundles for all events in an entity, plus verify the hash chain in-process |

The entity-level generation also returns `chainValid: true/false` and a summary of the chain verification.

### 13.3 Public Registries

Two **public, unauthenticated** endpoints allow external verifiers to independently confirm identities:

| Endpoint | Returns |
|----------|---------|
| `GET /api/proofs/registry/credentials/:credentialId` | Public key in COSE format, device type, registration date |
| `GET /api/proofs/identity/signers/:userId` | User name, email, role, organisation details, list of credentials |

These enable verification without platform trust — the verifier can fetch the public key and check the signature independently.

---

## 14. Verification System

### 14.1 Three Layers of Verification

| Layer | Scope | API | Auth |
|-------|-------|-----|------|
| **Per-event** | Single proof bundle | `POST /api/proofs/verify` | Public |
| **Per-entity chain** | Hash chain for one entity | `GET /api/ledger/verify/:entityId` | JWT |
| **Full envelope** | All 15 checks on the Trust Envelope | `POST /api/verify` or CLI script | Public |

### 14.2 Full Envelope Verification — 15 Checks

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

### 14.3 Standalone CLI Verifier

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

### 14.4 Web Verification Service

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

### 14.5 Proof Bundle Verification — 7 Steps

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

## 15. Cryptographic Primitives

### 15.1 Algorithms Used

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

### 15.2 COSE → SPKI Key Conversion

WebAuthn stores public keys in COSE format (CBOR-encoded). Node.js `crypto.createVerify()` expects SPKI DER. The conversion process:

1. **Parse COSE map** — Custom minimal CBOR parser extracts `x` and `y` coordinates (COSE labels `-2` and `-3` for EC2 P-256 keys)
2. **Construct uncompressed EC point** — `0x04 || x || y` (65 bytes)
3. **Wrap in ASN.1 DER** — `SEQUENCE { AlgorithmIdentifier(ecPublicKey, prime256v1), BIT STRING(point) }`

The same conversion is implemented in both the backend `NodeCryptoService` and the standalone verifier script.

### 15.3 DER Signature Encoding

WebAuthn produces signatures in IEEE P1363 format (`r || s`, 64 bytes for P-256). OpenSSL expects DER-encoded signatures. The conversion:

1. Split the 64-byte raw signature into `r` (32 bytes) and `s` (32 bytes)
2. Trim leading zeros from each, then add a leading zero byte if the high bit is set (negative-looking integer)
3. Encode as ASN.1 DER: `SEQUENCE { INTEGER r, INTEGER s }`
4. Already-DER-encoded signatures are detected and passed through

### 15.4 Platform Signing Key Management

| Environment | Key Source |
|-------------|-----------|
| **Production** | `PLATFORM_SIGNING_KEY` env var — base64-encoded PKCS8 DER EC P-256 private key |
| **Development** | Auto-generated EC P-256 key pair at startup (warning logged) |

The public key is derived from the private key as SPKI DER and embedded in every Trust Envelope's `platformSignature` section.

---

## 16. Evidence Attachments

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

## 17. API Reference

### Purchase Order APIs (JWT required)

| Method | Route | Role | Description |
|--------|-------|------|-------------|
| `POST` | `/api/purchase-orders` | BUYER | Create a new PO |
| `PATCH` | `/api/purchase-orders/:id/send` | BUYER | Send PO to supplier |
| `PATCH` | `/api/purchase-orders/:id/accept` | SUPPLIER | Accept PO |
| `PATCH` | `/api/purchase-orders/:id/reject` | SUPPLIER | Reject PO |
| `PATCH` | `/api/purchase-orders/:id/counter` | BUYER/SUPPLIER | Submit counter-proposal |
| `PATCH` | `/api/purchase-orders/:id/accept-counter` | BUYER/SUPPLIER | Accept counter-proposal |
| `PATCH` | `/api/purchase-orders/:id/reject-counter` | BUYER/SUPPLIER | Reject counter-proposal |
| `PATCH` | `/api/purchase-orders/:id/fund-escrow` | BUYER | **Step 1**: Initiate escrow funding (returns bank details) |
| `PATCH` | `/api/purchase-orders/:id/confirm-escrow` | **ADMIN** | **Step 2**: Confirm bank deposit (simulates bank callback) |
| `PATCH` | `/api/purchase-orders/:id/ship` | SUPPLIER | Mark shipped |
| `PATCH` | `/api/purchase-orders/:id/deliver` | SUPPLIER | Mark delivered |
| `PATCH` | `/api/purchase-orders/:id/verify` | BUYER | Verify delivery |
| `PATCH` | `/api/purchase-orders/:id/acknowledge` | BUYER | Acknowledge payment obligation → settle |
| `PATCH` | `/api/purchase-orders/:id/dispute` | BUYER | Dispute delivery |
| `GET` | `/api/purchase-orders` | Any | List POs (filtered by role) |
| `GET` | `/api/purchase-orders/:id` | Any | Get PO details |

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

### Admin APIs (JWT + ADMIN role required)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/admin/integrity-check` | Run financial integrity checker (12 invariants) |
| `GET` | `/api/admin/stats` | Platform statistics |
| `GET` | `/api/admin/reconciliation` | Reconciliation dashboard data |

### Verification APIs (public)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/verify` | **Public** | Verify a full Trust Envelope (15 checks) |
| `GET` | `/api/verify/health` | **Public** | Health check |

---

## 18. Local Receipts (Layer 4)

Local receipts complete the four-layer trust model by ensuring the platform **"can't omit"** events. At the moment a user performs a signed action, the platform returns a cryptographically signed receipt that the client stores locally in IndexedDB. If the platform were to later remove or alter an event, the user holds irrefutable proof of the platform's prior commitment.

### 18.1 Trust Model Context

| Layer | Property | Mechanism | Section |
|-------|----------|-----------|---------|
| 1 | Self-contained proof (can't deny) | WebAuthn ECDSA P-256 signatures | §11 |
| 2 | Hash chain (can't reorder) | Per-entity SHA-256 chain | §9 |
| 3 | Merkle anchor (can't alter after) | Binary Merkle tree + Sigstore Rekor | §10 |
| **4** | **Local receipts (can't omit)** | **Platform-signed receipts in IndexedDB** | **§18** |

### 18.2 Receipt Format

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

### 18.3 Backend: Receipt Generation

`LedgerService.buildReceipt(event)` constructs and signs a receipt from a raw event record:

1. Computes `payloadHash = SHA-256(canonicalStringify(event.payload))`
2. Determines `signed` status from presence of WebAuthn signature fields
3. Builds deterministic `receiptHash` from pipe-joined fields
4. Signs with `ICryptoService.signWithPlatformKey(receiptHash)`
5. Returns the complete `EventReceipt`

Every user-signed service method (15 across PO + early payment services) now returns the receipt alongside the entity:

```typescript
// PurchaseOrdersService — 13 methods:
// send (2 paths), accept, reject, counterPropose, acceptCounter,
// rejectCounter, fundEscrow, markShipped, markDelivered, verifyDelivery,
// acknowledgeObligation, dispute

// EarlyPaymentsService — 2 methods:
// requestEarlyPayment, fund

return { ...formatPO(entity), _receipt: this.ledger.buildReceipt(event) };
```

System-generated events (auto-approval, settlement completion, expiry) do **not** generate receipts — they are platform-initiated and do not require client-side non-repudiation.

### 18.4 Frontend: IndexedDB Storage

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

### 18.5 Verification Endpoint

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

### 18.6 My Receipts Dashboard

The `/dashboard/receipts` page provides:

- **Receipt count** — total receipts stored in browser IndexedDB
- **Receipt log table** — event type, entity ID (truncated), sequence, signed status, timestamp, event hash (truncated), verification status
- **Verify All** button — sends all receipt stubs to the verification endpoint, color-codes results (green = verified, red = missing/mismatch)
- **Export JSON** — downloads all receipts as a JSON file for external backup or independent verification
- **Summary cards** — total, verified, missing, mismatched counts after verification
- **Verification banner** — green (all match) or red (discrepancies found) with explanatory text

---

## 19. Testing Infrastructure

### 19.1 Test Database Isolation

Tests execute against a dedicated `sme_payments_test` database, completely isolated from the development database. The lifecycle is managed by Jest hooks:

| Phase | File | Action |
|-------|------|--------|
| **Global Setup** | `test/global-setup.ts` | Creates `sme_payments_test` database (idempotent — checks `pg_database` catalogue first). Runs `prisma migrate deploy` and `ts-node prisma/seed.ts` against the test DB. |
| **Before Each File** | `test/set-test-env.ts` (via `setupFiles`) | Sets `DATABASE_URL=postgresql://sme_user:sme_password@localhost:5433/sme_payments_test`, `ANCHOR_PROVIDER=noop`, `ANCHOR_INTERVAL_MINUTES=0`, `IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES=0` |
| **Global Teardown** | `test/global-teardown.ts` | Terminates all active connections via `pg_terminate_backend`, then `DROP DATABASE IF EXISTS sme_payments_test` |

**No `.env.test` file** — all test environment variables are hardcoded in the setup files to ensure deterministic behaviour.

### 19.2 Test Configuration

| Variable | Test Value | Production Value |
|----------|------------|-----------------|
| `ANCHOR_PROVIDER` | `noop` | `rekor` (Sigstore Rekor) |
| `ANCHOR_INTERVAL_MINUTES` | `0` (disabled) | Non-zero (auto-anchoring cron) |
| `IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES` | `0` (disabled) | `60` (hourly cleanup) |
| `INTEGRITY_CHECK_INTERVAL_MINUTES` | `0` (disabled) | `60` (hourly check) |

The `NoopProvider` returns a synthetic anchor response without making any external network calls, keeping tests fast and deterministic.

### 19.3 Test Suite Inventory

| Category | Suites | Tests |
|----------|--------|-------|
| **Unit tests** (`.spec.ts`) | 12 | 154 |
| **E2E tests** (`.e2e-spec.ts`) | 16 | 328 |
| **Total** | **28** | **482** |

Both Jest configs (`jest.config.ts` and `test/jest-e2e.config.ts`) share the same `globalSetup`, `globalTeardown`, and `setupFiles` entries.

### 19.4 Shell Integration Test

`e2e-test.sh` is a separate **curl-based** integration script that exercises a running backend (port 3001) and frontend (port 3002) through 18 sequential steps: multi-user login → PO creation → negotiation → early payment → LP funding → delivery → settlement → verification → admin statistics → frontend page checks.

---

## 20. Security Considerations

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
| **Fund reservation** | Buyer balance checked during escrow funding initiation (Step 1); funds reserved atomically; bank confirmation required before PO advances to FULFILLMENT (Step 2) |
| **Escrow funding simulation** | Configurable `ESCROW_CONFIRM_DELAY_MS` environment variable; production swap-in: replace `setTimeout` with real bank webhook; admin `confirm-escrow` endpoint for manual/test triggering |
| **Strict fulfilment guards** | `markShipped()` requires FULFILLMENT status AND PaymentLock LOCKED; `markDelivered()` requires SHIPPED only; prevents shipping without secured payment |
| **Early payment guards** | PO must be in fundable state for LP funding; stale requests auto-expire |
| **Double-payment prevention** | `SELECT FOR UPDATE` on `PaymentInstrument` row serializes concurrent LP funding and buyer settlement; `settlementBeneficiary` is the single source of truth for escrow routing; compensating transaction (`revertFinancing()`) rolls back beneficiary on adapter failure |
| **Settlement gate** | `requestSettlement()` atomically transitions instrument to `SETTLEMENT_PENDING` — once in this state, no LP can call `confirmFinancing()` because `SETTLEMENT_PENDING` is not a valid source state for financing |
| **Beneficiary immutability at settlement** | Once `requestSettlement()` commits, the `settlementBeneficiary` value is locked — it cannot be changed by any subsequent operation |
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
| **Test isolation** | Dedicated `sme_payments_test` database created/destroyed per test run; `ANCHOR_PROVIDER=noop` prevents external calls; `ESCROW_CONFIRM_DELAY_MS=999999` prevents auto-confirm interference in tests |
| **Settlement routing centralisation** | All settlement recipient and fee decisions go through `SettlementRouterService` — no hardcoded fee BPS or recipient IDs in calling code; single source of truth for who gets paid |
| **Financial integrity checker** | `IntegrityService` verifies 12 cross-state-machine invariants on demand and via hourly cron; admin dashboard card shows violation count and severity |
| **Idempotent financial operations** | Two-layer idempotency: HTTP-level `Idempotency-Key` header caching via interceptor + service-level state guards on all financial endpoints; `IdempotencyRecord` table with 24h TTL prevents double-execution of fund, acknowledge, and early-payment operations |

---

## 21. Financial Integrity Checker

The `IntegrityService` (`backend/src/admin/integrity.service.ts`) continuously verifies that the platform's financial state machines are consistent. It detects orphaned records, mismatched amounts, and impossible state combinations that could indicate bugs, data corruption, or incomplete settlement flows.

### 21.1 Invariant Catalogue

| ID | Rule | Severity | Relationship |
|----|------|----------|-------------|
| INV-001 | FULFILLMENT+ PO requires LOCKED PaymentLock | CRITICAL | PO ↔ Lock |
| INV-002 | SETTLED PO requires RELEASED PaymentLock | CRITICAL | PO ↔ Lock |
| INV-003 | SETTLED PO requires SETTLED PaymentInstrument | CRITICAL | PO ↔ Instrument |
| INV-004 | CANCELLED PO (FULL_REFUND) requires REFUNDED PaymentLock | HIGH | PO ↔ Lock ↔ Dispute |
| INV-005 | FUNDED EarlyPayment requires LP beneficiary on Instrument | CRITICAL | EarlyPay ↔ Instrument |
| INV-006 | PaymentLock amount must equal PO amount | HIGH | PO ↔ Lock |
| INV-007 | PaymentLock currency must match PO currency | HIGH | PO ↔ Lock |
| INV-008 | PaymentInstrument amount must equal PO amount | HIGH | PO ↔ Instrument |
| INV-009 | PaymentInstrument currency must match PO currency | HIGH | PO ↔ Instrument |
| INV-010 | SHIPPED PO requires LOCKED PaymentLock | CRITICAL | PO ↔ Lock |
| INV-011 | DELIVERED PO requires LOCKED PaymentLock | CRITICAL | PO ↔ Lock |
| INV-012 | VERIFIED PO requires LOCKED PaymentLock | CRITICAL | PO ↔ Lock |

Full definitions with rationale: `documentation/financial-state-consistency-rules.md`

### 21.2 IntegrityService Architecture

```
IntegrityService.verifyAllInvariants()
    │
    ├─ Query all POs in {FULFILLMENT, SHIPPED, DELIVERED, VERIFIED, SETTLED, CANCELLED}
    │   with includes: paymentLock, paymentInstrument, earlyPaymentRequests, disputes
    │
    ├─ For each PO, check INV-001 through INV-012
    │   Each check: compare actual state vs expected state
    │   On mismatch: push InvariantViolation { invariantId, purchaseOrderId, expected, actual, severity }
    │
    └─ Return IntegrityCheckResult { checkedAt, totalChecked, valid, violations[] }
```

**Response shape:**

```json
{
  "checkedAt": "2026-03-13T14:00:00.000Z",
  "totalChecked": 42,
  "valid": 41,
  "violations": [
    {
      "invariantId": "INV-001",
      "purchaseOrderId": "po-abc123",
      "expected": "PaymentLock exists with status LOCKED",
      "actual": "No PaymentLock found",
      "severity": "CRITICAL"
    }
  ]
}
```

### 21.3 Admin Endpoint & Frontend

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/admin/integrity-check` | JWT + ADMIN | Run all 12 invariants, return violations |

The admin dashboard includes a **Financial Integrity Check** card with:
- A "Run Integrity Check" button triggering the endpoint
- Violation count with severity badges (CRITICAL = red, HIGH = orange, MEDIUM = yellow)
- "All systems healthy" indicator when no violations are found

### 21.4 Scheduled Cron

The integrity check runs automatically via `@Cron(CronExpression.EVERY_HOUR)`. The schedule is gated by the `INTEGRITY_CHECK_INTERVAL_MINUTES` environment variable:

| Variable | Default | Test Value | Effect |
|----------|---------|------------|--------|
| `INTEGRITY_CHECK_INTERVAL_MINUTES` | `60` | `0` (disabled) | Controls whether the cron fires; `0` disables to keep tests fast |

When violations are found, they are logged at `WARN` level with the full violation details.

---

## 22. Idempotent Financial Operations

The platform provides a **two-layer idempotency framework** to prevent double-execution of financial operations. This protects against network retries, client bugs, and infrastructure-level request duplication that could cause duplicate escrow reservations, double settlements, or repeated early-payment disbursements.

### 22.1 Design Overview

```
Client sends request with Idempotency-Key header
         │
         ▼
┌────────────────────────────┐
│  Layer 1: HTTP Interceptor │  ← IdempotencyInterceptor
│                            │
│  Reads Idempotency-Key     │
│  header from request       │
│                            │
│  Cache HIT? ──► Return     │
│  cached response (200)     │
│                            │
│  Cache MISS? ──► Proceed   │
│  to controller + service   │
│  ──► Cache response via    │
│      tap() after success   │
└────────────────────────────┘
         │ (cache miss)
         ▼
┌────────────────────────────┐
│  Layer 2: Service Guards   │  ← Per-method state checks
│                            │
│  Already settled? ──►      │
│  Return existing state     │
│                            │
│  Already funded? ──►       │
│  Return existing state     │
│                            │
│  Not in expected state? ─► │
│  Return idempotent 200     │
│  (no side effects)         │
└────────────────────────────┘
         │ (first execution)
         ▼
   Normal business logic
   (escrow, settlement, etc.)
```

**Layer 1 (HTTP)** handles exact request replays using the `Idempotency-Key` header — the same key always returns the same cached response body and status code. **Layer 2 (Service)** handles cases where the key differs but the operation has already been performed (e.g., a PO is already settled), returning the current state instead of throwing an error.

### 22.2 IdempotencyRecord Schema

```prisma
model IdempotencyRecord {
  id           String   @id @default(uuid())
  key          String   @unique          // caller-supplied Idempotency-Key
  endpoint     String                    // "PATCH /purchase-orders/:id/fund"
  statusCode   Int                       // HTTP status code of original response
  responseBody Json                      // full JSON response body
  createdAt    DateTime @default(now())
  expiresAt    DateTime                  // TTL-based expiry (default 24h)

  @@index([expiresAt])                   // efficient cleanup queries
  @@map("idempotency_records")
}
```

- **Unique key constraint** — prevents duplicate cache entries; concurrent writes are handled via upsert (first writer wins)
- **Expiry index** — enables efficient TTL-based cleanup without full table scans
- **JSON response body** — stores the complete response, not just a hash, enabling exact replay

### 22.3 IdempotencyService

`IdempotencyService` (`backend/src/idempotency/idempotency.service.ts`) provides three operations:

| Method | Signature | Description |
|--------|-----------|-------------|
| `check()` | `check(key: string): Promise<CachedResponse \| null>` | Looks up a record by key. Returns `{ statusCode, body }` if found and not expired. If expired, deletes the record and returns `null`. |
| `record()` | `record(key, endpoint, statusCode, body): Promise<void>` | Upserts a record — first writer wins. Concurrent calls with the same key do not throw; the second is a no-op. TTL is set to `now + TTL_HOURS`. |
| `cleanup()` | `cleanup(): Promise<void>` | `@Cron(CronExpression.EVERY_HOUR)` — deletes all records where `expiresAt < now`. Gated by `IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES` env var (0 disables). |

**First-writer-wins semantics:** The `record()` method uses Prisma's `upsert` with `where: { key }` and a no-op `update: {}`. If two concurrent requests race to cache the same key, the first insert wins and the second becomes an update that changes nothing. This avoids both duplicate records and errors.

### 22.4 HTTP-Level Idempotency (Interceptor)

`IdempotencyInterceptor` (`backend/src/idempotency/idempotency.interceptor.ts`) is registered as a **global `APP_INTERCEPTOR`** via the `@Global()` `IdempotencyModule`. It activates only on endpoints decorated with `@Idempotent()`.

#### Request Flow

```
1. Check for @Idempotent() metadata via NestJS Reflector
   └─ Not present? → pass through (no idempotency logic)

2. Read Idempotency-Key header
   └─ Not present? → pass through (backwards compatible)

3. Call IdempotencyService.check(key)
   └─ Cache HIT → return cached response body immediately (no controller called)

4. Cache MISS → proceed to controller
   └─ On success: cache response via tap() operator
      └─ IdempotencyService.record(key, endpoint, statusCode, body)
```

#### `@Idempotent()` Decorator

```typescript
import { SetMetadata } from "@nestjs/common";

export const IDEMPOTENT_KEY = "idempotent";
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
```

Applied directly to controller methods. Only endpoints with this decorator participate in idempotency caching.

### 22.5 Service-Level Idempotency Guards

In addition to HTTP-level caching, each financial service method includes **state-based guards** that return success when the operation has already been performed, regardless of whether the same `Idempotency-Key` was used:

| Service Method | Guard Condition | Idempotent Response |
|----------------|-----------------|---------------------|
| `fundEscrow()` | PO status is past ACCEPTED (e.g. FULFILLMENT, SHIPPED, etc.) | Returns existing PO state (200) |
| `fundEscrow()` | PO is ACCEPTED but PaymentLock already LOCKED | Returns existing escrow details (200) |
| `acknowledgeObligation()` | PO status is already SETTLED | Returns existing SETTLED PO (200) |
| `requestEarlyPayment()` | Active early payment request already exists for PO | Returns existing request (201) |
| `fund()` (early payment) | Request already FUNDED by same LP | Returns existing FUNDED request (200) |

These guards prevent the service from throwing `BadRequestException` on repeat calls. Instead, the caller receives the same response they would have received on the first successful call. This is critical because:

- A retry may use a **different** `Idempotency-Key` (or none at all) — the HTTP cache would miss, but the service guard catches it
- The PO may have advanced further (e.g., already settled) — the guard returns the current state without erroring

### 22.6 Protected Endpoints

| Endpoint | Controller Method | Layer 1 (HTTP) | Layer 2 (Service) |
|----------|-------------------|----------------|-------------------|
| `PATCH /purchase-orders/:id/fund` | `fundEscrow()` | ✅ `@Idempotent()` | ✅ State guard |
| `PATCH /purchase-orders/:id/acknowledge` | `acknowledge()` | ✅ `@Idempotent()` | ✅ State guard |
| `POST /early-payments` | `request()` | ✅ `@Idempotent()` | ✅ Duplicate check |
| `PATCH /early-payments/:id/fund` | `fund()` | ✅ `@Idempotent()` | ✅ State guard |

### 22.7 Client Integration Guide

To use HTTP-level idempotency, clients include the `Idempotency-Key` header with a unique value per logical operation:

```http
PATCH /api/purchase-orders/abc-123/fund HTTP/1.1
Authorization: Bearer <token>
Idempotency-Key: fund-abc-123-1710350400000
Content-Type: application/json
```

**Key generation guidance:**

| Strategy | Example | Use Case |
|----------|---------|----------|
| UUID v4 | `550e8400-e29b-41d4-a716-446655440000` | General purpose |
| Action + Entity + Timestamp | `fund-{poId}-{timestamp}` | Deterministic retries within same session |
| Client-generated nonce | `client-session-{nonce}` | Mobile/offline-first clients |

**Behaviour summary:**

| Scenario | Result |
|----------|--------|
| First request with key | Executes normally; response cached for 24h |
| Replay with same key (within TTL) | Returns cached response — no side effects |
| Same operation, different key | Service-level guard returns existing state if already performed |
| No `Idempotency-Key` header | Proceeds normally; no caching (backwards compatible) |
| Key on non-`@Idempotent()` endpoint | Header ignored; proceeds normally |

### 22.8 Configuration

| Variable | Default | Test Value | Effect |
|----------|---------|------------|--------|
| `IDEMPOTENCY_TTL_HOURS` | `24` | `24` | TTL for cached responses |
| `IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES` | `60` | `0` (disabled) | Cron cleanup interval; `0` disables |

---

## 23. Escrow Transaction Journal

Every escrow balance mutation is individually recorded as an `EscrowTransaction`, creating a complete audit trail that enables trivial reconciliation and independent balance verification.

### 23.1 EscrowTransaction Model

```prisma
enum EscrowTxType {
  DEPOSIT           // buyer funds escrow (confirmEscrowFunding)
  RELEASE_SUPPLIER  // settlement to supplier
  RELEASE_LP        // settlement to LP (early payment recoup)
  REFUND_BUYER      // dispute refund to buyer
  FEE_DEDUCTION     // platform fee
}

model EscrowTransaction {
  id              String         @id @default(uuid())
  escrowAccountId String
  escrowAccount   EscrowAccount  @relation(fields: [escrowAccountId], references: [id])
  type            EscrowTxType
  amountMinor     Int
  currency        Currency
  balanceAfter    Int            // running balance snapshot after this tx
  purchaseOrderId String?
  purchaseOrder   PurchaseOrder? @relation(fields: [purchaseOrderId], references: [id])
  counterpartyId  String?        // buyer/supplier/LP user ID
  reference       String         // human-readable ref (e.g., "DEPOSIT PO-ABCD1234-XY12")
  ledgerEventId   String?        // link back to immutable ledger event
  createdAt       DateTime       @default(now())

  @@index([escrowAccountId, createdAt])
  @@index([purchaseOrderId])
  @@map("escrow_transactions")
}
```

**Key fields:**

| Field | Purpose |
|-------|----------|
| `type` | Categorises the mutation (5 types) |
| `balanceAfter` | Running balance snapshot — enables statement rendering without recalculation |
| `counterpartyId` | The buyer, supplier, or LP involved in this transaction |
| `reference` | Human-readable string (e.g., `DEPOSIT PO-REF-1234`) |
| `ledgerEventId` | Optional link back to the immutable ledger event |

### 23.2 EscrowAccountingService

**File:** `src/settlements/escrow-accounting.service.ts`

Central service for all escrow journal operations. All record methods accept an optional `Prisma.TransactionClient` parameter so they can participate in existing `$transaction` blocks.

| Method | Description |
|--------|-------------|
| `recordDeposit(input, tx?)` | Creates DEPOSIT transaction after buyer funding confirmation |
| `recordRelease(input, tx?)` | Creates RELEASE_SUPPLIER or RELEASE_LP transaction during settlement |
| `recordRefund(input, tx?)` | Creates REFUND_BUYER transaction during dispute refund |
| `recordFee(input, tx?)` | Creates FEE_DEDUCTION transaction for platform fee |
| `getStatement(escrowAccountId)` | Returns ordered list of all transactions for an account |
| `verifyBalance(escrowAccountId)` | Sums all transactions and compares to shadow `balanceMinor` |

**Recording flow (private `record()` core):**

```
record(input, tx?) ─► read current escrowAccount.balanceMinor
                    ─► create EscrowTransaction with balanceAfter = current balance
                    ─► return { id, balanceAfter }
```

**Balance verification logic:**

```
computed = sum(DEPOSIT amounts) - sum(RELEASE + REFUND + FEE amounts)
matches = (computed === escrowAccount.balanceMinor)
return { escrowAccountId, shadowBalance, computedBalance, matches, transactionCount }
```

### 23.3 Integration Points

The service is called from 3 mutation points that modify escrow balances:

| Mutation | Service | Method | Tx Client |
|----------|---------|--------|-----------|
| `confirmEscrowFunding()` | PurchaseOrdersService | `recordDeposit()` | No (separate operation) |
| `settlePO()` | SettlementService | `recordRelease()` + `recordFee()` | Yes (`tx` from `$transaction`) |
| `refundPO()` | SettlementService | `recordRefund()` | No (separate operation) |

**settlePO() detail:** Inside the existing `$transaction` block, after the escrow balance decrement, the service records:
1. A RELEASE transaction (type depends on whether an early payment LP is involved: `RELEASE_LP` or `RELEASE_SUPPLIER`)
2. A FEE_DEDUCTION transaction if the platform fee is > 0 (at `PLATFORM_TRANSACTION_FEE_BPS` = 50 = 0.5%)

Both calls pass the `tx` client to ensure the journal entries are atomic with the settlement.

### 23.4 Admin Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/admin/escrow-accounts/:id/statement` | GET | JWT + ADMIN | Returns full transaction history for an escrow account |
| `/admin/escrow-accounts/:id/verify-balance` | GET | JWT + ADMIN | Returns balance verification result (shadow vs computed) |

### 23.5 Reconciliation Enhancement

`ReconciliationService` now includes an additional **Step 3b** that verifies escrow journal integrity:

1. Query all active escrow accounts (`isActive: true`)
2. For each account, call `verifyBalance()`
3. Any mismatch is added to the reconciliation `alerts` array
4. Return `escrowJournalVerification[]` in the report

This ensures the cron-driven reconciliation automatically detects journal/balance drift.

### 23.6 Frontend Statement View

**Route:** `/dashboard/admin/escrow-accounts/:id/statement`

Admin-only page displaying:
- **Summary cards:** Current balance, total transaction count, journal verification status (checkmark or X)
- **Transaction table:** Type (coloured badge), amount with sign indicator (+/-), currency, running balance, counterparty, reference, timestamp
- **Type colours:** Green = Deposit, Blue = Release Supplier, Indigo = Release LP, Orange = Refund, Purple = Fee

Linked from the escrow accounts list page via a "Statement" button per account.

---

## 24. Lifecycle Stress Testing

Phase 5 of the operational hardening plan. Exercises concurrent operations, race conditions, and full PO lifecycle scenarios at scale.

### 24.1 Scenario Runner

**File:** `test/stress/scenario-runner.ts`

Standalone TypeScript CLI that runs 10 end-to-end lifecycle scenarios against a live server (`http://localhost:3001/api` by default).

| # | Scenario | Terminal PO State | Key Verification |
|---|----------|-------------------|------------------|
| 1 | Normal settlement | SETTLED | Buyer→supplier payment, platform fee deducted |
| 2 | Early payment funded | SETTLED | LP funds supplier early, settlement routes to LP |
| 3 | Early payment expired | SETTLED | No LP funding, settlement routes to supplier |
| 4 | Dispute — full refund | CANCELLED | Buyer refunded, supplier receives nothing |
| 5 | Dispute — partial refund | SETTLED | Buyer gets partial refund, supplier gets remainder |
| 6 | Dispute — release to supplier | SETTLED | Dispute resolved in supplier's favour |
| 7 | Dispute — rework cycle | SETTLED | PO returned to FULFILLMENT, re-shipped, then settled |
| 8 | LP funding rejected | FULFILLMENT | Wrong role cannot fund EP |
| 9 | Concurrent LP fund + buyer settle | SETTLED | Race condition: exactly 1 path wins |
| 10 | Delayed bank confirmation | FULFILLMENT | Escrow pending until admin confirms |

**Built-in API client:** `api(method, path, token?, body?)` using `fetch`. Helpers for registration, login, PO lifecycle, early payments, disputes.

**Usage:**
```bash
npx ts-node test/stress/scenario-runner.ts                  # all 10 scenarios
npx ts-node test/stress/scenario-runner.ts --scenario=3     # single scenario
npx ts-node test/stress/scenario-runner.ts --chaos           # with random delays
```

### 24.2 Stress Orchestrator

**File:** `test/stress/run-stress.ts`

Orchestrator that runs scenarios at scale with configurable parallelism.

**CLI arguments:**

| Flag | Default | Description |
|------|---------|-------------|
| `--scenarios` | `all` | Which scenarios: `all` or comma-separated IDs (e.g. `1,2,9`) |
| `--count` | `100` | Total iterations per scenario |
| `--concurrency` | `10` | Parallel workers |
| `--chaos` | `false` | Inject random delays between steps |
| `--bail` | `false` | Stop on first failure |
| `--quiet` | `false` | Suppress per-iteration output |

**Reporting:** Pass/fail counts per scenario, timing percentiles (P50/P90/P99/Max), total duration.

### 24.3 Race Condition E2E Tests

**File:** `src/settlements/race-conditions.e2e-spec.ts` (6 tests)

Jest E2E tests exercising concurrent access patterns that could cause double-payments, duplicate locks, or state machine corruption.

**5.5 — Concurrent `fundEscrow()` (3 tests):**

| Test | Concurrent Calls | Assertion |
|------|-------------------|------------|
| 5.5a | 10× `PATCH /:id/fund` | ≥1 returns 200; exactly 1 PaymentLock created (unique constraint) |
| 5.5b | 5× `PATCH /:id/fund` | Exactly 1 `ESCROW_FUNDING_INITIATED` ledger event |
| 5.5c | 1× `fund` then 1× `confirm-escrow` + 3× `fund` | PO reaches FULFILLMENT; exactly 1 lock |

**5.6 — LP fund vs buyer acknowledge (3 tests):**

| Test | Concurrent Calls | Assertion |
|------|-------------------|------------|
| 5.6a | 1× LP `fund EP` + 1× buyer `acknowledge` | ≥1 path wins; PO=SETTLED; ≥1 settlement record |
| 5.6b | 5× buyer `acknowledge` | ≥1 returns 200; exactly 1 settlement; PO=SETTLED |
| 5.6c | 3× LP `fund EP` | ≥1 returns 200; EP=FUNDED; instrument beneficiary=LIQUIDITY_PROVIDER |

**Concurrency safety mechanisms verified:**
- `PaymentLock.purchaseOrderId` — `@unique` constraint prevents duplicate locks
- `PaymentInstrument.purchaseOrderId` — `@unique` constraint prevents duplicate instruments
- `InstrumentService.confirmFinancing()` — `SELECT FOR UPDATE` prevents double-funding
- `InstrumentService.requestSettlement()` — `SELECT FOR UPDATE` prevents double-settlement
- Service-level idempotency guards — check existing lock/instrument before creating

### 24.4 npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run stress` | `ts-node test/stress/run-stress.ts` | Default: 100 iterations, 10 workers |
| `npm run stress:quick` | `...--count=3 --concurrency=1` | Quick smoke test: 3 iterations, sequential |
| `npm run stress:full` | `...--count=100 --concurrency=10 --chaos` | Full stress: 100 iterations, 10 workers, chaos mode |

---

## 25. Feature Flag & Pilot Gating

Runtime feature flag system enabling per-organisation controlled rollout of platform capabilities. Flags can be managed via env vars, global DB overrides, or per-org DB overrides. Admin dashboard provides UI for toggling flags.

### 25.1 Architecture

**Resolution cascade** (first match wins):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | Per-org DB override | `FeatureFlagOverride` row with `flag` + `organisationId` |
| 2 | Global DB override | `FeatureFlagOverride` row with `flag` + `organisationId IS NULL` |
| 3 | `FEATURE_FLAGS` env var | JSON object, e.g. `{"EARLY_PAYMENTS": true}` |
| 4 | Built-in default | Hard-coded in `BUILTIN_DEFAULTS` map |

**Key files:**

| File | Purpose |
|------|---------|
| `backend/src/config/feature-flags.service.ts` | `FeatureFlagService` — `isEnabled()`, `listFlags()`, `setFlag()`, `removeOverride()` |
| `backend/src/config/feature-flags.controller.ts` | Admin REST endpoints (`GET /admin/feature-flags`, `PATCH /admin/feature-flags/:flag`) |
| `backend/src/config/feature-flags.module.ts` | `@Global()` module — exports `FeatureFlagService` to entire app |
| `backend/prisma/schema.prisma` | `FeatureFlagOverride` model + `@@unique([flag, organisationId])` |
| `frontend/src/app/dashboard/admin/feature-flags/page.tsx` | Admin UI for listing and toggling flags |
| `frontend/src/lib/api.ts` | `featureFlagApi.list()` / `featureFlagApi.toggle()` |

### 25.2 Flag Catalogue

| Flag | Built-in Default | Purpose |
|------|-----------------|---------|
| `REAL_BANK_ESCROW` | `false` | Use real bank webhooks for escrow funding instead of simulated `setTimeout` |
| `REAL_KYB_PROVIDER` | `false` | Use Wathq KYB provider instead of mock verification |
| `LP_MARKETPLACE` | `false` | Enable LP marketplace for early payment matching |
| `EARLY_PAYMENTS` | `true` | Allow suppliers to request early payment on eligible POs |
| `MULTI_CURRENCY` | `true` | Enable SAR alongside GBP for cross-border transactions |
| `ESCROW_TRANSACTIONS` | `true` | Enable escrow transaction journal for audit trail |

Shipped features default to `true` to maintain backward compatibility. New/experimental features default to `false`.

### 25.3 Admin API

**List flags:**
```
GET /admin/feature-flags?orgId=<optional>
Authorization: Bearer <admin-token>

Response: {
  flags: [{ flag: string, enabled: boolean, source: "env"|"db-global"|"db-org"|"default" }],
  orgId: string | null
}
```

**Toggle flag:**
```
PATCH /admin/feature-flags/:flag
Authorization: Bearer <admin-token>
Body: { enabled: boolean, organisationId?: string }

Response: { flag: string, enabled: boolean, organisationId: string | null }
```

Both endpoints require `ADMIN` role via `JwtAuthGuard` + `RolesGuard`.

### 25.4 Frontend Page

`/dashboard/admin/feature-flags` — Accessible via admin sidebar (ToggleLeft icon). Displays all flags as cards with:
- Flag name (monospace) + human-readable description
- Source badge (Env Var / Global Override / Org Override / Default)
- ON/OFF status badge (green/grey)
- Toggle button for global enable/disable

Uses `@tanstack/react-query` for data fetching with automatic cache invalidation on mutation.

### 25.5 Guard Integration Points

**Escrow funding** (`purchase-orders.service.ts:fundEscrow()`):
- When `REAL_BANK_ESCROW` is **enabled**: Skips `scheduleEscrowConfirmation()` setTimeout simulation. PO stays in ACCEPTED status until a real bank webhook calls `confirmEscrowFunding()`.
- When **disabled** (default): Runs simulated bank confirmation after `ESCROW_CONFIRM_DELAY_MS` (default 4s).

**Early payments** (`early-payments.service.ts:requestEarlyPayment()`):
- When `EARLY_PAYMENTS` is **disabled** for the supplier's org: Returns HTTP 403 "Early payments feature is not enabled for your organisation".
- When **enabled** (default): Normal early payment flow proceeds.

**Prisma schema:**
```prisma
model FeatureFlagOverride {
  id             String        @id @default(uuid())
  flag           String
  organisationId String?       @map("organisation_id")
  enabled        Boolean
  createdAt      DateTime      @default(now()) @map("created_at")
  organisation   Organisation? @relation(fields: [organisationId], references: [id])
  @@unique([flag, organisationId])
  @@index([flag])
  @@map("feature_flag_overrides")
}
```

**E2E coverage:** 11 tests in `feature-flags.e2e-spec.ts`:
- 4 flag evaluation tests (default fallback, global override, per-org override, list all flags)
- 5 admin endpoint tests (list all, toggle global, toggle per-org, unknown flag rejection, RBAC)
- 2 guard behaviour tests (EARLY_PAYMENTS disabled blocks, enabled allows)

---

*Generated 14 March 2026. This document reflects the current production codebase (512 tests, 31 suites, all passing). Updated for: (1) SettlementRouterService — centralised settlement routing and fee calculation, extracted from acknowledgeObligation() and dispute resolution; (2) Financial Integrity Checker — 12 invariants, admin endpoint, cron scheduler, frontend card; (3) 2-step escrow funding workflow; (4) IN_PROGRESS → FULFILLMENT rename; (5) strict state machine enforcement; (6) EscrowAccount IBAN field; (7) Idempotent Financial Operations — two-layer idempotency framework with HTTP interceptor + service-level guards, IdempotencyRecord table, 4 protected financial endpoints; (8) Escrow Transaction Journal — EscrowTransaction model, EscrowAccountingService, 3 mutation point integrations, admin statement/verify endpoints, reconciliation enhancement, frontend statement view; (9) Lifecycle Stress Testing — 10-scenario runner, stress orchestrator, 6 race condition E2E tests, npm stress scripts; (10) Feature Flag & Pilot Gating — FeatureFlagService with 4-level cascade resolution, FeatureFlagOverride Prisma model, admin CRUD endpoints, frontend admin page, escrow funding + early payment guards, 11 E2E tests.*
