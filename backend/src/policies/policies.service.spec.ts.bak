import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { PoliciesService } from "./policies.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

describe("PoliciesService", () => {
  let service: PoliciesService;
  let prisma: Record<string, any>;
  let ledger: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      policyRule: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      orgMembership: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      earlyPaymentRequest: {
        findMany: jest.fn(),
      },
    };

    ledger = {
      logEvent: jest.fn().mockResolvedValue({ id: "evt-1" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PoliciesService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledger },
      ],
    }).compile();

    service = module.get(PoliciesService);
  });

  describe("create", () => {
    it("should create a PO_APPROVAL policy", async () => {
      const input = {
        organisationId: "org-1",
        ruleType: "PO_APPROVAL" as const,
        name: "Auto-approve small POs",
        conditions: { maxAmount: 50_000_00 },
        autoApprove: true,
        priority: 10,
      };
      prisma.policyRule.create.mockResolvedValue({ id: "rule-1", ...input });

      const result = await service.create(input);
      expect(result.id).toBe("rule-1");
      expect(prisma.policyRule.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("findById", () => {
    it("should return rule with organisation", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        name: "Test Rule",
        organisation: { id: "org-1", name: "Acme" },
      });
      const result = await service.findById("rule-1");
      expect(result.name).toBe("Test Rule");
    });

    it("should throw NotFoundException", async () => {
      prisma.policyRule.findUnique.mockResolvedValue(null);
      await expect(service.findById("missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("evaluatePOApproval", () => {
    it("should auto-approve when rule matches with autoApprove", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-auto",
          name: "Auto-approve under 50k",
          conditions: { maxAmount: 50_000_00 },
          autoApprove: true,
          requiredApprovals: 0,
          requiredRoles: [],
          priority: 10,
        },
      ]);

      const result = await service.evaluatePOApproval("org-1", 30_000_00);
      expect(result.requiresApproval).toBe(true);
      expect(result.autoApprove).toBe(true);
      expect(result.matchedRule?.name).toBe("Auto-approve under 50k");
    });

    it("should require approval for amount above threshold", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-high",
          name: "Large PO: 2 approvers",
          conditions: { minAmount: 200_000_00 },
          autoApprove: false,
          requiredApprovals: 2,
          requiredRoles: ["APPROVER", "FINANCE"],
          priority: 20,
        },
        {
          id: "rule-mid",
          name: "Medium PO: 1 approver",
          conditions: { minAmount: 50_000_01, maxAmount: 199_999_99 },
          autoApprove: false,
          requiredApprovals: 1,
          requiredRoles: ["APPROVER"],
          priority: 10,
        },
      ]);

      const result = await service.evaluatePOApproval("org-1", 300_000_00);
      expect(result.requiresApproval).toBe(true);
      expect(result.requiredApprovals).toBe(2);
      expect(result.requiredRoles).toEqual(["APPROVER", "FINANCE"]);
    });

    it("should match medium tier correctly", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-high",
          name: "Large PO",
          conditions: { minAmount: 200_000_00 },
          autoApprove: false,
          requiredApprovals: 2,
          requiredRoles: ["APPROVER", "FINANCE"],
          priority: 20,
        },
        {
          id: "rule-mid",
          name: "Medium PO",
          conditions: { minAmount: 50_000_01, maxAmount: 199_999_99 },
          autoApprove: false,
          requiredApprovals: 1,
          requiredRoles: ["APPROVER"],
          priority: 10,
        },
      ]);

      const result = await service.evaluatePOApproval("org-1", 100_000_00);
      expect(result.requiresApproval).toBe(true);
      expect(result.requiredApprovals).toBe(1);
      expect(result.requiredRoles).toEqual(["APPROVER"]);
    });

    it("should return no approval needed when no rules match", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);

      const result = await service.evaluatePOApproval("org-1", 10_000_00);
      expect(result.requiresApproval).toBe(false);
      expect(result.matchedRule).toBeNull();
    });
  });

  describe("evaluateLPFunding", () => {
    beforeEach(() => {
      // Default: no funded requests
      prisma.orgMembership.findMany.mockResolvedValue([
        { userId: "lp-user-1" },
      ]);
      prisma.earlyPaymentRequest.findMany.mockResolvedValue([]);
    });

    it("should allow funding when no policy exists", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);

      const result = await service.evaluateLPFunding(
        "lp-org",
        "buyer-org",
        "supplier-org",
        100_000_00,
      );
      expect(result.allowed).toBe(true);
      expect(result.limits).toBeNull();
    });

    it("should block funding when total exposure exceeded", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "funding-rule",
          conditions: {
            maxExposureTotal: 500_000_00,
            maxExposurePerBuyer: 0.4,
            maxExposurePerSupplier: 0.3,
          },
          priority: 10,
        },
      ]);

      // Simulate existing exposure of 450k
      prisma.earlyPaymentRequest.findMany.mockResolvedValue([
        {
          netAdvance: 450_000_00,
          purchaseOrder: { buyerId: "buyer-1", supplierId: "supplier-1" },
        },
      ]);
      prisma.orgMembership.findUnique.mockResolvedValue({
        organisationId: "buyer-org",
      });

      const result = await service.evaluateLPFunding(
        "lp-org",
        "buyer-org",
        "supplier-org",
        100_000_00,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Total exposure");
    });

    it("should block funding when buyer concentration exceeded", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "funding-rule",
          conditions: {
            maxExposureTotal: 5_000_000_00,
            maxExposurePerBuyer: 0.4,
            maxExposurePerSupplier: 0.3,
          },
          priority: 10,
        },
      ]);

      // Simulate 1.9M exposure to buyer-org (40% of 5M = 2M limit)
      prisma.earlyPaymentRequest.findMany.mockResolvedValue([
        {
          netAdvance: 1_900_000_00,
          purchaseOrder: { buyerId: "buyer-1", supplierId: "supplier-1" },
        },
      ]);
      prisma.orgMembership.findUnique.mockImplementation(({ where }: any) => {
        if (where.userId === "buyer-1")
          return Promise.resolve({ organisationId: "buyer-org" });
        if (where.userId === "supplier-1")
          return Promise.resolve({ organisationId: "supplier-org" });
        return Promise.resolve(null);
      });

      const result = await service.evaluateLPFunding(
        "lp-org",
        "buyer-org",
        "supplier-org",
        200_000_00, // Would push to 2.1M > 2M limit
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Buyer concentration");
    });

    it("should allow funding within limits", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "funding-rule",
          conditions: {
            maxExposureTotal: 5_000_000_00,
            maxExposurePerBuyer: 0.4,
            maxExposurePerSupplier: 0.3,
          },
          priority: 10,
        },
      ]);

      const result = await service.evaluateLPFunding(
        "lp-org",
        "buyer-org",
        "supplier-org",
        100_000_00,
      );
      expect(result.allowed).toBe(true);
    });

    it("should block non-whitelisted buyer", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "funding-rule",
          conditions: {
            maxExposureTotal: 5_000_000_00,
            whitelistedBuyerOrgIds: ["allowed-org-1", "allowed-org-2"],
          },
          priority: 10,
        },
      ]);

      const result = await service.evaluateLPFunding(
        "lp-org",
        "not-allowed-org",
        "supplier-org",
        100_000_00,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not in the LP's whitelist");
    });
  });

  describe("delete (soft)", () => {
    it("should deactivate a rule", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        active: true,
      });
      prisma.policyRule.update.mockResolvedValue({
        id: "rule-1",
        active: false,
      });

      const result = await service.delete("rule-1");
      expect(result.active).toBe(false);
    });

    it("should throw NotFoundException for missing rule", async () => {
      prisma.policyRule.findUnique.mockResolvedValue(null);
      await expect(service.delete("missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
