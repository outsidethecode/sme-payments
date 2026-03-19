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
        findUnique: jest.fn().mockResolvedValue(null),
      },
      orgDelegation: {
        findFirst: jest.fn().mockResolvedValue(null),
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
      isEnabled: jest.fn().mockResolvedValue(true),
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
    it("should allow all actions when POLICY_ENGINE is disabled", async () => {
      featureFlags.isEnabled.mockResolvedValue(false);

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(true);
      expect(decision.autoApprove).toBe(true);
      expect(decision.gates.policy).toBe("NO_RULE");
      expect(prisma.organisation.findUnique).not.toHaveBeenCalled();
    });

    it("should check feature flag with organisationId", async () => {
      featureFlags.isEnabled.mockResolvedValue(false);

      await service.evaluate(baseInput);

      expect(featureFlags.isEnabled).toHaveBeenCalledWith(
        FeatureFlag.POLICY_ENGINE,
        "org-1",
      );
    });

    it("should return consistent gate results when engine disabled", async () => {
      featureFlags.isEnabled.mockResolvedValue(false);

      const decision = await service.evaluate(baseInput);

      expect(decision.gates).toEqual({
        orgStatus: "PASS",
        kybStatus: "SKIP",
        permission: "SKIP",
        policy: "NO_RULE",
      });
      expect(decision.requiresApproval).toBe(false);
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

    it("should deny when org is DEACTIVATED", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "DEACTIVATED",
        onboardingStatus: "COMPLETED",
        type: "BUYER",
      });

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.orgStatus).toBe("FAIL");
      expect(decision.reason).toContain("DEACTIVATED");
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

    it("should skip KYB check for PO_APPROVAL (non-financial)", async () => {
      const input = { ...baseInput, action: "PO_APPROVAL" as any };

      const decision = await service.evaluate(input);

      expect(decision.gates.kybStatus).toBe("SKIP");
    });

    it("should skip KYB check for DELIVERY_VERIFICATION (non-financial)", async () => {
      const input = { ...baseInput, action: "DELIVERY_VERIFICATION" as any };

      const decision = await service.evaluate(input);

      expect(decision.gates.kybStatus).toBe("SKIP");
    });

    it("should skip KYB check for SUPPLIER_ACCEPTANCE (non-financial)", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "COMPLETED",
        type: "SUPPLIER",
        supplierTier: "BASIC",
      });
      const input = {
        ...baseInput,
        action: "SUPPLIER_ACCEPTANCE" as any,
        actorOrgRole: "OWNER",
      };

      const decision = await service.evaluate(input);

      expect(decision.gates.kybStatus).toBe("SKIP");
    });

    it("should require completed KYB for ESCROW_FUNDING", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "NOT_STARTED",
        type: "BUYER",
      });

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.kybStatus).toBe("FAIL");
    });

    it("should require completed KYB for SETTLEMENT", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "IN_PROGRESS",
        type: "BUYER",
      });
      const input = {
        ...baseInput,
        action: "SETTLEMENT" as any,
        actorOrgRole: "OWNER",
      };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.kybStatus).toBe("FAIL");
    });

    it("should require completed KYB for EARLY_PAYMENT", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "NOT_STARTED",
        type: "SUPPLIER",
      });
      const input = { ...baseInput, action: "EARLY_PAYMENT" as any };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.kybStatus).toBe("FAIL");
    });

    it("should require completed KYB for LP_FUNDING", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "IN_PROGRESS",
        type: "LIQUIDITY_PARTNER",
      });
      const input = { ...baseInput, action: "LP_FUNDING" as any };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.kybStatus).toBe("FAIL");
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

    it("should pass supplier with supplierTier for financial action", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "COMPLETED",
        type: "SUPPLIER",
        supplierTier: "BASIC",
      });

      const input = {
        ...baseInput,
        action: "EARLY_PAYMENT" as any,
        actorOrgRole: "OWNER",
      };

      const decision = await service.evaluate(input);

      expect(decision.gates.kybStatus).toBe("PASS");
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

    it("should deny LP with funding limit but no participation agreement", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "COMPLETED",
        type: "LIQUIDITY_PARTNER",
        fundingLimitTotal: 10_000_000,
        participationAgreementAcceptedAt: null,
      });

      const input = { ...baseInput, action: "LP_FUNDING" as any };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.kybStatus).toBe("FAIL");
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

    it("should allow APPROVER for PO_APPROVAL", async () => {
      const input = {
        ...baseInput,
        action: "PO_APPROVAL" as any,
        actorOrgRole: "APPROVER",
      };

      const decision = await service.evaluate(input);

      expect(decision.gates.permission).toBe("PASS");
    });

    it("should allow MEMBER for PO_APPROVAL", async () => {
      const input = {
        ...baseInput,
        action: "PO_APPROVAL" as any,
        actorOrgRole: "MEMBER",
      };

      const decision = await service.evaluate(input);

      expect(decision.gates.permission).toBe("PASS");
    });

    it("should deny MEMBER for SETTLEMENT", async () => {
      const input = {
        ...baseInput,
        action: "SETTLEMENT" as any,
        actorOrgRole: "MEMBER",
      };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.permission).toBe("FAIL");
    });

    it("should allow FINANCE for SETTLEMENT", async () => {
      const input = {
        ...baseInput,
        action: "SETTLEMENT" as any,
        actorOrgRole: "FINANCE",
      };

      const decision = await service.evaluate(input);

      expect(decision.gates.permission).toBe("PASS");
    });

    it("should allow APPROVER for SUPPLIER_ACCEPTANCE", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "COMPLETED",
        type: "SUPPLIER",
        supplierTier: "BASIC",
      });
      const input = {
        ...baseInput,
        action: "SUPPLIER_ACCEPTANCE" as any,
        actorOrgRole: "APPROVER",
      };

      const decision = await service.evaluate(input);

      expect(decision.gates.permission).toBe("PASS");
    });

    it("should deny MEMBER for SUPPLIER_ACCEPTANCE", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "COMPLETED",
        type: "SUPPLIER",
        supplierTier: "BASIC",
      });
      const input = {
        ...baseInput,
        action: "SUPPLIER_ACCEPTANCE" as any,
        actorOrgRole: "MEMBER",
      };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.permission).toBe("FAIL");
    });

    it("should allow APPROVER for LP_FUNDING", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "COMPLETED",
        type: "LIQUIDITY_PARTNER",
        fundingLimitTotal: 10_000_000,
        participationAgreementAcceptedAt: new Date(),
      });
      const input = {
        ...baseInput,
        action: "LP_FUNDING" as any,
        actorOrgRole: "APPROVER",
      };

      const decision = await service.evaluate(input);

      expect(decision.gates.permission).toBe("PASS");
    });

    it("should deny MEMBER for LP_FUNDING", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        status: "ACTIVE",
        onboardingStatus: "COMPLETED",
        type: "LIQUIDITY_PARTNER",
        fundingLimitTotal: 10_000_000,
        participationAgreementAcceptedAt: new Date(),
      });
      const input = {
        ...baseInput,
        action: "LP_FUNDING" as any,
        actorOrgRole: "MEMBER",
      };

      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.permission).toBe("FAIL");
    });

    it("should respect per-org permission overrides", async () => {
      prisma.orgPermission.findUnique.mockResolvedValue({
        id: "perm-1",
        action: "ESCROW_FUNDING",
        allowedRoles: ["OWNER", "FINANCE", "MEMBER"],
      });

      const input = { ...baseInput, actorOrgRole: "MEMBER" };
      const decision = await service.evaluate(input);

      expect(decision.gates.permission).toBe("PASS");
    });

    it("should deny via per-org override when role not in allowedRoles", async () => {
      prisma.orgPermission.findUnique.mockResolvedValue({
        id: "perm-1",
        action: "PO_APPROVAL",
        allowedRoles: ["OWNER"], // Override: only OWNER can approve POs
      });

      const input = {
        ...baseInput,
        action: "PO_APPROVAL" as any,
        actorOrgRole: "MEMBER", // MEMBER normally allowed for PO_APPROVAL, but override restricts
      };
      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.permission).toBe("FAIL");
    });

    it("should allow via active delegation when role is denied", async () => {
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

    it("should deny when delegation is not found", async () => {
      prisma.orgDelegation.findFirst.mockResolvedValue(null);

      const input = { ...baseInput, actorOrgRole: "MEMBER" };
      const decision = await service.evaluate(input);

      expect(decision.allowed).toBe(false);
      expect(decision.gates.permission).toBe("FAIL");
    });

    it("should include allowed roles in denial reason", async () => {
      const input = {
        ...baseInput,
        action: "SETTLEMENT" as any,
        actorOrgRole: "MEMBER",
      };

      const decision = await service.evaluate(input);

      expect(decision.reason).toContain("MEMBER");
      expect(decision.reason).toContain("SETTLEMENT");
      expect(decision.reason).toContain("OWNER");
      expect(decision.reason).toContain("FINANCE");
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

    it("should require manual approval when autoApprove=false", async () => {
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

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(true);
      expect(decision.gates.policy).toBe("NO_RULE");
    });

    it("should match rule when amount is at exact minAmount boundary", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Min 100k",
          conditions: { minAmount: 100_000_00 },
          autoApprove: true,
          priority: 10,
        },
      ]);

      const decision = await service.evaluate(baseInput); // amountMinorUnits = 100_000_00

      expect(decision.allowed).toBe(true);
      expect(decision.gates.policy).toBe("PASS");
    });

    it("should match rule when amount is at exact maxAmount boundary", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Up to 100k",
          conditions: { maxAmount: 100_000_00 },
          autoApprove: true,
          priority: 10,
        },
      ]);

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(true);
      expect(decision.gates.policy).toBe("PASS");
    });

    it("should default amountMinorUnits to 0 when not provided", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Min 100",
          conditions: { minAmount: 100 },
          autoApprove: true,
          priority: 10,
        },
      ]);

      const input = { ...baseInput, amountMinorUnits: undefined };
      const decision = await service.evaluate(input);

      // 0 < 100, so rule shouldn't match
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

    it("should create new approval request when none pending", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Manual approval",
          conditions: {},
          autoApprove: false,
          requiredApprovals: 1,
          requiredRoles: ["APPROVER"],
          priority: 10,
        },
      ]);

      const decision = await service.evaluate(baseInput);

      expect(approvals.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "PURCHASE_ORDER",
          entityId: "po-1",
          organisationId: "org-1",
          policyRuleId: "rule-1",
          requiredApprovals: 1,
        }),
      );
      expect(decision.approvalRequestId).toBe("approval-req-1");
    });

    it("should include requiredRoles in approval reason", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Two approvals needed",
          conditions: {},
          autoApprove: false,
          requiredApprovals: 2,
          requiredRoles: ["APPROVER", "FINANCE"],
          priority: 10,
        },
      ]);

      const decision = await service.evaluate(baseInput);

      expect(decision.reason).toContain("2 approval(s)");
      expect(decision.reason).toContain("APPROVER");
      expect(decision.reason).toContain("FINANCE");
    });

    it("should fall through to next rule when first doesn't match amount", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-high",
          name: "Large only (>500k)",
          conditions: { minAmount: 500_000_00 },
          autoApprove: false,
          requiredApprovals: 2,
          requiredRoles: ["APPROVER", "FINANCE"],
          priority: 20,
        },
        {
          id: "rule-low",
          name: "Catch-all",
          conditions: {},
          autoApprove: true,
          priority: 5,
        },
      ]);

      const decision = await service.evaluate(baseInput); // 100k

      expect(decision.matchedRule?.name).toBe("Catch-all");
      expect(decision.autoApprove).toBe(true);
    });

    it("should allow when all rules have unmatched conditions", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "High amounts only",
          conditions: { minAmount: 1_000_000_00 },
          autoApprove: false,
          requiredApprovals: 1,
          requiredRoles: [],
          priority: 10,
        },
      ]);

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(true);
      expect(decision.gates.policy).toBe("NO_RULE");
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
      expect(decision.allowed).toBe(true);
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

    it("should default to MEMBER role when no membership found", async () => {
      prisma.orgMembership.findFirst.mockResolvedValue(null);

      const decision = await service.evaluateForActor(
        "user-1",
        "ESCROW_FUNDING" as any,
        "PURCHASE_ORDER",
        "po-1",
      );

      // MEMBER is not allowed for ESCROW_FUNDING
      expect(decision.allowed).toBe(false);
      expect(decision.gates.permission).toBe("FAIL");
    });

    it("should pass optional metadata through", async () => {
      const decision = await service.evaluateForActor(
        "user-1",
        "PO_APPROVAL" as any,
        "PURCHASE_ORDER",
        "po-1",
        {
          amountMinorUnits: 50_000_00,
          currency: "SAR",
          metadata: { key: "val" },
        },
      );

      expect(decision.allowed).toBe(true);
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

      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "POLICY_EVALUATION",
          payload: expect.objectContaining({
            decision: "DENIED",
          }),
        }),
      );
    });

    it("should log AUTO_APPROVED when rule matches with autoApprove", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Auto-approve",
          conditions: {},
          autoApprove: true,
          priority: 10,
        },
      ]);

      await service.evaluate(baseInput);

      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "POLICY_EVALUATION",
          payload: expect.objectContaining({
            decision: "AUTO_APPROVED",
            matchedRule: expect.objectContaining({
              id: "rule-1",
              name: "Auto-approve",
            }),
          }),
        }),
      );
    });

    it("should log APPROVAL_REQUIRED when manual approval needed", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Manual",
          conditions: {},
          autoApprove: false,
          requiredApprovals: 1,
          requiredRoles: ["APPROVER"],
          priority: 10,
        },
      ]);

      await service.evaluate(baseInput);

      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "POLICY_EVALUATION",
          payload: expect.objectContaining({
            decision: "APPROVAL_REQUIRED",
          }),
        }),
      );
    });

    it("should not throw when ledger logging fails", async () => {
      ledger.logEvent.mockRejectedValue(new Error("DB down"));

      const decision = await service.evaluate(baseInput);

      expect(decision.allowed).toBe(true);
    });

    it("should include actor info in log", async () => {
      await service.evaluate(baseInput);

      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: "user-1",
          actorRole: "OWNER",
        }),
      );
    });

    it("should include amount in log payload", async () => {
      await service.evaluate(baseInput);

      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            amountMinorUnits: 100_000_00,
          }),
        }),
      );
    });
  });
});
