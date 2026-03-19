import { Injectable, ForbiddenException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { OrganisationsService } from "../organisations/organisations.service";
import { ApprovalsService } from "../approvals/approvals.service";
import {
  FeatureFlagService,
  FeatureFlag,
} from "../config/feature-flags.service";
import { PolicyRuleType, OrgRole } from "@prisma/client";
import { PolicyConditions } from "./policies.service";

// ── Types ────────────────────────────────────────────────────

export interface PolicyEvaluationInput {
  /** Which transition / action type */
  action: PolicyRuleType;
  /** The org performing the action */
  organisationId: string;
  /** The user performing the action */
  actorUserId: string;
  /** The actor's role within the org */
  actorOrgRole: OrgRole | string;
  /** Entity type for approval records (e.g. PURCHASE_ORDER, EARLY_PAYMENT) */
  entityType: string;
  /** Entity ID being acted on */
  entityId: string;
  /** Amount in smallest currency unit (for amount-based conditions) */
  amountMinorUnits?: number;
  /** Currency code (for currency-scoped rules) */
  currency?: string;
  /** Extra context for specialised conditions */
  metadata?: Record<string, any>;
}

export interface GateResults {
  orgStatus: "PASS" | "FAIL";
  kybStatus: "PASS" | "FAIL" | "SKIP";
  permission: "PASS" | "FAIL" | "SKIP";
  policy: "PASS" | "FAIL" | "APPROVAL_REQUIRED" | "NO_RULE";
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  autoApprove: boolean;
  reason?: string;
  matchedRule?: { id: string; name: string } | null;
  requiredApprovals?: number;
  requiredRoles?: string[];
  approvalRequestId?: string;
  gates: GateResults;
}

// ── Default Permission Matrix ────────────────────────────────
// Maps PolicyRuleType → { orgTypes → allowed OrgRoles }
// These are platform defaults; orgs can override via OrgPermission (Phase 8).

const ACTION_TO_ORG_TYPE: Record<string, string> = {
  PO_APPROVAL: "BUYER",
  ESCROW_FUNDING: "BUYER",
  DELIVERY_VERIFICATION: "BUYER",
  SETTLEMENT: "BUYER",
  SUPPLIER_ACCEPTANCE: "SUPPLIER",
  EARLY_PAYMENT: "SUPPLIER",
  LP_FUNDING: "LIQUIDITY_PARTNER",
  DISPUTE_RESOLUTION: "ADMIN", // admin action
};

const DEFAULT_ALLOWED_ROLES: Record<string, OrgRole[]> = {
  PO_APPROVAL: [
    OrgRole.OWNER,
    OrgRole.FINANCE,
    OrgRole.APPROVER,
    OrgRole.MEMBER,
  ],
  ESCROW_FUNDING: [OrgRole.OWNER, OrgRole.FINANCE],
  DELIVERY_VERIFICATION: [OrgRole.OWNER, OrgRole.FINANCE],
  SETTLEMENT: [OrgRole.OWNER, OrgRole.FINANCE],
  SUPPLIER_ACCEPTANCE: [OrgRole.OWNER, OrgRole.APPROVER, OrgRole.FINANCE],
  EARLY_PAYMENT: [OrgRole.OWNER, OrgRole.FINANCE],
  LP_FUNDING: [OrgRole.OWNER, OrgRole.APPROVER, OrgRole.FINANCE],
  DISPUTE_RESOLUTION: [OrgRole.OWNER],
};

// Actions that require completed KYB/onboarding.
const FINANCIAL_ACTIONS = new Set<string>([
  "ESCROW_FUNDING",
  "SETTLEMENT",
  "EARLY_PAYMENT",
  "LP_FUNDING",
]);

@Injectable()
export class PolicyEvaluationService {
  private readonly logger = new Logger(PolicyEvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly orgs: OrganisationsService,
    private readonly approvals: ApprovalsService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  /**
   * Convenience: resolve actor's org + role, then evaluate.
   * If the actor has no org membership, the permission gate will FAIL
   * (unless the engine is disabled via feature flag).
   */
  async evaluateForActor(
    actorUserId: string,
    action: PolicyRuleType,
    entityType: string,
    entityId: string,
    opts?: {
      amountMinorUnits?: number;
      currency?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<PolicyDecision> {
    const org = await this.orgs.getOrgByUserId(actorUserId);
    if (!org) {
      // No org means engine can't run; if engine is off, allow anyway
      const enabled = await this.featureFlags.isEnabled(
        FeatureFlag.POLICY_ENGINE_V2,
      );
      if (!enabled) {
        return {
          allowed: true,
          requiresApproval: false,
          autoApprove: true,
          gates: {
            orgStatus: "PASS",
            kybStatus: "SKIP",
            permission: "SKIP",
            policy: "NO_RULE",
          },
        };
      }
      return {
        allowed: false,
        requiresApproval: false,
        autoApprove: false,
        reason: "Actor has no organisation membership",
        gates: {
          orgStatus: "FAIL",
          kybStatus: "SKIP",
          permission: "SKIP",
          policy: "NO_RULE",
        },
      };
    }

    const membership = await this.prisma.orgMembership.findFirst({
      where: { organisationId: org.id, userId: actorUserId },
      select: { orgRole: true },
    });

    return this.evaluate({
      action,
      organisationId: org.id,
      actorUserId,
      actorOrgRole: membership?.orgRole ?? "MEMBER",
      entityType,
      entityId,
      amountMinorUnits: opts?.amountMinorUnits,
      currency: opts?.currency,
      metadata: opts?.metadata,
    });
  }

  /**
   * Evaluate the policy pipeline for a state-machine transition.
   *
   * Gate order:
   *   1. Feature flag check (POLICY_ENGINE_V2 must be enabled)
   *   2. Org status (must be ACTIVE)
   *   3. KYB / onboarding (must be COMPLETED for financial actions)
   *   4. Permission check (OrgRole × Action matrix)
   *   5. Policy rule match (conditions, priority-ordered)
   *   6. Approval decision (auto/manual/skip)
   *
   * If POLICY_ENGINE_V2 is disabled for the org → returns allowed immediately
   * (backward compatibility).
   */
  async evaluate(input: PolicyEvaluationInput): Promise<PolicyDecision> {
    // ── Gate 0: Feature flag ────────────────────────────────
    const engineEnabled = await this.featureFlags.isEnabled(
      FeatureFlag.POLICY_ENGINE_V2,
      input.organisationId,
    );

    if (!engineEnabled) {
      return {
        allowed: true,
        requiresApproval: false,
        autoApprove: true,
        gates: {
          orgStatus: "PASS",
          kybStatus: "SKIP",
          permission: "SKIP",
          policy: "NO_RULE",
        },
      };
    }

    const gates: GateResults = {
      orgStatus: "PASS",
      kybStatus: "SKIP",
      permission: "PASS",
      policy: "NO_RULE",
    };

    // ── Gate 1: Org status ──────────────────────────────────
    const org = await this.prisma.organisation.findUnique({
      where: { id: input.organisationId },
      select: {
        id: true,
        name: true,
        status: true,
        onboardingStatus: true,
        type: true,
        supplierTier: true,
        fundingLimitTotal: true,
        participationAgreementAcceptedAt: true,
      },
    });

    if (!org) {
      return this.deny(input, gates, "Organisation not found");
    }

    if (org.status !== "ACTIVE") {
      gates.orgStatus = "FAIL";
      return this.deny(
        input,
        gates,
        `Organisation is ${org.status} — only ACTIVE organisations may perform this action`,
      );
    }

    // ── Gate 2: KYB / onboarding ────────────────────────────
    if (FINANCIAL_ACTIONS.has(input.action)) {
      if (org.onboardingStatus !== "COMPLETED") {
        gates.kybStatus = "FAIL";
        return this.deny(
          input,
          gates,
          `Organisation onboarding is ${org.onboardingStatus} — must be COMPLETED for financial actions`,
        );
      }

      // Additional per-org-type checks
      if (org.type === "SUPPLIER" && !org.supplierTier) {
        gates.kybStatus = "FAIL";
        return this.deny(
          input,
          gates,
          "Supplier must complete at least Tier 1 onboarding",
        );
      }

      if (
        org.type === "LIQUIDITY_PARTNER" &&
        (!org.fundingLimitTotal || !org.participationAgreementAcceptedAt)
      ) {
        gates.kybStatus = "FAIL";
        return this.deny(
          input,
          gates,
          "LP must set funding limit and accept participation agreement",
        );
      }

      gates.kybStatus = "PASS";
    }

    // ── Gate 3: Permission check ────────────────────────────
    // First check for per-org permission overrides, then fall back to platform defaults.
    const orgPermission = await this.prisma.orgPermission.findUnique({
      where: {
        organisationId_action: {
          organisationId: input.organisationId,
          action: input.action,
        },
      },
    });

    const allowedRoles: string[] = orgPermission
      ? orgPermission.allowedRoles
      : ((DEFAULT_ALLOWED_ROLES[input.action] as string[] | undefined) ?? []);

    if (
      allowedRoles.length > 0 &&
      !allowedRoles.includes(input.actorOrgRole as string)
    ) {
      // Check delegation before denying
      const delegation = await this.prisma.orgDelegation.findFirst({
        where: {
          organisationId: input.organisationId,
          delegateUserId: input.actorUserId,
          active: true,
          actions: { has: input.action },
          validFrom: { lte: new Date() },
          validTo: { gte: new Date() },
        },
      });

      if (!delegation) {
        gates.permission = "FAIL";
        return this.deny(
          input,
          gates,
          `Your role (${input.actorOrgRole}) is not authorised for ${input.action}. Allowed: ${allowedRoles.join(", ")}`,
        );
      }
      // Delegation valid — log and continue
      this.logger.log(
        `User ${input.actorUserId} acting via delegation ${delegation.id} for ${input.action}`,
      );
    }

    // ── Gate 4: Policy rule match ───────────────────────────
    const rules = await this.prisma.policyRule.findMany({
      where: {
        organisationId: input.organisationId,
        ruleType: input.action,
        active: true,
      },
      orderBy: { priority: "desc" },
    });

    // No rules = permissive (allow, no approval)
    if (rules.length === 0) {
      gates.policy = "NO_RULE";
      await this.logEvaluation(input, gates, "ALLOWED", null);
      return {
        allowed: true,
        requiresApproval: false,
        autoApprove: true,
        gates,
      };
    }

    // Find first matching rule by conditions
    for (const rule of rules) {
      const cond = rule.conditions as unknown as PolicyConditions;
      const amount = input.amountMinorUnits ?? 0;

      const minOk = cond.minAmount === undefined || amount >= cond.minAmount;
      const maxOk = cond.maxAmount === undefined || amount <= cond.maxAmount;

      if (minOk && maxOk) {
        // Rule matches
        if (rule.autoApprove) {
          gates.policy = "PASS";
          await this.logEvaluation(input, gates, "AUTO_APPROVED", rule);
          return {
            allowed: true,
            requiresApproval: false,
            autoApprove: true,
            matchedRule: { id: rule.id, name: rule.name },
            gates,
          };
        }

        // Manual approval required
        gates.policy = "APPROVAL_REQUIRED";

        // Check for existing pending approval
        const existing = await this.prisma.approvalRequest.findFirst({
          where: {
            entityType: input.entityType,
            entityId: input.entityId,
            status: { in: ["PENDING", "ESCALATED"] },
          },
        });

        if (existing) {
          await this.logEvaluation(input, gates, "APPROVAL_PENDING", rule);
          return {
            allowed: false,
            requiresApproval: true,
            autoApprove: false,
            matchedRule: { id: rule.id, name: rule.name },
            requiredApprovals: rule.requiredApprovals,
            requiredRoles: rule.requiredRoles,
            approvalRequestId: existing.id,
            reason: "Action is already pending approval",
            gates,
          };
        }

        // Create new approval request
        const approvalRequest = await this.approvals.createRequest({
          entityType: input.entityType,
          entityId: input.entityId,
          organisationId: input.organisationId,
          policyRuleId: rule.id,
          requiredApprovals: rule.requiredApprovals,
          expiresInHours: 7 * 24, // 7 days
        });

        await this.logEvaluation(input, gates, "APPROVAL_REQUIRED", rule);

        return {
          allowed: false,
          requiresApproval: true,
          autoApprove: false,
          matchedRule: { id: rule.id, name: rule.name },
          requiredApprovals: rule.requiredApprovals,
          requiredRoles: rule.requiredRoles,
          approvalRequestId: approvalRequest.id,
          reason: `Requires ${rule.requiredApprovals} approval(s) from ${rule.requiredRoles.join(", ") || "any role"}`,
          gates,
        };
      }
    }

    // No rule conditions matched — allow
    gates.policy = "NO_RULE";
    await this.logEvaluation(input, gates, "ALLOWED", null);
    return {
      allowed: true,
      requiresApproval: false,
      autoApprove: true,
      gates,
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private deny(
    input: PolicyEvaluationInput,
    gates: GateResults,
    reason: string,
  ): PolicyDecision {
    // Fire-and-forget ledger log for denials
    this.logEvaluation(input, gates, "DENIED", null, reason).catch((err) =>
      this.logger.warn(`Failed to log policy denial: ${err.message}`),
    );

    return {
      allowed: false,
      requiresApproval: false,
      autoApprove: false,
      reason,
      gates,
    };
  }

  private async logEvaluation(
    input: PolicyEvaluationInput,
    gates: GateResults,
    decision: string,
    matchedRule: { id: string; name: string } | null,
    reason?: string,
  ): Promise<void> {
    try {
      await this.ledger.logEvent({
        entityType: input.entityType,
        entityId: input.entityId,
        eventType: "POLICY_EVALUATION",
        actorId: input.actorUserId,
        actorRole: String(input.actorOrgRole),
        payload: {
          action: input.action,
          decision,
          gates,
          matchedRule,
          reason: reason ?? null,
          amountMinorUnits: input.amountMinorUnits ?? null,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Failed to log policy evaluation: ${err.message}`);
    }
  }
}
