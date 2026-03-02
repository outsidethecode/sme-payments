# KSA Pilot — Phased Implementation Plan

## What exists today (MVP baseline)

The current system is a **working demo** with a complete PO lifecycle, simulated escrow via balance management, early payment with ujrah fees, SHA-256 hash-chained ledger with passkey-bound signatures, and 4 fixed roles. Everything runs on a single-tenant model with hardcoded UK assumptions (GBP, flat fee rates, no KYB, no real payment rails).

## What the KSA pilot needs (derived from all 3 strategy docs)

A system where **real buyers, suppliers, and a liquidity partner** can onboard securely, transact on real POs, have policy-driven approvals, and settle through KSA bank rails — all with Sharia-aligned structures and auditable evidence.

---

## Phase 0 — Multi-Tenancy Foundation & Governance Model

**Goal:** Transform from single-tenant/flat roles to organisation-based structure with RBAC

| Item | What to build | Why |
|------|--------------|-----|
| **Organisation model** | New `Organisation` entity with type (BUYER/SUPPLIER/LP), jurisdiction (UK/KSA), currency config | Every actor document calls for per-org configuration |
| **RBAC within orgs** | Roles within an org: `OWNER`, `APPROVER`, `FINANCE`, `MEMBER`. Users belong to an org with an org-level role | Buyers need requester/approver/finance-approver chains. LPs need operator roles |
| **Admin onboarding for LP/ADMIN** | Registration endpoints for LP and ADMIN (currently seed-only) | Can't onboard real actors without it |
| **Jurisdiction config** | Currency, tax model, Sharia-compliance flag per org | KSA needs SAR, no VAT (for now), Sharia flag on |
| **DB migration** | Organisation table, OrgMembership table, update User to reference org | Foundation for everything else |

**Key decisions needed before building:**

1. Should users be able to belong to multiple organisations?
2. What's the initial KSA org structure — 1 anchor buyer, N suppliers, 1 LP?

---

## Phase 1 — Policy Engine & Approval Workflows

**Goal:** Replace hardcoded logic with configurable policies per organisation

| Item | What to build | Why |
|------|--------------|-----|
| **Policy service** | `PolicyRule` model: event type, threshold conditions, required approvals, auto/manual flags | three_actors_and_policies: "Never hardcode approval counts, funding eligibility, exposure limits" |
| **Buyer approval thresholds** | Configurable: PO <= X → 1 approver, PO > X → 2 approvers, PO > Y → finance + CFO | Buyers need this for internal governance |
| **Multi-signature approval chain** | `ApprovalRequest` model tracking who needs to sign, who has signed, escalation timer | Each approval step is passkey-signed (already have the infra) |
| **LP funding rules** | Configurable per LP: max exposure per buyer, per supplier, max tenor, whitelist filters, fee curve | three_actors_and_policies: "If you don't build this, banks won't onboard" |
| **LP exposure dashboard** | Real-time view: total deployed, concentration by buyer/supplier, tenor distribution | LPs need risk visibility to participate |

**Key decisions needed before building:**

1. What are the initial threshold tiers for the KSA pilot buyer?
2. What exposure limits does the LP want?
3. Should escalation go to platform admin or org-level backup?

---

## Phase 2 — Secure Actor Onboarding

**Goal:** Production-grade onboarding for all three actor types

| Item | What to build | Why |
|------|--------------|-----|
| **Buyer onboarding flow** | Org creation → KYB-lite (CR number, authorized signatory) → connect payment method → set approval policies → invite team members | next-streams-pilot Workstream D1 |
| **Supplier tiered onboarding** | **Tier 1** (basic): CR number + bank IBAN + platform terms + passkey → can receive POs. **Tier 2** (liquidity-eligible): KYB verification + sanctions check + UBO disclosure → can request early payment | three_actors_and_policies: "Only suppliers who request early payment go through Tier 2" |
| **LP onboarding** | Partner profile + funding limits + risk appetite config + participation agreement acceptance + funding account setup | three_actors_and_policies: mandatory for bank onboarding |
| **Invite flow** | Buyer invites suppliers with 1-click link; LP invited by platform admin | next-streams-pilot: "Invite supplier from buyer side with 1-click onboarding" |
| **KYB integration point** | Abstract interface for KYB provider (Wathq for KSA CR validation initially) | settlement_rails: pluggable design principle |

**Key decisions needed before building:**

1. Which KYB provider for KSA? (Wathq API for CR validation? Or manual for pilot?)
2. What sanctions screening service? (Manual for v1 pilot?)
3. What's the legal entity structure — are you licensed or operating under a partner's license?

---

## Phase 3 — Settlement Adapter Layer (KSA Rails)

**Goal:** Replace simulated balance system with pluggable settlement that works for KSA

| Item | What to build | Why |
|------|--------------|-----|
| **SettlementAdapter interface** | Abstract: `reserveFunds()`, `releaseFunds()`, `transferFunds()`, `refund()`, `reconcile()` | settlement_rails: "Separate settlement from logic" — one interface, many adapters |
| **SimulatedAdapter** (keep current) | Wraps existing balance logic behind the interface | Keeps demo mode working |
| **KSABankTransferAdapter** | Integration with KSA bank rails — likely via a partner bank API or SARIE for larger amounts | settlement_rails: KSA uses direct bank integration |
| **Commitment model** | Buyer pre-funds settlement account (or bank guarantees commitment) — replaces the current "debit balance" approach | settlement_rails: "make commitment economically meaningful" |
| **Reconciliation engine** | Payment initiated → pending → confirmed. Reference mapping. Exception queue for mismatches | next-streams-pilot Workstream C3 |
| **Currency support** | SAR as primary for KSA pilot. Amount fields remain in smallest unit (halalah = 1/100 SAR) | settlement_rails: "Do not hardcode GBP assumptions" |

**Key decisions needed before building:**

1. Which bank partner in KSA? (Or start with simulated + manual bank transfers for pilot?)
2. Pre-funding model or bank guarantee model for buyer commitment?
3. Is SARIE access direct or via the partner bank?

---

## Phase 4 — Real-World PO & Evidence System

**Goal:** Make POs and events production-grade

| Item | What to build | Why |
|------|--------------|-----|
| **Extended PO schema** | Add: native PO number, payment terms (Net30/60), delivery terms, acceptance window, dispute window, tax fields, partial acceptance rules | next-streams-pilot Workstream A2 |
| **PO import** | CSV upload + PDF attachment. Buyer uploads from their ERP/procurement system | next-streams-pilot: "Buyers already issue POs in existing systems. Your v1 must ingest, not replace" |
| **Evidence attachments** | File upload (delivery note PDF, photo, signed receipt) stored in object storage, hash included in ledger event | next-streams-pilot Workstream B2 |
| **Evidence pack export** | Per-PO downloadable bundle: all events + signatures + attachments + hash verification | next-streams-pilot: "audit evidence pack productised" |
| **Verification tiers** | Tier 1: supplier marks shipped / buyer marks received with attachments. Tier 2 (later): ePOD integration | next-streams-pilot Workstream B1 |

**Key decisions needed before building:**

1. Object storage provider? (S3-compatible? Local for pilot?)
2. What PO format do the KSA pilot buyer(s) currently export?
3. What evidence format is acceptable for the LP? (PDF + hash sufficient?)

---

## Phase 5 — Dispute Resolution & Risk Controls

**Goal:** Handle failure modes so the system is trustworthy

| Item | What to build | Why |
|------|--------------|-----|
| **Dispute workflow** | Dispute raised → evidence submission (both sides) → manual resolution by platform admin for v1 → outcomes: partial accept, reject, rework | next-streams-pilot Workstream E1: currently DISPUTED is a dead-end |
| **Dispute settlement** | Refund to buyer, partial release, or rework instructions — all logged in ledger | Completes the PO lifecycle |
| **Fraud controls** | Velocity limits, whitelist enforcement, mandatory attachments above thresholds | next-streams-pilot Workstream E3 |
| **LP risk service** | Real-time exposure tracking, concentration alerts, automatic funding suspension if limits breached | three_actors_and_policies: "Risk Service" |

**Key decisions needed before building:**

1. Who arbitrates disputes in the KSA pilot? (Platform admin? Third party?)
2. What are the initial velocity limits?
3. Should LP auto-fund or always manually approve during pilot?

---

## Phase 6 — Production Hardening

**Goal:** Make it safe to run with real money and real users

| Item | What to build | Why |
|------|--------------|-----|
| **Move challenge store to Redis** | Replace in-memory Map for WebAuthn challenges | Currently lost on restart |
| **Secrets management** | Env vars → KMS/Vault for JWT_SECRET, DB credentials | next-streams-pilot F3 |
| **Correlation IDs** | Request-scoped IDs across all service calls and logs | next-streams-pilot F2 |
| **Rate limiting & input hardening** | Throttle auth endpoints, validate all inputs | Production security baseline |
| **Monitoring & alerting** | Structured logging, health endpoints, uptime monitoring | next-streams-pilot F2 |
| **Data retention & PDPA** | KSA Personal Data Protection law compliance — consent, export, deletion | Regulatory requirement |

---

## Phase Dependency Graph

```
Phase 0 (Foundation)
  └──> Phase 1 (Policies)
        └──> Phase 2 (Onboarding)
              └──> Phase 3 (Settlement Rails)
                    └──> Phase 4 (PO & Evidence)
                          └──> Phase 5 (Disputes & Risk)
  Phase 6 (Hardening) runs in parallel from Phase 2 onward
```

---

## Recommended Build Order for KSA Pilot

| Week | Phase | What you get |
|------|-------|-------------|
| 1–2 | **Phase 0** | Orgs, RBAC, jurisdiction, currency — system is multi-tenant |
| 3–4 | **Phase 1** | Policy engine, approval chains, LP exposure controls — governance works |
| 5–6 | **Phase 2** | All three actors can self-onboard securely — system is usable |
| 7–8 | **Phase 3** | Real (or semi-real) settlement in SAR — money moves |
| 9–10 | **Phase 4** | PO import, evidence packs — transactions are auditable |
| 11–12 | **Phase 5 + 6** | Disputes, risk controls, hardening — system is trustworthy |

**At week 6** you can start a controlled pilot with simulated settlement.
**At week 8** you can run with real bank rails.
