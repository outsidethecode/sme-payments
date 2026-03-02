## North Star for “Production-Adjacent v1”

A v1 that works end-to-end with:

* 1–2 buyers
* 5–20 suppliers
* 1 regulated liquidity partner
* Real purchase orders (or ERP-exported POs)
* Real payment initiation + reconciliation
* Contractual + KYB onboarding
* Auditable evidence packs per transaction

Think “pilot in the wild” rather than “full bank-grade platform.”

---

## Workstream A — Make Purchase Orders Real-World

Your current PO object works for the demo, but real procurement-to-pay requires some additional structure.

### A1) Support common PO formats (lightweight)

Add import/export for one or more:

* **CSV + PDF** (fastest for pilots)
* **UBL** (widely used; also aligns well with PEPPOL ecosystems)
* Optional later: **PEPPOL** integration (powerful, but heavier)

**Why this matters:** Buyers already issue POs in existing systems. Your v1 must *ingest*, not replace, on day one.

### A2) Add minimum commercial fields required in real POs

Add (even if hidden by default in UI):

* PO number (buyer’s native reference)
* Supplier legal entity + registration number
* Buyer legal entity + registration number
* Payment terms (Net30/Net60 etc.)
* Delivery terms (Incoterms optional, domestic can be simple)
* Acceptance window & dispute window
* Tax/VAT fields
* Partial shipment / partial acceptance rules
* Milestones (optional, but your architecture loves them)

### A3) Real approval workflow (not just “PO created/sent”)

Production buyers need:

* Multi-approver thresholds (e.g., >£10k needs 2 approvals)
* Roles: requester vs approver vs finance approver
* Delegation & absence handling
* Policy hooks (basic rules engine)

You already have passkeys—great. Now attach them to *approval roles and policies*.

---

## Workstream B — Verification Events That Match Reality

Today your “delivery marked” is a manual event. For real-world pilots you need “evidence-grade” events.

### B1) Define 2 verification tiers

**Tier 1 (Pilot-ready):**

* Supplier marks “shipped”
* Buyer marks “received/accepted”
* Evidence attachments (PDF, photo, signed delivery note)

**Tier 2 (Stronger):**

* ePOD (electronic proof-of-delivery) integration (from courier/logistics)
* QR scan at receiving dock
* Timestamped evidence pack

### B2) Standardise “Evidence Pack” per event

Each event should generate a verifiable bundle:

* Who signed (passkey credential + org role)
* What they signed (canonical hash of PO + event payload)
* When (timestamp)
* Evidence attachments hash (files stored off-chain/in object store)

This is your “audit evidence pack” productised.

---

## Workstream C — Payment Rails That Work in Production

You don’t need CBDC to be “real.” You need:

* a real payment initiation flow
* reliable reconciliation
* strong auditability

### C1) Buyer payment commitment (v1)

Implement **ring-fencing** in a pragmatic way for pilots:

**Option 1 (Fastest):** Escrow/Client money via a regulated EMI/PSP partner

* Buyer funds a safeguarded account
* Your platform controls conditional release logic (through the partner’s APIs/workflows)

**Option 2 (Good pilot):** Open Banking payment initiation + “virtual escrow”

* Buyer authorises payment initiation
* Funds remain with buyer until trigger; then instant payment is executed
* You’ll need a fallback if buyer lacks funds at trigger time (e.g., reserve requirement or pre-funding)

The goal: make “commitment” economically meaningful.

### C2) Liquidity partner payout (v1)

When funding early payment:

* Liquidity partner pays supplier via bank transfer rails (or the same EMI rails)
* Your system records it as: **advance against conditional settlement commitment**
* On buyer acceptance, buyer payment settles to liquidity partner (and/or to a settlement account that nets everything)

### C3) Reconciliation & settlement ledger

Add a simple but robust reconciliation engine:

* Payment initiated → pending → confirmed
* Reference mapping (PO reference, settlement reference)
* Exception queue (failed payments, mismatch amounts)

---

## Workstream D — Onboarding (This Is Where Pilots Succeed or Die)

Your platform has three onboarding tracks: Buyer, Supplier, Liquidity Partner.

### D1) Buyer onboarding

**What you need from buyers in a pilot:**

* One procurement/finance sponsor
* PO export method (CSV/UBL/API)
* Approval policy (who signs what)
* Funding method (EMI escrow or Open Banking setup)
* Their supplier list (starting cohort)

**Buyer onboarding flow in-product:**

1. Create organisation + verify domain
2. Add approvers + roles
3. Connect PO source (upload / API)
4. Configure settlement policies (acceptance window, disputes)
5. Connect payment rail (sandbox → live)

### D2) Supplier onboarding

Suppliers need the least friction.

Minimum:

* KYB-lite for pilot (company number, director/UBO, bank account)
* Acceptance of platform terms
* Passkey setup + role assignment
* Ability to accept PO, submit events, request early payment

Key product move: **“Invite supplier”** from buyer side with 1-click onboarding.

### D3) Liquidity partner onboarding (regulated partner)

This is the trickiest — and where you must look “real.”

You need:

* A partner profile (funding limits, appetite rules, fee model)
* A funding wallet/account (where they disburse from)
* Risk rules (what they will fund)
* Legal docs: participation agreement + servicing + data sharing

**In-product liquidity partner controls:**

* Eligibility filters: buyer whitelist, supplier whitelist, max tenor, max exposure, concentration limits
* Pricing controls: fee curve by buyer rating / PO attributes / event stage
* Operations: approve funding, view pipeline, dispute handling

---

## Workstream E — Risk, Disputes, and “What if it goes wrong?”

A production-adjacent v1 must handle failure modes.

### E1) Core dispute model

Define:

* Dispute raised by buyer (within acceptance window)
* Evidence submission by supplier
* Resolution workflow (manual arbitration for v1)
* Settlement outcomes: partial accept, reject, rework

### E2) Liquidity partner protection (without haram structures)

You can keep it halal-friendly by structuring as:

* **Service fee** for providing accelerated settlement
* **Fee linked to execution stage** (not time alone)
* Optional: staged advance (e.g., 40% at PO acceptance, 60% at delivery confirmation)

### E3) Fraud controls

* Velocity limits
* Buyer/supplier whitelists for pilot
* Event anomaly detection (e.g., repeated rapid “delivered”)
* Mandatory attachments above thresholds

---

## Workstream F — Production Engineering Hardening

This is where you turn “demo” into “pilot-grade.”

### F1) Identity & access

* Enforce passkeys for approvals + funding actions (already strong)
* Add RBAC per org (requester/approver/finance/admin)
* SCIM later; v1 can be invite-based

### F2) Audit, logging, monitoring

* Immutable event store (append-only)
* Correlation IDs across services
* Central logging + alerting
* “Evidence pack export” button (PDF/JSON bundle)

### F3) Security & compliance baseline

* Secrets management (KMS)
* Encryption at rest (DB + object store)
* Data retention policies
* GDPR basics (DPA templates, delete/export user data)

---

## Workstream G — The Pilot Playbook (Go-to-market execution)

To get real-world usage quickly, design a **single “corridor” pilot**:

### Choose one corridor

Example corridors that are procurement-heavy and dispute-prone:

* Construction subcontractors
* Manufacturing components
* Facilities maintenance
* Wholesale/retail supply

### Pilot structure (clean & credible)

* 1 anchor buyer with 5–20 suppliers
* 1 liquidity partner with capped exposure
* Limit PO sizes and tenor initially (e.g., ≤£25k, ≤60 days)
* Manual dispute resolution during pilot
* Weekly governance call + metrics

### Success metrics (what you report to judges/investors)

* Time-to-settle (acceptance → funds released)
* % POs eligible for early payment
* Liquidity take-up rate
* Dispute rate and resolution time
* Effective cost vs invoice finance baseline

---

## “Next Version” Deliverables Checklist (Production-Adjacent v1)

If you deliver *only* these, you have a real pilot product:

1. **PO import** (CSV + PDF) + canonical PO schema
2. **Multi-approver workflow** with passkeys
3. **Evidence pack** generation and export
4. **Payment rail integration** (EMI escrow or Open Banking initiation)
5. **Early payment funding** with liquidity partner controls
6. **Reconciliation engine** + exception handling queue
7. **Disputes workflow** (simple but real)
8. **KYB-lite onboarding** for buyer/supplier + partner onboarding pack
9. **Operational monitoring + audit logs**

---

## Practical Recommendation: The Fastest “Real” Path

If your goal is to be usable in production **as fast as possible**, choose:

* **EMI/PSP safeguarded account** approach for commitments + settlement
  Because it makes the “payment commitment” real without relying on buyer’s future cash availability.

Then:

* Keep delivery verification simple (attachments + passkey signatures)
* Keep disputes manual for v1
* Keep eligibility constrained (whitelists)

This gets you to a credible live pilot without needing CBDC.

---

If you want, I can turn this into:

* A **2-page internal execution plan** (workstreams, epics, acceptance criteria)
* A **partner onboarding pack** outline for liquidity providers (commercial + technical + legal)
* A **real-world PO schema** (JSON + DB tables) that matches what buyers actually have

Tell me which format you want first, and I’ll produce it in a shareable doc style.
