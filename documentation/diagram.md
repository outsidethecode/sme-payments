# System Architecture — SME Programmable Settlement

> Verified against the actual codebase (March 2026).

---

```text
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js)                       │
│  Buyer / Supplier / LP / Admin — 17 dashboard pages             │
│  i18n (EN/AR), RTL, Passkey auth, Role-based views              │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API LAYER (NestJS)                            │
│                                                                 │
│  JwtAuthGuard · RolesGuard · OnboardingGuard · PasskeyGuard     │
│  OrgStatusGuard · CorrelationIdMiddleware · ThrottlerGuard       │
│  @Idempotent() decorator + IdempotencyInterceptor               │
│  Global prefix: /api                                            │
└────────────────────────────────┬────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────┐  ┌──────────────────────┐  ┌─────────────────────┐
│  IDENTITY &   │  │  GOVERNANCE &        │  │  ORGANISATION &     │
│  AUTH LAYER   │  │  POLICY LAYER        │  │  ONBOARDING LAYER   │
│               │  │                      │  │                     │
│ AuthService   │  │ PoliciesService      │  │ OrganisationsService│
│ PasskeysServ. │  │ PolicyEvaluation-    │  │ DelegationService   │
│ IdentityServ. │  │   Service            │  │ InvitationsService  │
│ UsersService  │  │ PolicyTemplateServ.  │  │ OnboardingService   │
│               │  │ ApprovalsService     │  │ KybService          │
│               │  │ EscalationService    │  │                     │
└───────────────┘  └──────────────────────┘  └─────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  CORE BUSINESS DOMAIN                            │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ PurchaseOrdersService (state machine, ~2200 lines)        │  │
│  │ create → send → approve → accept → fundEscrow →           │  │
│  │ confirmEscrow → ship → deliver → verify → acknowledge →   │  │
│  │ settle                                                     │  │
│  │ Also: counterPropose, reject, dispute, importFromCSV       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ EarlyPaymentsService                                      │  │
│  │ requestEarlyPayment → fund (LP)                            │  │
│  │ + marketplace view                                         │  │
│  │ RiskSnapshotService — buyer risk assessment per PO         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ DisputesService                                            │  │
│  │ raise → submitEvidence → markUnderReview → resolve          │  │
│  │ executeDisputeSettlement — financial resolution             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ PaymentLocksService (read-only view)                       │  │
│  │ Locks created & managed by SettlementService               │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                FINANCIAL / SETTLEMENT LAYER                      │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ SettlementRouterService (the brain of money flow)          │  │
│  │ resolveSettlement()     — decides: pay LP or Supplier      │  │
│  │ resolveDisputeSettlement() — dispute resolution payouts    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ SettlementService                                          │  │
│  │ reserveForPO → confirmLock → settlePO → confirmSettlement  │  │
│  │ transferAdvance (LP early payment)                         │  │
│  │ refundPO · handleBankCallback · reconcile                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ InstrumentService                                          │  │
│  │ create → requestLock → confirmLock → requestSettlement →   │  │
│  │ confirmSettlement                                          │  │
│  │ requestFinancing → confirmFinancing · revertFinancing      │  │
│  │ refund · fail                                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ EscrowAccountingService                                    │  │
│  │ recordDeposit · recordRelease · recordRefund · recordFee   │  │
│  │ getStatement · verifyBalance                               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ReconciliationService (cron)                               │  │
│  │ runReconciliation · getReports · getLatest                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Bank Adapters (strategy pattern)                           │  │
│  │ KSABankTransferAdapter — Al Rajhi / real banking rails     │  │
│  │ SimulatedAdapter       — dev/test mode                     │  │
│  │ Interface: reserveFunds · releaseFunds · transferFunds ·   │  │
│  │            refund · reconcile                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ WebhookController                                          │  │
│  │ bankCallback() — receives bank payment confirmations       │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                 TRUST & AUDIT LAYER                              │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ LedgerService                                              │  │
│  │ logEvent() — append-only hash-chain event log              │  │
│  │ getEvents() · verifyChain()                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ AnchorService + AnchorSchedulerService (cron)              │  │
│  │ createAnchor · getInclusionProof · verifyAnchorChain       │  │
│  │ Merkle tree inclusion proofs                               │  │
│  │ Providers: RekorAnchorProvider (Sigstore) · NoopProvider   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ NodeCryptoService                                          │  │
│  │ SHA-256 (hex/base64/buffer) · ECDSA P-256 signing/verify  │  │
│  │ Platform signing key · MerkleTree · canonicalStringify     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ProofGeneratorService + ProofVerifierService               │  │
│  │ generateProof() · generateEntityProofs()                   │  │
│  │ Resolves signers, credentials, evidence into proof bundles │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ EvidenceService                                            │  │
│  │ upload (SHA-256 hash on ingest) · verifyIntegrity          │  │
│  │ buildEvidencePack() — Trust Envelope generation            │  │
│  │ (PO + events + signatures + reconciliation + actors)       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ VerifyService                                              │  │
│  │ Independent Trust Envelope verifier                        │  │
│  │ Checks: structure, hash chain, payload hashes, intent      │  │
│  │ hashes, challenge, signatures, actors, cross-consistency   │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                 RISK & COMPLIANCE LAYER                          │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ LpRiskService                                              │  │
│  │ calculateExposure · checkFundingEligibility                │  │
│  │ takeSnapshot · getSnapshotHistory                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ FraudControlsService                                       │  │
│  │ checkPOCreation (velocity, duplicates, anomalies)          │  │
│  │ enforceEvidenceRequirement · getFlagsForUser               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ PdpaService                                                │  │
│  │ exportUserData · eraseUserData (right to be forgotten)     │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                 ADMIN & OPERATIONS                               │
│                                                                 │
│  AdminService       — platform stats, escrow account mgmt       │
│  IntegrityService   — cron: verify all financial invariants      │
│  FeatureFlagService — per-org feature flag system                │
│  HealthController   — health-check endpoint                     │
└─────────────────────────────────────────────────────────────────┘
```

---

# Prisma Models (28)

```text
Identity & Auth:     User · UserPasskey · OrgMembership · OrgPermission · OrgDelegation
Organisation:        Organisation · Invitation
Policy & Approval:   PolicyRule · ApprovalRequest · Approval
Core Business:       PurchaseOrder · PORevision · EvidenceAttachment · Dispute · FraudFlag
Financial:           PaymentLock · PaymentInstrument · EarlyPaymentRequest · Settlement
                     EscrowAccount · EscrowTransaction · PlatformFee
Ledger & Trust:      EventLog · LedgerAnchor
Reconciliation:      ReconciliationReport
Risk:                LpExposureSnapshot
Infrastructure:      IdempotencyRecord · FeatureFlagOverride
```

---

# Key Corrections from Prior Diagram

| Prior Diagram Claim | Actual Codebase |
|---------------------|-----------------|
| "FundingMatcher" service | Does not exist. Escrow funding handled by `PurchaseOrdersService.fundEscrow()` + `SettlementService.reserveForPO()` + `confirmLock()` |
| "EscrowAccount" as a single component | `EscrowAccountingService` + `EscrowAccount` model + `EscrowTransaction` model — 3 pieces |
| "EscrowLedger" service | Does not exist. Escrow accounting is `EscrowAccountingService` in settlements module |
| "Bank Integration" as a single box | Strategy pattern: `KSABankTransferAdapter` + `SimulatedAdapter` + `WebhookController` |
| Financial layer listed as "NEW/missing" | Fully implemented: 5 services + 2 adapters + webhook controller |
| No mention of Policy/Approval engine | Full engine: templates, evaluation, multi-party approval with escalation and expiry |
| No mention of Risk layer | `LpRiskService` (exposure) + `FraudControlsService` (velocity/anomaly detection) |
| No mention of Reconciliation | `ReconciliationService` runs on cron, generates reports |
| No mention of Identity/Passkeys | `IdentityService` (Nafath KSA), `PasskeysService` (WebAuthn), guards enforcing both |
| No mention of Cryptography | `NodeCryptoService` — ECDSA P-256, SHA-256, MerkleTree, platform signing key |
| No mention of Anchoring | `AnchorService` + `AnchorSchedulerService` with Sigstore Rekor integration |
| No mention of Idempotency | `@Idempotent()` decorator + `IdempotencyInterceptor` on all financial endpoints |
| No mention of PDPA | `PdpaService` — data export + erasure (right to be forgotten) |
| No mention of Admin/Integrity | `AdminService` + `IntegrityService` (cron financial invariant checker) |
| No mention of Feature Flags | `FeatureFlagService` — per-org feature toggles |
| "SettlementRouter" described as simple | `SettlementRouterService` with `resolveSettlement()` and `resolveDisputeSettlement()` |
| `InstrumentService` not mentioned | Full payment instrument lifecycle: lock, finance, settle, refund |

---

# End-to-End Flow (Accurate)

### 1. PO Created

```text
Buyer -> PurchaseOrdersService.create()
-> LedgerService.logEvent("PO_CREATED")
-> FraudControlsService.checkPOCreation()
```

### 2. Approval (if policy requires)

```text
PolicyEvaluationService.evaluate()
-> ApprovalsService.createRequest()
-> Approver decides -> onApprovalComplete()
```

### 3. Supplier Accepts

```text
PO -> ACCEPTED
-> LedgerService.logEvent("PO_ACCEPTED")
```

### 4. Buyer Funds Escrow

```text
PurchaseOrdersService.fundEscrow()
-> SettlementService.reserveForPO()
-> InstrumentService.requestLock()
-> Bank Adapter.reserveFunds()
```

### 5. Escrow Confirmed

```text
WebhookController.bankCallback()
-> SettlementService.confirmLock()
-> InstrumentService.confirmLock()
-> EscrowAccountingService.recordDeposit()
-> PO -> ESCROW_FUNDED
```

### 6. Fulfillment

```text
markShipped() -> markDelivered() -> verifyDelivery()
Each -> LedgerService.logEvent() + idempotency guard
```

### 7. Optional Early Payment

```text
Supplier -> EarlyPaymentsService.requestEarlyPayment()
-> LpRiskService.checkFundingEligibility()
-> LP -> EarlyPaymentsService.fund()
-> SettlementService.transferAdvance()
-> InstrumentService.requestFinancing()
```

### 8. Settlement

```text
PurchaseOrdersService.acknowledgeObligation()
-> SettlementRouterService.resolveSettlement()
   if EarlyPayment FUNDED -> pay LP
   else -> pay Supplier
-> SettlementService.settlePO()
-> Bank Adapter.transferFunds()
-> EscrowAccountingService.recordRelease()
-> PO -> SETTLED
```

### 9. Dispute Path (alternative)

```text
DisputesService.raise() -> submitEvidence() -> markUnderReview()
-> DisputesService.resolve()
-> SettlementRouterService.resolveDisputeSettlement()
-> executeDisputeSettlement()
```

### 10. Trust Verification

```text
EvidenceService.buildEvidencePack() — Trust Envelope
ProofGeneratorService.generateEntityProofs()
VerifyService — independent verification
AnchorService.createAnchor() — Sigstore Rekor anchoring
```

---

# Architecture Statistics

| Metric | Count |
|--------|-------|
| NestJS Modules | 31 |
| Prisma Models | 28 |
| Service Classes | ~30 |
| Controller Classes | ~20 |
| Guards | 5 (JWT, Roles, Onboarding, Passkey, OrgStatus) |
| Bank Adapters | 2 (KSA Real + Simulated) |
| Cron Jobs | 3 (Reconciliation, Anchoring, Integrity) |
| Frontend Pages | 17 dashboard routes |
| Supported Locales | 2 (English, Arabic + RTL) |
| Unit Test Suites | 27 |
| Unit Tests | 505+ |
