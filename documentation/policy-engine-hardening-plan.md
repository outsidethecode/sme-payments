# Policy Engine & Organisation Governance Hardening Plan

**Created:** 14 March 2026
**Status:** Planning
**Baseline:** 512 tests · 31 suites · v2.9

---

## Executive Summary

The platform already has a **functional foundation**: `PolicyRule` / `ApprovalRequest` / `Approval` models, three rule types (`PO_APPROVAL`, `PO_ORDER_LIMITS`, `FUNDING_LIMIT`), a working approval flow for PO sends (with `PENDING_APPROVAL` state), LP exposure evaluation, fraud velocity controls, and role-based org memberships (`OWNER` / `APPROVER` / `FINANCE` / `MEMBER`). E2E tests cover auto-approve, manual approval, rejection, and LP exposure.

This plan **hardens and extends** the existing system into a bank-grade policy engine that covers **all state machine transitions**, enforces **organisation-level governance**, and supports flexible **multi-party approval chains** for buyers, suppliers, and liquidity providers.

---

## Gap Analysis — What Exists vs. What's Needed

### ✅ Already Built

| Capability | Where |
|---|---|
| `PolicyRule` model with conditions JSON, priority, requiredApprovals, requiredRoles | `schema.prisma` |
| 3 rule types: `PO_APPROVAL`, `PO_ORDER_LIMITS`, `FUNDING_LIMIT` | `PoliciesService` |
| PO approval flow: `send()` → evaluatePOApproval → park in `PENDING_APPROVAL` → vote → callback to `onApprovalComplete()` | `PurchaseOrdersService`, `ApprovalsService`, `ApprovalsController` |
| Multi-vote counting with `requiredApprovals` threshold | `ApprovalsService.submitDecision()` |
| OrgRole-based vote authorisation (`requiredRoles` check) | `ApprovalsService.submitDecision()` |
| LP funding limit evaluation (total exposure, buyer/supplier concentration, whitelist) | `PoliciesService.evaluateLPFunding()` |
| Fraud velocity controls (buyer/supplier daily limits) | `FraudControlsService` |
| LP risk monitoring (concentration, auto-suspend at 95%) | `LpRiskService` |
| Organisation memberships: `OWNER`, `APPROVER`, `FINANCE`, `MEMBER` | `OrgMembership` model |
| Invitation system (buyer→supplier, admin→LP) | `InvitationsService` |
| Onboarding pipeline per org type (KYB, IBAN, tiers) | `OnboardingService` |
| Frontend: Approvals queue, Invitations page, Onboarding wizard, Risk controls | Dashboard pages |
| Seeded tiered rules for UK buyer (auto-approve ≤£10k, 1 approver £10k–£50k, 2 approvers >£50k) | `seed.ts` |

### ❌ Gaps to Close

| # | Gap | Impact |
|---|---|---|
| G1 | **Only PO send** triggers policy evaluation — no other state transitions (escrow funding, delivery verification, settlement acknowledgement, early payment request, LP funding, dispute resolution) are gated | Any team member can trigger high-value financial actions without oversight |
| G2 | **Actor checks are hardcoded** per method (`po.buyerId !== actorId`) — no centralised "who can do what" layer | Cannot configure per-org delegation (e.g. FINANCE can fund escrow, APPROVER can verify delivery) |
| G3 | **Org status not enforced** — `PENDING`/`SUSPENDED` orgs can still create POs, fund escrow, etc. | Suspended orgs can continue trading |
| G4 | **KYB/onboarding status not enforced** — `NOT_STARTED` or `KYB_PENDING` orgs can trade | Unverified entities can transact |
| G5 | **No permission matrix** — OrgRole grants static permissions, but there's no configurable mapping of `OrgRole × Action → allowed` | Cannot tailor who does what within each org type |
| G6 | **Supplier-side approvals don't exist** — supplier acceptance, shipping, and delivery are single-actor operations | Large suppliers need internal approvals before accepting £200k POs |
| G7 | **LP funding has no approval workflow** — only programmatic exposure checks, no human approval gate for large fundings | LP risk committee cannot review before committing capital |
| G8 | **No escalation mechanism** — `escalateAfter` field exists on `ApprovalRequest` but nothing reads it | Stale approval requests sit forever; no auto-escalation to senior roles |
| G9 | **Settlement acknowledgement ungated** — buyer's `acknowledgeObligation()` triggers settlement without any approval for large amounts | £250k settlement happens with a single click |
| G10 | **No audit trail for policy changes** — CRUD on PolicyRule has no ledger events | Cannot track who changed approval thresholds |
| G11 | **Approval callback only wired for PO** — `ApprovalsController.decide()` only handles `entityType === "PURCHASE_ORDER"` | Cannot reuse approval system for early payments, LP funding, settlements |
| G12 | **No delegation / proxy voting** — if an APPROVER is away, no one else can approve | Operational bottleneck during holidays |

---

## Architecture Design

### Core Principles

1. **Declarative Policy Rules** — What needs approval, under what conditions, by whom, how many
2. **Generic Approval Engine** — Entity-type-agnostic: works for POs, early payments, LP fundings, settlements, dispute resolutions
3. **Org-Scoped Governance** — Each org configures its own rules; platform provides sensible defaults
4. **Defence-in-Depth** — Policies are *additional* checks; existing actor/state guards remain as hard constraints
5. **Action-Level Granularity** — Policy evaluation happens at individual state transition level, not just entity level
6. **Auditable** — Every policy evaluation, approval vote, escalation, and policy change is logged to the ledger

### Extended Policy Rule Types

```
enum PolicyRuleType {
  // ── Existing ──
  PO_APPROVAL           // Buyer sending PO
  PO_ORDER_LIMITS       // Min/max PO amounts
  FUNDING_LIMIT         // LP exposure limits

  // ── New ──
  ESCROW_FUNDING        // Buyer funding escrow (high-value gate)
  SUPPLIER_ACCEPTANCE   // Supplier accepting PO (internal supplier approval)
  SETTLEMENT            // Buyer acknowledging obligation / triggering settlement
  EARLY_PAYMENT         // Supplier requesting early payment
  LP_FUNDING            // LP committing capital to early payment
  DISPUTE_RESOLUTION    // Admin resolving dispute
  DELIVERY_VERIFICATION // Buyer verifying delivery
}
```

### Extended Permission Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    Organisation Governance                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   BUYER Org  │  │ SUPPLIER Org │  │   LP Org     │          │
│  │              │  │              │  │              │          │
│  │ OWNER        │  │ OWNER        │  │ OWNER        │          │
│  │ APPROVER     │  │ APPROVER     │  │ APPROVER     │          │
│  │ FINANCE      │  │ FINANCE      │  │ FINANCE      │          │
│  │ MEMBER       │  │ MEMBER       │  │ MEMBER       │          │
│  │ VIEWER  ←new │  │ VIEWER  ←new │  │ VIEWER  ←new │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│  ┌──────▼─────────────────▼─────────────────▼───────────┐      │
│  │              Permission Matrix (per org)              │      │
│  │                                                       │      │
│  │  Action              Allowed OrgRoles     Overridable │      │
│  │  ─────────────────   ─────────────────    ────────── │      │
│  │  CREATE_PO           OWNER,FINANCE        ✓          │      │
│  │  SEND_PO             OWNER,FINANCE        ✓          │      │
│  │  FUND_ESCROW         OWNER,FINANCE        ✓          │      │
│  │  ACCEPT_PO           OWNER,APPROVER       ✓          │      │
│  │  SHIP_ORDER          OWNER,MEMBER         ✓          │      │
│  │  VERIFY_DELIVERY     OWNER,FINANCE        ✓          │      │
│  │  SETTLE_PO           OWNER,FINANCE        ✓          │      │
│  │  REQUEST_EARLY_PAY   OWNER,FINANCE        ✓          │      │
│  │  FUND_EARLY_PAY      OWNER,APPROVER       ✓          │      │
│  │  RAISE_DISPUTE       OWNER,FINANCE        ✓          │      │
│  │  VOTE_APPROVAL       APPROVER,FINANCE     ✓          │      │
│  │  MANAGE_MEMBERS      OWNER                ✗          │      │
│  │  MANAGE_POLICIES     OWNER,ADMIN          ✗          │      │
│  │  VIEW_ONLY           ALL                  ✗          │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                 │
│  ┌───────────────────────────────────────────────────────┐      │
│  │              Policy Evaluation Pipeline                │      │
│  │                                                       │      │
│  │  1. Org Status Gate    (ACTIVE required)              │      │
│  │  2. KYB/Onboarding Gate (COMPLETED required)          │      │
│  │  3. Permission Check   (OrgRole × Action matrix)      │      │
│  │  4. Policy Rule Match  (conditions, priority-ordered)  │      │
│  │  5. Fraud Check        (velocity, evidence threshold)  │      │
│  │  6. Approval Decision  (auto/manual/skip)             │      │
│  │                                                       │      │
│  │  Result: PROCEED | PARK_FOR_APPROVAL | DENY           │      │
│  └───────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### Generic Approval Callback System

Current problem: `ApprovalsController.decide()` has a hardcoded `if entityType === "PURCHASE_ORDER"` callback. We need a registry pattern:

```
ApprovalCallbackRegistry
  ├─ PURCHASE_ORDER   → poService.onApprovalComplete(entityId, approvedBy)
  ├─ ESCROW_FUNDING   → poService.onEscrowFundingApproved(entityId, approvedBy)
  ├─ EARLY_PAYMENT    → earlyPayService.onEarlyPayApproved(entityId, approvedBy)
  ├─ LP_FUNDING       → earlyPayService.onLPFundingApproved(entityId, approvedBy)
  ├─ SETTLEMENT       → poService.onSettlementApproved(entityId, approvedBy)
  └─ DISPUTE_RESOLUTION → disputesService.onResolutionApproved(entityId, approvedBy)
```

### Escalation Engine

```
Cron: every 15 minutes
  → Find ApprovalRequests where escalateAfter < now() AND status = PENDING
  → For each:
    1. Update status → ESCALATED
    2. Widen requiredRoles (e.g. add OWNER if only APPROVER was required)
    3. Log APPROVAL_ESCALATED to ledger
    4. (Future: send notification)
```

### Delegation Model

```
OrgDelegation (new model)
  ├─ organisationId
  ├─ delegatorUserId     (the person delegating)
  ├─ delegateUserId      (the person receiving authority)
  ├─ actions             (String[] — which actions are delegated)
  ├─ validFrom / validTo (time-bounded)
  └─ active
```

---

## Implementation Phases

### Phase 7: Policy Engine Foundation (Transition-Level Gating)

**Goal:** Extend the policy engine to evaluate **any state transition**, not just PO send. Centralise the evaluation pipeline. Add org status + KYB enforcement.

---

#### 7.1 — Extend PolicyRuleType enum

Add new rule types to the Prisma schema:

```prisma
enum PolicyRuleType {
  PO_APPROVAL
  PO_ORDER_LIMITS
  FUNDING_LIMIT
  ESCROW_FUNDING        // NEW
  SUPPLIER_ACCEPTANCE   // NEW
  SETTLEMENT            // NEW
  EARLY_PAYMENT         // NEW
  LP_FUNDING            // NEW
  DISPUTE_RESOLUTION    // NEW
  DELIVERY_VERIFICATION // NEW
}
```

**Migration:** Alter enum, no data migration needed (new values only).

---

#### 7.2 — Create PolicyEvaluationService (centralised pipeline)

New file: `backend/src/policies/policy-evaluation.service.ts`

Single method: `evaluate(input: PolicyEvaluationInput): Promise<PolicyDecision>`

```typescript
interface PolicyEvaluationInput {
  action: PolicyRuleType;          // Which transition
  organisationId: string;          // The acting org
  actorUserId: string;             // Who is doing it
  actorOrgRole: OrgRole;           // Their role in the org
  entityType: string;              // PURCHASE_ORDER, EARLY_PAYMENT, etc.
  entityId: string;                // The entity being acted on
  amountMinorUnits?: number;       // For amount-based conditions
  currency?: string;               // For currency-scoped rules
  metadata?: Record<string, any>;  // Extra context for conditions
}

interface PolicyDecision {
  allowed: boolean;                // Can proceed?
  requiresApproval: boolean;       // Needs votes first?
  autoApprove: boolean;            // Auto-approved by rule?
  reason?: string;                 // Why denied
  matchedRule?: { id; name };      // Which policy matched
  requiredApprovals?: number;      // How many votes needed
  requiredRoles?: string[];        // Which roles can vote
  approvalRequestId?: string;      // Created if parked
  gates: {                         // Which gates passed/failed
    orgStatus: 'PASS' | 'FAIL';
    kybStatus: 'PASS' | 'FAIL' | 'SKIP';
    permission: 'PASS' | 'FAIL';
    policy: 'PASS' | 'FAIL' | 'APPROVAL_REQUIRED' | 'NO_RULE';
    fraud: 'PASS' | 'FAIL' | 'SKIP';
  };
}
```

Pipeline steps:
1. **Org Status Gate** — Org must be `ACTIVE`. `PENDING`/`SUSPENDED` → deny.
2. **KYB Gate** — For financial actions (ESCROW_FUNDING, SETTLEMENT, LP_FUNDING, EARLY_PAYMENT): org `onboardingStatus` must be `COMPLETED`. Non-financial actions (PO_APPROVAL, SUPPLIER_ACCEPTANCE): skip.
3. **Permission Check** — Look up org's permission overrides; fall back to platform defaults. Verify actor's `OrgRole` is in the allowed set for this action type.
4. **Policy Rule Match** — Query `PolicyRule` for org + ruleType, priority desc, first match on conditions.
5. **Fraud Check** — For PO creation/funding: delegate to existing `FraudControlsService`.
6. **Approval Decision** — If rule says `autoApprove` → allow. If `requiredApprovals > 0` → create `ApprovalRequest`, return `requiresApproval: true`. If no rule → allow (default permissive for backward compat).

All evaluations logged to ledger as `POLICY_EVALUATION` event.

---

#### 7.3 — Org Status enforcement guard

New file: `backend/src/organisations/org-status.guard.ts`

NestJS guard that runs **before** RolesGuard. Checks `req.user.organisationId` → org status must be `ACTIVE`. Rejects with 403 + clear message for `PENDING`/`SUSPENDED` orgs.

Configurable via decorator: `@RequireActiveOrg()` — applied to all financial endpoints. Admin endpoints skip this check.

---

#### 7.4 — KYB/onboarding enforcement

Add to `PolicyEvaluationService` pipeline (step 2). For the following actions, org `onboardingStatus` must be `COMPLETED`:
- `ESCROW_FUNDING`, `SETTLEMENT`, `EARLY_PAYMENT`, `LP_FUNDING`
Optional per org type:
- Buyer: must have `KYB_VERIFIED` or `COMPLETED`
- Supplier: must have `supplierTier` set (at least `BASIC`)
- LP: must have `fundingLimitTotal` set + `participationAgreementAcceptedAt` non-null

---

#### 7.5 — Wire PolicyEvaluationService into existing transitions

For each transition, add policy evaluation call. The pattern:

```typescript
// In any service method that transitions state:
const decision = await this.policyEval.evaluate({
  action: PolicyRuleType.ESCROW_FUNDING,
  organisationId: buyerOrg.id,
  actorUserId: actorId,
  actorOrgRole: membership.orgRole,
  entityType: 'PURCHASE_ORDER',
  entityId: poId,
  amountMinorUnits: po.totalAmountMinorUnits,
  currency: po.currency,
});

if (!decision.allowed && !decision.requiresApproval) {
  throw new ForbiddenException(decision.reason);
}

if (decision.requiresApproval && !decision.autoApprove) {
  // Park entity in a "pending approval" state
  // Return the approval request to the caller
  return { status: 'PENDING_APPROVAL', approvalRequestId: decision.approvalRequestId };
}

// Proceed with the transition...
```

**Transitions to gate (with their policy rule type):**

| Service Method | PolicyRuleType | Actor Org | Notes |
|---|---|---|---|
| `PO.send()` | `PO_APPROVAL` | Buyer org | **Already done** — refactor to use `PolicyEvaluationService` |
| `PO.fundEscrow()` | `ESCROW_FUNDING` | Buyer org | Gate large escrow fundings |
| `PO.accept()` | `SUPPLIER_ACCEPTANCE` | Supplier org | Gate large PO acceptance |
| `PO.verifyDelivery()` | `DELIVERY_VERIFICATION` | Buyer org | Gate verification for high-value POs |
| `PO.acknowledgeObligation()` | `SETTLEMENT` | Buyer org | Gate settlement trigger |
| `EarlyPay.requestEarlyPayment()` | `EARLY_PAYMENT` | Supplier org | Gate early payment requests |
| `EarlyPay.fund()` | `LP_FUNDING` | LP org | Gate LP capital commitment |
| `Disputes.resolve()` | `DISPUTE_RESOLUTION` | Platform (admin) | Gate dispute resolution for large refunds |

---

#### 7.6 — Generic approval callback registry

New file: `backend/src/approvals/approval-callback.registry.ts`

```typescript
@Injectable()
export class ApprovalCallbackRegistry {
  private callbacks = new Map<string, (entityId: string, approvedBy: string) => Promise<void>>();

  register(entityType: string, callback: Function) { ... }
  
  async onApproved(entityType: string, entityId: string, approvedBy: string) {
    const cb = this.callbacks.get(entityType);
    if (cb) await cb(entityId, approvedBy);
  }
}
```

Each service registers its callback during `onModuleInit()`:
- `PurchaseOrdersService` → `PURCHASE_ORDER`, `ESCROW_FUNDING`, `SETTLEMENT`, `DELIVERY_VERIFICATION`, `SUPPLIER_ACCEPTANCE`
- `EarlyPaymentsService` → `EARLY_PAYMENT`, `LP_FUNDING`
- `DisputesService` → `DISPUTE_RESOLUTION`

`ApprovalsController.decide()` delegates to registry instead of hardcoded switch.

---

#### 7.7 — Pending states for new gated transitions

Add `PENDING_ESCROW_APPROVAL` and `PENDING_SETTLEMENT_APPROVAL` to PO status enum? **No** — this would pollute the state machine. Instead:

**Approach: Approval overlay** — The entity stays in its current state. The `ApprovalRequest` acts as a soft lock. The service method checks for a pending approval before allowing the action:

```typescript
// Before any gated action:
const pendingApproval = await this.approvals.findPendingForAction(entityType, entityId, action);
if (pendingApproval) {
  throw new ConflictException('This action is pending approval');
}
```

When approved, the callback re-invokes the original action with a `bypassPolicy: true` flag (internal-only, not from HTTP).

---

#### 7.8 — Policy evaluation ledger events

Every call to `PolicyEvaluationService.evaluate()` logs:

```typescript
{
  entityType, entityId,
  eventType: 'POLICY_EVALUATION',
  actorId, actorRole,
  payload: {
    action: ruleType,
    decision: 'ALLOWED' | 'DENIED' | 'APPROVAL_REQUIRED',
    gates: { orgStatus, kybStatus, permission, policy, fraud },
    matchedRule: { id, name } | null,
    reason: string | null,
  }
}
```

---

#### 7.9 — Policy change audit trail

Wrap `PoliciesService` CRUD methods with ledger events:

| Operation | Event Type |
|---|---|
| `create()` | `POLICY_RULE_CREATED` |
| `update()` | `POLICY_RULE_UPDATED` (with before/after diff) |
| `delete()` | `POLICY_RULE_DEACTIVATED` |

---

#### 7.10 — Unit + E2E tests for Phase 7

- **Unit tests** for `PolicyEvaluationService`:
  - Org status gate: ACTIVE passes, SUSPENDED denied, PENDING denied
  - KYB gate: COMPLETED passes, NOT_STARTED denied for financial actions, skipped for non-financial
  - Permission check: correct OrgRole passes, wrong role denied
  - Policy rule matching: first-match by priority, amount range conditions
  - No-rule default: allowed (backward compat)
  - Ledger event logged for every evaluation

- **E2E tests**:
  - Escrow funding approval: large escrow funding requires FINANCE approval
  - Supplier acceptance approval: large PO acceptance needs supplier APPROVER
  - Settlement approval: high-value settlement needs 2 approvers
  - Suspended org cannot create PO or fund escrow
  - Incomplete onboarding org cannot fund escrow
  - Policy change creates ledger event

---

### Phase 8: Permission Matrix & Role Governance

**Goal:** Implement configurable permission matrices per org, the `VIEWER` role, delegation, and escalation.

---

#### 8.1 — Add VIEWER to OrgRole enum

```prisma
enum OrgRole { OWNER, APPROVER, FINANCE, MEMBER, VIEWER }
```

`VIEWER` can see data but cannot trigger any state transitions.

---

#### 8.2 — OrgPermission model

New Prisma model for per-org permission overrides:

```prisma
model OrgPermission {
  id              String    @id @default(uuid())
  organisationId  String    @map("organisation_id")
  organisation    Organisation @relation(fields: [organisationId], references: [id])
  action          String    // e.g. "CREATE_PO", "FUND_ESCROW", "ACCEPT_PO"
  allowedRoles    String[]  // OrgRole values that may perform this action
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@unique([organisationId, action])
  @@map("org_permissions")
}
```

`PolicyEvaluationService` step 3 checks this table. If no override → use platform defaults.

**Default permission matrix** (hardcoded, overridable per org):

| Action | BUYER Org Defaults | SUPPLIER Org Defaults | LP Org Defaults |
|---|---|---|---|
| `CREATE_PO` | OWNER, FINANCE, MEMBER | — | — |
| `SEND_PO` | OWNER, FINANCE | — | — |
| `FUND_ESCROW` | OWNER, FINANCE | — | — |
| `VERIFY_DELIVERY` | OWNER, FINANCE | — | — |
| `SETTLE_PO` | OWNER, FINANCE | — | — |
| `RAISE_DISPUTE` | OWNER, FINANCE, APPROVER | — | — |
| `ACCEPT_PO` | — | OWNER, APPROVER, FINANCE | — |
| `REJECT_PO` | — | OWNER, APPROVER | — |
| `SHIP_ORDER` | — | OWNER, MEMBER | — |
| `MARK_DELIVERED` | — | OWNER, MEMBER | — |
| `REQUEST_EARLY_PAY` | — | OWNER, FINANCE | — |
| `FUND_EARLY_PAY` | — | — | OWNER, APPROVER, FINANCE |
| `MANAGE_MEMBERS` | OWNER | OWNER | OWNER |
| `MANAGE_POLICIES` | OWNER | OWNER | OWNER |

---

#### 8.3 — Permission management endpoints

```
GET  /organisations/:id/permissions       — List (OWNER or ADMIN)
PUT  /organisations/:id/permissions/:action — Set allowed roles (OWNER or ADMIN)
DELETE /organisations/:id/permissions/:action — Reset to platform default (OWNER or ADMIN)
```

Ledger events: `ORG_PERMISSION_UPDATED`, `ORG_PERMISSION_RESET`.

---

#### 8.4 — OrgDelegation model

```prisma
model OrgDelegation {
  id              String    @id @default(uuid())
  organisationId  String    @map("organisation_id")
  organisation    Organisation @relation(fields: [organisationId], references: [id])
  delegatorUserId String    @map("delegator_user_id")
  delegator       User      @relation("delegationsGiven", fields: [delegatorUserId], references: [id])
  delegateUserId  String    @map("delegate_user_id")
  delegate        User      @relation("delegationsReceived", fields: [delegateUserId], references: [id])
  actions         String[]  // Actions delegated (e.g. ["VOTE_APPROVAL", "FUND_ESCROW"])
  validFrom       DateTime  @default(now()) @map("valid_from")
  validTo         DateTime  @map("valid_to")
  active          Boolean   @default(true)
  createdAt       DateTime  @default(now()) @map("created_at")

  @@index([organisationId])
  @@index([delegateUserId])
  @@map("org_delegations")
}
```

---

#### 8.5 — Delegation service

`backend/src/organisations/delegation.service.ts`

- `delegate(orgId, delegatorId, delegateId, actions, validTo)` — Create delegation. Validates both users in same org, delegator has the actions being delegated.
- `revoke(delegationId, revokerId)` — Soft-revoke.
- `getActiveDelegations(userId)` — Delegations received by a user that are currently valid.
- `canActAs(userId, action)` — Returns true if user has an active delegation for this action.

Integration: `PolicyEvaluationService` step 3 also checks delegations — if user's own `OrgRole` lacks permission, check if they have an active delegation for the action.

---

#### 8.6 — Escalation engine

New file: `backend/src/approvals/escalation.service.ts`

```typescript
@Injectable()
export class EscalationService {
  @Cron(CronExpression.EVERY_10_MINUTES)
  async processEscalations() {
    const overdue = await this.prisma.approvalRequest.findMany({
      where: {
        status: 'PENDING',
        escalateAfter: { lt: new Date() },
      },
      include: { policyRule: true },
    });

    for (const request of overdue) {
      // Widen to include OWNER if not already
      const escalatedRoles = [...new Set([...(request.policyRule.requiredRoles as string[]), 'OWNER'])];

      await this.prisma.approvalRequest.update({
        where: { id: request.id },
        data: { status: 'ESCALATED' },
      });

      // Log escalation
      await this.ledger.logEvent({
        entityType: request.entityType,
        entityId: request.entityId,
        eventType: 'APPROVAL_ESCALATED',
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        payload: {
          approvalRequestId: request.id,
          originalRoles: request.policyRule.requiredRoles,
          escalatedRoles,
          escalatedAt: new Date().toISOString(),
        },
      });
    }
  }
}
```

Also: treat `ESCALATED` the same as `PENDING` for voting — but with widened role set.

---

#### 8.7 — Approval expiry cron

```typescript
@Cron(CronExpression.EVERY_HOUR)
async processExpiries() {
  await this.prisma.approvalRequest.updateMany({
    where: {
      status: { in: ['PENDING', 'ESCALATED'] },
      expiresAt: { lt: new Date() },
    },
    data: { status: 'EXPIRED', resolvedAt: new Date() },
  });
}
```

Log `APPROVAL_EXPIRED` events.

---

#### 8.8 — Frontend: Team & Permissions management page

New page: `frontend/src/app/dashboard/team/page.tsx`

Features:
- **Members list** — Name, email, OrgRole, joined date, actions (change role, remove)
- **Invite member** — Email + role selector (only roles ≤ actor's own authority)
- **Permission matrix** — Visual grid of Action × Role with toggles
- **Delegations** — Active delegations with create/revoke, date range
- **Pending approvals count** — Badge showing how many approvals need attention

---

#### 8.9 — Frontend: Enhanced approvals page

Extend existing approvals page with:
- **Entity type tabs** — All | Purchase Orders | Escrow Funding | Settlements | Early Payments | LP Funding
- **Escalated badge** — Visual indicator for escalated requests
- **Expiry countdown** — Shows time remaining
- **Delegation indicator** — If voting via delegation, show "Acting for [Name]"

---

#### 8.10 — Unit + E2E tests for Phase 8

- VIEWER role cannot trigger state transitions
- Permission override: MEMBER added to SEND_PO → MEMBER can send POs
- Permission reset: removing override reverts to platform default
- Delegation: user A delegates VOTE_APPROVAL to user B; B can vote on A's behalf
- Delegation expiry: expired delegation denied
- Escalation: overdue approval request widens to OWNER
- Expiry: expired approval request marked EXPIRED automatically

---

### Phase 9: Org-Type-Specific Policy Templates & Pilot Gating

**Goal:** Provide ready-made policy templates for each org type, integrate with feature flags for controlled rollout, and build the foundation for pilot onboarding.

---

#### 9.1 — Policy templates

When a new org is created (during registration or invitation acceptance), seed default policy rules based on org type and jurisdiction:

**Buyer Org Template (UK/GBP):**

| Rule Type | Name | Conditions | Approvals | Roles | Auto |
|---|---|---|---|---|---|
| `PO_APPROVAL` | Auto-approve small POs | `maxAmount: £10,000` | 0 | — | ✓ |
| `PO_APPROVAL` | Medium PO approval | `minAmount: £10,001, maxAmount: £50,000` | 1 | APPROVER | ✗ |
| `PO_APPROVAL` | Large PO approval | `minAmount: £50,001` | 2 | APPROVER, FINANCE | ✗ |
| `PO_ORDER_LIMITS` | UK PO limits | `minAmount: £500, maxAmount: £250,000` | — | — | — |
| `ESCROW_FUNDING` | Auto-approve escrow ≤£25k | `maxAmount: £25,000` | 0 | — | ✓ |
| `ESCROW_FUNDING` | Large escrow funding | `minAmount: £25,001` | 1 | FINANCE | ✗ |
| `SETTLEMENT` | Auto-settle ≤£50k | `maxAmount: £50,000` | 0 | — | ✓ |
| `SETTLEMENT` | Large settlement approval | `minAmount: £50,001` | 1 | FINANCE, OWNER | ✗ |

**Supplier Org Template (UK/GBP):**

| Rule Type | Name | Conditions | Approvals | Roles | Auto |
|---|---|---|---|---|---|
| `SUPPLIER_ACCEPTANCE` | Auto-accept ≤£20k | `maxAmount: £20,000` | 0 | — | ✓ |
| `SUPPLIER_ACCEPTANCE` | Large PO acceptance | `minAmount: £20,001` | 1 | APPROVER, OWNER | ✗ |
| `EARLY_PAYMENT` | Auto-approve early pay ≤£15k | `maxAmount: £15,000` | 0 | — | ✓ |
| `EARLY_PAYMENT` | Large early pay request | `minAmount: £15,001` | 1 | FINANCE | ✗ |

**LP Org Template (UK/GBP):**

| Rule Type | Name | Conditions | Approvals | Roles | Auto |
|---|---|---|---|---|---|
| `LP_FUNDING` | Auto-fund ≤£25k | `maxAmount: £25,000` | 0 | — | ✓ |
| `LP_FUNDING` | Large LP funding | `minAmount: £25,001` | 1 | APPROVER | ✗ |
| `LP_FUNDING` | Major LP commitment | `minAmount: £100,001` | 2 | APPROVER, FINANCE | ✗ |
| `FUNDING_LIMIT` | Standard LP limits | exposure/concentration/whitelist | — | — | — |

KSA templates: Same structure, SAR equivalents (×3.75 conversion), Sharia fee terminology (`ujrahBps` instead of `feeBps`).

---

#### 9.2 — Template seeding service

`backend/src/policies/policy-template.service.ts`

- `seedDefaultPolicies(orgId, orgType, jurisdiction, currency)` — Called from `OrganisationsService.createWithOwner()` during registration.
- `getTemplates(orgType, jurisdiction)` — Returns template definitions for preview.
- `resetToDefaults(orgId)` — Wipes custom rules, re-seeds templates.

---

#### 9.3 — Feature flag integration

New feature flags:

| Flag | Default | Purpose |
|---|---|---|
| `POLICY_ENGINE` | `false` | Enables the `PolicyEvaluationService` pipeline |
| `SUPPLIER_APPROVALS` | `false` | Enables supplier-side approval workflows |
| `LP_FUNDING_APPROVALS` | `false` | Enables LP-side approval workflows |
| `DELEGATION` | `false` | Enables proxy voting / delegation |
| `ESCALATION` | `false` | Enables automatic approval escalation |

Per-org overrides via existing `FeatureFlagService` allow pilot rollout to specific orgs.

---

#### 9.4 — Pilot onboarding checklist

Admin page section showing readiness per org:

```
Org: Acme Retail Ltd (BUYER)
  ✅ KYB Verified
  ✅ Bank IBAN Connected
  ✅ Onboarding Complete
  ✅ Policy Rules Configured (8 rules)
  ✅ At least 1 APPROVER member
  ✅ At least 1 FINANCE member
  ⬜ Feature flags enabled
  ⬜ Test PO completed
```

---

#### 9.5 — Policy dashboard for org owners

New page: `frontend/src/app/dashboard/policies/page.tsx`

- **Active rules** — Table showing all org rules by type, with conditions, approval counts, edit/deactivate
- **Create rule** — Form with rule type selector, conditions builder, approval settings
- **Template reset** — "Reset to platform defaults" button
- **Policy simulator** — Input an amount + action type → shows which policy would match and what approval flow would trigger
- **Audit log** — Recent policy changes from ledger

---

#### 9.6 — Seed updates

Update `seed.ts` to:
- Seed the new rule types for existing UK buyer org (escrow funding, settlement gates)
- Seed supplier acceptance rules for existing UK supplier
- Seed LP funding rules for existing UK LP
- Create test APPROVER and FINANCE users in the supplier and LP orgs for E2E testing

---

#### 9.7 — E2E tests for Phase 9

- Template seeding on new org registration → correct default rules created
- Policy simulator returns correct predictions
- Feature flag `POLICY_ENGINE` disabled → old behavior preserved (backward compat)
- Feature flag enabled for one org → only that org gets new policy checks
- Pilot readiness check for a fully configured org → all green
- Pilot readiness check for incomplete org → shows missing items

---

## Progress Tracker

| Phase | Name | Status | Tests Before → After | Date |
|---|---|---|---|---|
| 7 | Policy Engine Foundation | Not Started | 512 → ? | — |
| 8 | Permission Matrix & Role Governance | Not Started | ? → ? | — |
| 9 | Policy Templates & Pilot Gating | Not Started | ? → ? | — |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Backward compatibility — existing tests assume no policy gates on new transitions | Feature flag `POLICY_ENGINE` defaults to `false`; all new gates check the flag first |
| Performance — PolicyEvaluationService adds DB queries to every transition | Cache policy rules per org with short TTL (30s); org status cached in JWT payload |
| Complexity — too many approval states can confuse users | Approval overlay (no new PO states); clear UI showing "pending approval" badges |
| Delegation abuse — user delegates authority permanently | Enforce `validTo` as mandatory; max duration 30 days; OWNER-only delegation creation |
| Escalation spam — escalation fires every 10 minutes | Escalation happens once (PENDING→ESCALATED); subsequent runs skip already-escalated requests |

---

## Dependency Map

```
Phase 7 (Foundation)
  ├─ 7.1 Enum extension ─────────┐
  ├─ 7.2 PolicyEvaluationService ─┤─ 7.5 Wire into transitions
  ├─ 7.3 OrgStatus guard ────────┘
  ├─ 7.4 KYB enforcement ────────┘
  ├─ 7.6 Callback registry ──────── 7.5
  ├─ 7.7 Pending approval overlay ─ 7.5
  ├─ 7.8 Ledger events ──────────── 7.2
  ├─ 7.9 Policy change audit ─────┐
  └─ 7.10 Tests ──────────────────┘

Phase 8 (Permissions & Governance) ─── depends on Phase 7
  ├─ 8.1 VIEWER role ─────────────┐
  ├─ 8.2 OrgPermission model ─────┤─ 8.3 Permission endpoints
  ├─ 8.4 OrgDelegation model ─────┤─ 8.5 Delegation service
  ├─ 8.6 Escalation engine ───────┤
  ├─ 8.7 Expiry cron ─────────────┤
  ├─ 8.8 Team management page ────┤
  ├─ 8.9 Enhanced approvals page ─┤
  └─ 8.10 Tests ──────────────────┘

Phase 9 (Templates & Pilot) ─── depends on Phase 8
  ├─ 9.1 Policy templates ─────┐
  ├─ 9.2 Template seeding ─────┤─ 9.6 Seed updates
  ├─ 9.3 Feature flag integration
  ├─ 9.4 Pilot readiness ──────┤
  ├─ 9.5 Policy dashboard ─────┤
  └─ 9.7 Tests ────────────────┘
```

---

## Summary of Deliverables

| Phase | New Files | Modified Files | New Models | New Tests (est.) |
|---|---|---|---|---|
| **7** | `policy-evaluation.service.ts`, `org-status.guard.ts`, `approval-callback.registry.ts`, `policy-engine.e2e-spec.ts` | schema.prisma (enum), 6 service files (gate wiring), PoliciesService (audit), ApprovalsController (registry) | — (enum extension only) | ~25 |
| **8** | `delegation.service.ts`, `escalation.service.ts`, `team/page.tsx` | schema.prisma (2 models + VIEWER), OrgRole enum, PolicyEvaluationService (delegation check), ApprovalsService (escalation/expiry) | `OrgPermission`, `OrgDelegation` | ~20 |
| **9** | `policy-template.service.ts`, `policies/page.tsx`, pilot readiness component | seed.ts (new rules/users), OrganisationsService (template seeding on create), FeatureFlagService (new flags) | — | ~15 |

**Estimated total: ~60 new tests → 512 → ~572 tests**

---

*This plan builds on the existing PolicyRule/ApprovalRequest/Approval infrastructure, extending it from a PO-only gate into a universal policy engine covering all state machine transitions, with configurable permissions, delegation, escalation, and pilot-ready governance.*
