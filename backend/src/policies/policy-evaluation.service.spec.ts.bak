import { Test, TestingModule } from "@nestjs/testing";
import {
  PolicyEvaluationService,
  PolicyEvaluationInput,
} from "./policy-evaluation.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { OrganisationsService } from "../organisations/organisations.service";
import { ApprovalsService } from "../approvals/approvals.service";
import {
  FeatureFlagService,
  FeatureFlag,
} from "../config/feature-flags.service";

describe("PolicyEvaluationService", () => {
  let service: PolicyEvaluationService;
  let prisma: Record<string, any>;
  let ledger: Record<string, any>;
  let orgs: Record<string, any>;
  let approvals: Record<string, any>;
  let featureFlags: Record<string, any>;

  const baseInput: PolicyEvaluationInput = {
    action: "ESCROW_FUNDING" as any,
    organisationId: "org-1",
    actorUserId: "user-1",
    actorOrgRole: "OWNER",
    entityType: "PURCHASE_ORDER",
    entityId: "po-1",
    amountMinorUnits: 100_000_00,
    currency: "GBP",
  };

  beforeEach(async () => {
    prisma = {
      organisation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "org-1",
          name: "Acme Buyers",
          status: "ACTIVE",
          onboardingStatus: "COMPLETED",
          type: "BUYER",
          supplierTier: null,
          fundingLimitTotal: null,
          participationAgreementAcceptedAt: null,
        }),
      },
      policyRule: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      approvalRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      orgMembership: {
        findFirst: jest.fn().mockResolvedValue({ orgRole: "OWNER" }),
      },
      orgPermission: {
        findUnique: jest.fn().mockResolvedValue(null), // No overrides by default
      },
      orgDelegation: {
        findFirst: jest.fn().mockResolvedValue(null), // No delegations by default
      },
    };

    ledger = {
      logEvent: jest.fn().mockResolvedValue({ id: "evt-1" }),
    };

    orgs = {
      getOrgByUserId: jest.fn().mockResolvedValue({
        id: "org-1",
        name: "Acme Buyers",
        status: "ACTIVE",
      }),
    };

    approvals = {
      createRequest: jest.fn().mockResolvedValue({ id: "approval-req-1" }),
    };

    featureFlags = {
      isEnabled: jest.fn().mockResolvedValue(true), // Engine ON by default
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyEvaluationService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledger },
        { provide: OrganisationsService, useValue: orgs },
        { provide: ApprovalsService, useValue: approvals },
        { provide: FeatureFlagService, useValue: featureFlags },
      ],
    }).compile();

    service = module.get(PolicyEvaluationService);
  });

  // ── Gate 0: Feature Flag ────────────────────────────────

  describe("Gate 0: Feature Flag", () => {
    it("should allow all actions when POLICY_ENGINE_V2 is disabled", async () => {
      featureFlags.isEnabled.mockResolvedValue(false);

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(true);
      expect(decision.autoApprove).toBe(true);
      expect(decision.gates.policy).toBe("NO_RULE");
      // Should not query org or rules
      expect(prisma.organisation.findUnique).not.toHaveBeenCalled();
    });
  });

  // ── Gate 1: Org Status ──────────────────────────────────

  describe("Gate 1: Org Status", () => {
    it("should deny when org not found", async () => {
      prisma.organisation.findUnique.mockResolvedValue(null);

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("not found");
    });

    it("should deny when org is SUSPENDED", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "SUSPENDED",
        onboardingStatus: "COMPLETED",
        type: "BUYER",
      });

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.orgStatus).toBe("FAIL");
      expect(decision.reason).toContain("SUSPENDED");
    });

    it("should deny when org is PENDING", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "PENDING",
        onboardingStatus: "NOT_STARTED",
        type: "BUYER",
      });

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.orgStatus).toBe("FAIL");
    });

    it("should pass when org is ACTIVE", async () => {
      const decision = await service.evaluate(baseInput);
      expect(decision.gates.orgStatus).toBe("PASS");
    });
  });

  // ── Gate 2: KYB / Onboarding ────────────────────────────

  describe("Gate 2: KYB / Onboarding", () => {
    it("should deny financial action when onboarding not completed", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "IN_PROGRESS",
        type: "BUYER",
      });

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.kybStatus).toBe("FAIL");
      expect(decision.reason).toContain("onboarding");
    });

    it("should skip KYB check for non-financial actions", async () => {
      const input = { ...baseInput, action: "PO_APPROVAL" as any };

      const decision = await service.evaluate(input);

      expect(decision.gates.kybStatus).toBe("SKIP");
    });

    it("should deny supplier without supplierTier for financial action", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "COMPLETED",
        type: "SUPPLIER",
        supplierTier: null,
      });

      const input = { ...baseInput, action: "EARLY_PAYMENT" as any };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.kybStatus).toBe("FAIL");
      expect(decision.reason).toContain("Tier 1");
    });

    it("should deny LP without funding limit or participation agreement", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "COMPLETED",
        type: "LIQUIDITY_PARTNER",
        fundingLimitTotal: null,
        participationAgreementAcceptedAt: null,
      });

      const input = { ...baseInput, action: "LP_FUNDING" as any };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.kybStatus).toBe("FAIL");
      expect(decision.reason).toContain("funding limit");
    });

    it("should pass KYB for LP with all requirements met", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "COMPLETED",
        type: "LIQUIDITY_PARTNER",
        fundingLimitTotal: 10_000_000,
        participationAgreementAcceptedAt: new Date(),
      });

      const input = { ...baseInput, action: "LP_FUNDING" as any };

      const decision = await service.evaluate(input);

      expect(decision.gates.kybStatus).toBe("PASS");
    });
  });

  // ── Gate 3: Permission Check ────────────────────────────

  describe("Gate 3: Permission Check", () => {
    it("should deny MEMBER for ESCROW_FUNDING action", async () => {
      const input = { ...baseInput, actorOrgRole: "MEMBER" };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.permission).toBe("FAIL");
      expect(decision.reason).toContain("not authorised");
    });

    it("should allow FINANCE for ESCROW_FUNDING action", async () => {
      const input = { ...baseInput, actorOrgRole: "FINANCE" };

      const decision = await service.evaluate(input);

      expect(decision.gates.permission).toBe("PASS");
    });

    it("should allow OWNER for any action", async () => {
      const actions = [
        "PO_APPROVAL",
        "ESCROW_FUNDING",
        "DELIVERY_VERIFICATION",
        "SETTLEMENT",
        "SUPPLIER_ACCEPTANCE",
        "EARLY_PAYMENT",
        "LP_FUNDING",
        "DISPUTE_RESOLUTION",
      ];

      for (const action of actions) {
        // Reset mocks for each iteration
        prisma.organisation.findUnique.mockResolvedValue({
          id: "org-1",
          status: "ACTIVE",
          onboardingStatus: "COMPLETED",
          type:
            action === "LP_FUNDING"
              ? "LIQUIDITY_PARTNER"
              : action === "EARLY_PAYMENT" || action === "SUPPLIER_ACCEPTANCE"
                ? "SUPPLIER"
                : "BUYER",
          supplierTier: "1",
          fundingLimitTotal: 10_000_000,
          participationAgreementAcceptedAt: new Date(),
        });

        const input = {
          ...baseInput,
          action: action as any,
          actorOrgRole: "OWNER",
        };
        const decision = await service.evaluate(input);

        expect(decision.gates.permission).toBe("PASS");
      }
    });

    it("should deny APPROVER for SETTLEMENT action", async () => {
      const input = {
        ...baseInput,
        action: "SETTLEMENT" as any,
        actorOrgRole: "APPROVER",
      };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.permission).toBe("FAIL");
    });

    it("should deny VIEWER for all actions", async () => {
      const input = { ...baseInput, actorOrgRole: "VIEWER" };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.permission).toBe("FAIL");
    });

    it("should respect per-org permission overrides", async () => {
      // Override: allow MEMBER for ESCROW_FUNDING (normally denied)
      prisma.orgPermission.findUnique.mockResolvedValue({
        id: "perm-1",
        action: "ESCROW_FUNDING",
        allowedRoles: ["OWNER", "FINANCE", "MEMBER"],
      });

      const input = { ...baseInput, actorOrgRole: "MEMBER" };
      const decision = await service.evaluate(input);

      expect(decision.gates.permission).toBe("PASS");
    });

    it("should allow via active delegation when role is denied", async () => {
      // MEMBER is normally denied for ESCROW_FUNDING
      prisma.orgDelegation.findFirst.mockResolvedValue({
        id: "del-1",
        actions: ["ESCROW_FUNDING"],
        delegatorUserId: "owner-1",
        delegateUserId: "user-1",
        active: true,
      });

      const input = { ...baseInput, actorOrgRole: "MEMBER" };
      const decision = await service.evaluate(input);

      expect(decision.gates.permission).toBe("PASS");
    });
  });

  // ── Gate 4: Policy Rule Match ───────────────────────────

  describe("Gate 4: Policy Rule Match", () => {
    it("should allow when no rules exist (permissive default)", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(true);
      expect(decision.gates.policy).toBe("NO_RULE");
    });

    it("should auto-approve when matching rule has autoApprove=true", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Auto-approve small escrow",
          conditions: { maxAmount: 500_000_00 },
          autoApprove: true,
          requiredApprovals: 0,
          requiredRoles: [],
          priority: 10,
        },
      ]);

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(true);
      expect(decision.autoApprove).toBe(true);
      expect(decision.gates.policy).toBe("PASS");
      expect(decision.matchedRule?.name).toBe("Auto-approve small escrow");
    });

    it("should require manual approval when matching rule has autoApprove=false", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Large escrow: 2 approvals",
          conditions: { minAmount: 50_000_00 },
          autoApprove: false,
          requiredApprovals: 2,
          requiredRoles: ["APPROVER", "FINANCE"],
          priority: 10,
        },
      ]);

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(false);
      expect(decision.requiresApproval).toBe(true);
      expect(decision.gates.policy).toBe("APPROVAL_REQUIRED");
      expect(decision.requiredApprovals).toBe(2);
      expect(decision.approvalRequestId).toBe("approval-req-1");
    });

    it("should match highest priority rule first", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-high",
          name: "High priority rule",
          conditions: {},
          autoApprove: true,
          priority: 20,
        },
        {
          id: "rule-low",
          name: "Low priority rule",
          conditions: {},
          autoApprove: false,
          requiredApprovals: 1,
          requiredRoles: [],
          priority: 5,
        },
      ]);

      const decision = await service.evaluate(baseInput);

      expect(decision.matchedRule?.name).toBe("High priority rule");
      expect(decision.autoApprove).toBe(true);
    });

    it("should skip rule when amount is outside range", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Large amounts only",
          conditions: { minAmount: 1_000_000_00 },
          autoApprove: false,
          requiredApprovals: 2,
          requiredRoles: ["APPROVER"],
          priority: 10,
        },
      ]);

      // Amount is 100k which doesn't match minAmount of 1M
      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(true);
      expect(decision.gates.policy).toBe("NO_RULE");
    });

    it("should return existing pending approval when one exists", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Requires approval",
          conditions: {},
          autoApprove: false,
          requiredApprovals: 1,
          requiredRoles: [],
          priority: 10,
        },
      ]);
      prisma.approvalRequest.findFirst.mockResolvedValue({
        id: "existing-approval",
        status: "PENDING",
      });

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(false);
      expect(decision.requiresApproval).toBe(true);
      expect(decision.approvalRequestId).toBe("existing-approval");
      expect(decision.reason).toContain("already pending");
    });
  });

  // ── evaluateForActor convenience method ─────────────────

  describe("evaluateForActor", () => {
    it("should resolve org and role then evaluate", async () => {
      const decision = await service.evaluateForActor(
        "user-1",
        "ESCROW_FUNDING" as any,
        "PURCHASE_ORDER",
        "po-1",
        { amountMinorUnits: 100_000_00, currency: "GBP" },
      );

      expect(orgs.getOrgByUserId).toHaveBeenCalledWith("user-1");
      expect(prisma.orgMembership.findFirst).toHaveBeenCalled();
      expect(decision.allowed).toBe(true); // No rules = permissive
    });

    it("should allow when actor has no org and engine is disabled", async () => {
      orgs.getOrgByUserId.mockResolvedValue(null);
      featureFlags.isEnabled.mockResolvedValue(false);

      const decision = await service.evaluateForActor(
        "orphan-user",
        "PO_APPROVAL" as any,
        "PURCHASE_ORDER",
        "po-1",
      );

      expect(decision.allowed).toBe(true);
    });

    it("should deny when actor has no org and engine is enabled", async () => {
      orgs.getOrgByUserId.mockResolvedValue(null);
      featureFlags.isEnabled.mockResolvedValue(true);

      const decision = await service.evaluateForActor(
        "orphan-user",
        "PO_APPROVAL" as any,
        "PURCHASE_ORDER",
        "po-1",
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("no organisation");
    });
  });

  // ── Ledger Logging ──────────────────────────────────────

  describe("Ledger Logging", () => {
    it("should log POLICY_EVALUATION on allow", async () => {
      await service.evaluate(baseInput);

      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "PURCHASE_ORDER",
          entityId: "po-1",
          eventType: "POLICY_EVALUATION",
          payload: expect.objectContaining({
            action: "ESCROW_FUNDING",
            decision: "ALLOWED",
          }),
        }),
      );
    });

    it("should log denial with reason", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "SUSPENDED",
        type: "BUYER",
      });

      await service.evaluate(baseInput);

      // Denial fires in fire-and-forget mode, so logEvent is called
      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "POLICY_EVALUATION",
          payload: expect.objectContaining({
            decision: "DENIED",
          }),
        }),
      );
    });

    it("should not throw when ledger logging fails", async () => {
      ledger.logEvent.mockRejectedValue(new Error("DB down"));

      const decision = await service.evaluate(baseInput);

      // Should still return a valid decision
      expect(decision.allowed).toBe(true);
    });
  });
});
