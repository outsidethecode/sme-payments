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

  // ══════════════════════════════════════════════════════════════
  // CREATE
  // ══════════════════════════════════════════════════════════════

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

    it("should default requiredApprovals to 1 and autoApprove to false", async () => {
      const input = {
        organisationId: "org-1",
        ruleType: "ESCROW_FUNDING" as const,
        name: "Manual escrow",
        conditions: { minAmount: 100_000_00 },
      };
      prisma.policyRule.create.mockResolvedValue({
        id: "rule-2",
        ...input,
        requiredApprovals: 1,
        autoApprove: false,
        requiredRoles: [],
        priority: 0,
      });

      await service.create(input);
      expect(prisma.policyRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requiredApprovals: 1,
          autoApprove: false,
          requiredRoles: [],
          priority: 0,
        }),
      });
    });

    it("should log audit event on creation (fire-and-forget)", async () => {
      const input = {
        organisationId: "org-1",
        ruleType: "PO_APPROVAL" as const,
        name: "Test rule",
        conditions: { maxAmount: 10_000_00 },
      };
      prisma.policyRule.create.mockResolvedValue({
        id: "rule-1",
        ...input,
        requiredApprovals: 1,
        autoApprove: false,
        priority: 0,
      });

      await service.create(input);

      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "POLICY_RULE",
          eventType: "POLICY_RULE_CREATED",
          payload: expect.objectContaining({
            ruleType: "PO_APPROVAL",
            name: "Test rule",
          }),
        }),
      );
    });

    it("should not throw when audit logging fails", async () => {
      ledger.logEvent.mockRejectedValue(new Error("Ledger down"));
      const input = {
        organisationId: "org-1",
        ruleType: "PO_APPROVAL" as const,
        name: "Test",
        conditions: {},
      };
      prisma.policyRule.create.mockResolvedValue({
        id: "rule-1",
        ...input,
        requiredApprovals: 1,
        autoApprove: false,
        priority: 0,
      });

      const result = await service.create(input);
      expect(result.id).toBe("rule-1");
    });

    it("should pass metadata through to Prisma", async () => {
      const input = {
        organisationId: "org-1",
        ruleType: "LP_FUNDING" as const,
        name: "LP rule with meta",
        conditions: { maxAmount: 500_000_00 },
        metadata: { reason: "pilot", createdBy: "admin@test.com" },
      };
      prisma.policyRule.create.mockResolvedValue({ id: "rule-1", ...input });

      await service.create(input);
      expect(prisma.policyRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: { reason: "pilot", createdBy: "admin@test.com" },
        }),
      });
    });

    it("should set custom requiredApprovals and requiredRoles", async () => {
      const input = {
        organisationId: "org-1",
        ruleType: "PO_APPROVAL" as const,
        name: "Two approvers",
        conditions: { minAmount: 50_000_00 },
        requiredApprovals: 2,
        requiredRoles: ["APPROVER", "FINANCE"],
        autoApprove: false,
        priority: 5,
      };
      prisma.policyRule.create.mockResolvedValue({ id: "rule-1", ...input });

      await service.create(input);
      expect(prisma.policyRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requiredApprovals: 2,
          requiredRoles: ["APPROVER", "FINANCE"],
        }),
      });
    });
  });

  // ══════════════════════════════════════════════════════════════
  // FIND BY ID
  // ══════════════════════════════════════════════════════════════

  describe("findById", () => {
    it("should return rule with organisation", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        name: "Test Rule",
        organisation: { id: "org-1", name: "Acme" },
      });
      const result = await service.findById("rule-1");
      expect(result.name).toBe("Test Rule");
      expect(result.organisation.name).toBe("Acme");
    });

    it("should throw NotFoundException when rule not found", async () => {
      prisma.policyRule.findUnique.mockResolvedValue(null);
      await expect(service.findById("missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should include organisation select in query", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        name: "R",
      });
      await service.findById("rule-1");
      expect(prisma.policyRule.findUnique).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        include: { organisation: { select: { id: true, name: true } } },
      });
    });
  });

  // ══════════════════════════════════════════════════════════════
  // FIND BY ORG
  // ══════════════════════════════════════════════════════════════

  describe("findByOrg", () => {
    it("should return active rules for org ordered by priority desc", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        { id: "r1", priority: 20 },
        { id: "r2", priority: 10 },
      ]);

      const result = await service.findByOrg("org-1");
      expect(result).toHaveLength(2);
      expect(prisma.policyRule.findMany).toHaveBeenCalledWith({
        where: { organisationId: "org-1", active: true },
        orderBy: { priority: "desc" },
      });
    });

    it("should filter by ruleType when provided", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);

      await service.findByOrg("org-1", "PO_APPROVAL" as any);
      expect(prisma.policyRule.findMany).toHaveBeenCalledWith({
        where: {
          organisationId: "org-1",
          active: true,
          ruleType: "PO_APPROVAL",
        },
        orderBy: { priority: "desc" },
      });
    });

    it("should not include ruleType when not provided", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);

      await service.findByOrg("org-1");
      expect(prisma.policyRule.findMany).toHaveBeenCalledWith({
        where: { organisationId: "org-1", active: true },
        orderBy: { priority: "desc" },
      });
    });

    it("should return empty array when no rules exist", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);
      const result = await service.findByOrg("org-1");
      expect(result).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // UPDATE
  // ══════════════════════════════════════════════════════════════

  describe("update", () => {
    it("should update a rule name", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        organisationId: "org-1",
        name: "Old Name",
        conditions: { maxAmount: 10_000_00 },
        requiredApprovals: 1,
        autoApprove: false,
        active: true,
        priority: 5,
      });
      prisma.policyRule.update.mockResolvedValue({
        id: "rule-1",
        name: "New Name",
      });

      const result = await service.update("rule-1", { name: "New Name" });
      expect(result.name).toBe("New Name");
      expect(prisma.policyRule.update).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: { name: "New Name" },
      });
    });

    it("should throw NotFoundException when rule not found", async () => {
      prisma.policyRule.findUnique.mockResolvedValue(null);
      await expect(service.update("missing", { name: "X" })).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should update multiple fields at once", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        organisationId: "org-1",
        name: "Old",
        conditions: {},
        requiredApprovals: 1,
        autoApprove: false,
        active: true,
        priority: 5,
      });
      prisma.policyRule.update.mockResolvedValue({ id: "rule-1" });

      await service.update("rule-1", {
        name: "Updated",
        conditions: { minAmount: 100_00 },
        requiredApprovals: 2,
        requiredRoles: ["APPROVER", "FINANCE"],
        autoApprove: false,
        priority: 20,
        active: false,
      });

      expect(prisma.policyRule.update).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: {
          name: "Updated",
          conditions: { minAmount: 100_00 },
          requiredApprovals: 2,
          requiredRoles: ["APPROVER", "FINANCE"],
          autoApprove: false,
          priority: 20,
          active: false,
        },
      });
    });

    it("should only include defined fields in update data", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        organisationId: "org-1",
        name: "Old",
        conditions: {},
        requiredApprovals: 1,
        autoApprove: false,
        active: true,
        priority: 5,
      });
      prisma.policyRule.update.mockResolvedValue({ id: "rule-1" });

      await service.update("rule-1", { priority: 99 });

      expect(prisma.policyRule.update).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: { priority: 99 },
      });
    });

    it("should log before/after audit trail", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        organisationId: "org-1",
        name: "Old Name",
        conditions: { maxAmount: 10_000_00 },
        requiredApprovals: 1,
        autoApprove: false,
        active: true,
        priority: 5,
      });
      prisma.policyRule.update.mockResolvedValue({ id: "rule-1" });

      await service.update("rule-1", { name: "New Name" });

      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "POLICY_RULE",
          entityId: "rule-1",
          eventType: "POLICY_RULE_UPDATED",
          payload: expect.objectContaining({
            organisationId: "org-1",
            before: expect.objectContaining({ name: "Old Name" }),
            after: { name: "New Name" },
          }),
        }),
      );
    });

    it("should handle metadata update", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        organisationId: "org-1",
        name: "R",
        conditions: {},
        requiredApprovals: 1,
        autoApprove: false,
        active: true,
        priority: 0,
      });
      prisma.policyRule.update.mockResolvedValue({ id: "rule-1" });

      await service.update("rule-1", { metadata: { note: "updated" } });

      expect(prisma.policyRule.update).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: { metadata: { note: "updated" } },
      });
    });

    it("should not throw when audit logging fails on update", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        organisationId: "org-1",
        name: "R",
        conditions: {},
        requiredApprovals: 1,
        autoApprove: false,
        active: true,
        priority: 0,
      });
      prisma.policyRule.update.mockResolvedValue({ id: "rule-1" });
      ledger.logEvent.mockRejectedValue(new Error("Ledger down"));

      const result = await service.update("rule-1", { name: "New" });
      expect(result.id).toBe("rule-1");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // DELETE (SOFT)
  // ══════════════════════════════════════════════════════════════

  describe("delete (soft)", () => {
    it("should deactivate a rule", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        organisationId: "org-1",
        ruleType: "PO_APPROVAL",
        name: "Test Rule",
        active: true,
      });
      prisma.policyRule.update.mockResolvedValue({
        id: "rule-1",
        active: false,
      });

      const result = await service.delete("rule-1");
      expect(result.active).toBe(false);
      expect(prisma.policyRule.update).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: { active: false },
      });
    });

    it("should throw NotFoundException for missing rule", async () => {
      prisma.policyRule.findUnique.mockResolvedValue(null);
      await expect(service.delete("missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should log deletion audit trail", async () => {
      prisma.policyRule.findUnique.mockResolvedValue({
        id: "rule-1",
        organisationId: "org-1",
        ruleType: "SETTLEMENT",
        name: "Settlement Rule",
        active: true,
      });
      prisma.policyRule.update.mockResolvedValue({
        id: "rule-1",
        active: false,
      });

      await service.delete("rule-1");

      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "POLICY_RULE",
          entityId: "rule-1",
          eventType: "POLICY_RULE_DELETED",
          payload: expect.objectContaining({
            organisationId: "org-1",
            ruleType: "SETTLEMENT",
            name: "Settlement Rule",
          }),
        }),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  // EVALUATE PO APPROVAL
  // ══════════════════════════════════════════════════════════════

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
      expect(result.autoApprove).toBe(true);
      expect(result.requiredApprovals).toBe(0);
      expect(result.requiredRoles).toEqual([]);
      expect(result.matchedRule).toBeNull();
    });

    it("should skip rule when amount is below minAmount", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "High tier only",
          conditions: { minAmount: 500_000_00 },
          autoApprove: false,
          requiredApprovals: 2,
          requiredRoles: ["APPROVER"],
          priority: 10,
        },
      ]);

      const result = await service.evaluatePOApproval("org-1", 100_000_00);
      expect(result.requiresApproval).toBe(false);
    });

    it("should skip rule when amount exceeds maxAmount", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Small tier only",
          conditions: { maxAmount: 10_000_00 },
          autoApprove: true,
          requiredApprovals: 0,
          requiredRoles: [],
          priority: 10,
        },
      ]);

      const result = await service.evaluatePOApproval("org-1", 50_000_00);
      expect(result.requiresApproval).toBe(false);
    });

    it("should match first rule when multiple rules match (priority order)", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-high-p",
          name: "High priority",
          conditions: {},
          autoApprove: true,
          requiredApprovals: 0,
          requiredRoles: [],
          priority: 20,
        },
        {
          id: "rule-low-p",
          name: "Low priority",
          conditions: {},
          autoApprove: false,
          requiredApprovals: 2,
          requiredRoles: ["APPROVER"],
          priority: 5,
        },
      ]);

      const result = await service.evaluatePOApproval("org-1", 100_00);
      expect(result.matchedRule?.name).toBe("High priority");
      expect(result.autoApprove).toBe(true);
    });

    it("should match rule with only maxAmount (no minAmount)", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Up to 100k",
          conditions: { maxAmount: 100_000_00 },
          autoApprove: true,
          requiredApprovals: 0,
          requiredRoles: [],
          priority: 10,
        },
      ]);

      const result = await service.evaluatePOApproval("org-1", 50_000_00);
      expect(result.requiresApproval).toBe(true);
      expect(result.autoApprove).toBe(true);
    });

    it("should match rule with empty conditions (catch-all)", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Catch-all",
          conditions: {},
          autoApprove: false,
          requiredApprovals: 1,
          requiredRoles: ["OWNER"],
          priority: 1,
        },
      ]);

      const result = await service.evaluatePOApproval("org-1", 1);
      expect(result.requiresApproval).toBe(true);
      expect(result.matchedRule?.name).toBe("Catch-all");
    });

    it("should query only PO_APPROVAL active rules", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);

      await service.evaluatePOApproval("org-1", 100_00);
      expect(prisma.policyRule.findMany).toHaveBeenCalledWith({
        where: {
          organisationId: "org-1",
          ruleType: "PO_APPROVAL",
          active: true,
        },
        orderBy: { priority: "desc" },
      });
    });

    it("should handle exact boundary amounts (minAmount === amount)", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Min 50k",
          conditions: { minAmount: 50_000_00, maxAmount: 100_000_00 },
          autoApprove: false,
          requiredApprovals: 1,
          requiredRoles: ["APPROVER"],
          priority: 10,
        },
      ]);

      const result = await service.evaluatePOApproval("org-1", 50_000_00);
      expect(result.requiresApproval).toBe(true);
      expect(result.matchedRule?.name).toBe("Min 50k");
    });

    it("should handle exact boundary amounts (maxAmount === amount)", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "rule-1",
          name: "Up to 50k",
          conditions: { minAmount: 0, maxAmount: 50_000_00 },
          autoApprove: true,
          requiredApprovals: 0,
          requiredRoles: [],
          priority: 10,
        },
      ]);

      const result = await service.evaluatePOApproval("org-1", 50_000_00);
      expect(result.requiresApproval).toBe(true);
      expect(result.autoApprove).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // GET PO LIMITS
  // ══════════════════════════════════════════════════════════════

  describe("getPOLimits", () => {
    it("should return policy-based limits when PO_ORDER_LIMITS rule exists", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "limits-rule",
          name: "KSA limits",
          conditions: { minAmount: 1_875_00, maxAmount: 93_750_000 },
          priority: 1,
        },
      ]);

      const result = await service.getPOLimits("org-1", "SAR");
      expect(result.minAmount).toBe(1_875_00);
      expect(result.maxAmount).toBe(93_750_000);
      expect(result.source).toBe("KSA limits");
    });

    it("should return GBP defaults when no rule exists", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);

      const result = await service.getPOLimits("org-1", "GBP");
      expect(result.minAmount).toBe(500_00);
      expect(result.maxAmount).toBe(250_000_00);
      expect(result.source).toBe("platform-default");
    });

    it("should return SAR defaults when no rule exists", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);

      const result = await service.getPOLimits("org-1", "SAR");
      expect(result.minAmount).toBe(1_875_00);
      expect(result.maxAmount).toBe(937_500_00);
      expect(result.source).toBe("platform-default");
    });

    it("should fallback to GBP defaults for unknown currency", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);

      const result = await service.getPOLimits("org-1", "EUR");
      expect(result.minAmount).toBe(500_00);
      expect(result.maxAmount).toBe(250_000_00);
      expect(result.source).toBe("platform-default");
    });

    it("should use highest priority rule when multiple exist", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "high",
          name: "High priority limits",
          conditions: { minAmount: 100_00, maxAmount: 500_000_00 },
          priority: 10,
        },
        {
          id: "low",
          name: "Low priority limits",
          conditions: { minAmount: 0, maxAmount: 100_000_00 },
          priority: 1,
        },
      ]);

      const result = await service.getPOLimits("org-1", "GBP");
      expect(result.source).toBe("High priority limits");
    });

    it("should default minAmount to 0 when not in conditions", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "r1",
          name: "Max only",
          conditions: { maxAmount: 100_000_00 },
          priority: 1,
        },
      ]);

      const result = await service.getPOLimits("org-1", "GBP");
      expect(result.minAmount).toBe(0);
    });

    it("should default maxAmount to MAX_SAFE_INTEGER when not in conditions", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "r1",
          name: "Min only",
          conditions: { minAmount: 500_00 },
          priority: 1,
        },
      ]);

      const result = await service.getPOLimits("org-1", "GBP");
      expect(result.maxAmount).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("should query PO_ORDER_LIMITS active rules", async () => {
      prisma.policyRule.findMany.mockResolvedValue([]);

      await service.getPOLimits("org-1", "GBP");
      expect(prisma.policyRule.findMany).toHaveBeenCalledWith({
        where: {
          organisationId: "org-1",
          ruleType: "PO_ORDER_LIMITS",
          active: true,
        },
        orderBy: { priority: "desc" },
      });
    });
  });

  // ══════════════════════════════════════════════════════════════
  // EVALUATE LP FUNDING
  // ══════════════════════════════════════════════════════════════

  describe("evaluateLPFunding", () => {
    beforeEach(() => {
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
        200_000_00,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Buyer concentration");
    });

    it("should block funding when supplier concentration exceeded", async () => {
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

      prisma.earlyPaymentRequest.findMany.mockResolvedValue([
        {
          netAdvance: 1_400_000_00,
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
        200_000_00,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Supplier concentration");
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

    it("should block non-whitelisted supplier", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "funding-rule",
          conditions: {
            maxExposureTotal: 5_000_000_00,
            whitelistedSupplierOrgIds: ["allowed-supp-1"],
          },
          priority: 10,
        },
      ]);

      const result = await service.evaluateLPFunding(
        "lp-org",
        "buyer-org",
        "not-allowed-supplier",
        100_000_00,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not in the LP's whitelist");
    });

    it("should allow whitelisted buyer", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "funding-rule",
          conditions: {
            maxExposureTotal: 5_000_000_00,
            whitelistedBuyerOrgIds: ["buyer-org"],
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

    it("should skip whitelist check when list is empty", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "funding-rule",
          conditions: {
            maxExposureTotal: 5_000_000_00,
            whitelistedBuyerOrgIds: [],
          },
          priority: 10,
        },
      ]);

      const result = await service.evaluateLPFunding(
        "lp-org",
        "any-buyer",
        "any-supplier",
        100_000_00,
      );
      expect(result.allowed).toBe(true);
    });

    it("should skip buyer concentration check when buyerOrgId is null", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "funding-rule",
          conditions: {
            maxExposureTotal: 5_000_000_00,
            maxExposurePerBuyer: 0.4,
          },
          priority: 10,
        },
      ]);

      const result = await service.evaluateLPFunding(
        "lp-org",
        null,
        "supplier-org",
        100_000_00,
      );
      expect(result.allowed).toBe(true);
    });

    it("should skip supplier concentration check when supplierOrgId is null", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "funding-rule",
          conditions: {
            maxExposureTotal: 5_000_000_00,
            maxExposurePerSupplier: 0.3,
          },
          priority: 10,
        },
      ]);

      const result = await service.evaluateLPFunding(
        "lp-org",
        "buyer-org",
        null,
        100_000_00,
      );
      expect(result.allowed).toBe(true);
    });

    it("should return current exposure data", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "funding-rule",
          conditions: { maxExposureTotal: 10_000_000_00 },
          priority: 10,
        },
      ]);

      prisma.earlyPaymentRequest.findMany.mockResolvedValue([
        {
          netAdvance: 200_000_00,
          purchaseOrder: { buyerId: "buyer-user", supplierId: "supp-user" },
        },
      ]);
      prisma.orgMembership.findUnique.mockImplementation(({ where }: any) => {
        if (where.userId === "buyer-user")
          return Promise.resolve({ organisationId: "buyer-org" });
        if (where.userId === "supp-user")
          return Promise.resolve({ organisationId: "supplier-org" });
        return Promise.resolve(null);
      });

      const result = await service.evaluateLPFunding(
        "lp-org",
        "buyer-org",
        "supplier-org",
        50_000_00,
      );
      expect(result.allowed).toBe(true);
      expect(result.currentExposure.total).toBe(200_000_00);
    });

    it("should use highest priority FUNDING_LIMIT rule", async () => {
      prisma.policyRule.findMany.mockResolvedValue([
        {
          id: "high",
          conditions: { maxExposureTotal: 500_000_00 },
          priority: 10,
        },
        {
          id: "low",
          conditions: { maxExposureTotal: 10_000_000_00 },
          priority: 1,
        },
      ]);

      // The first rule (highest priority) has 500k limit
      const result = await service.evaluateLPFunding(
        "lp-org",
        "buyer-org",
        "supplier-org",
        600_000_00, // exceeds 500k
      );
      expect(result.allowed).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // CALCULATE LP EXPOSURE
  // ══════════════════════════════════════════════════════════════

  describe("calculateLPExposure", () => {
    it("should return zero exposure when no funded requests exist", async () => {
      prisma.orgMembership.findMany.mockResolvedValue([
        { userId: "lp-user-1" },
      ]);
      prisma.earlyPaymentRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateLPExposure("lp-org");
      expect(result.total).toBe(0);
      expect(result.count).toBe(0);
      expect(result.perBuyer).toEqual({});
      expect(result.perSupplier).toEqual({});
    });

    it("should sum up funded requests and group by buyer/supplier org", async () => {
      prisma.orgMembership.findMany.mockResolvedValue([
        { userId: "lp-user-1" },
      ]);
      prisma.earlyPaymentRequest.findMany.mockResolvedValue([
        {
          netAdvance: 100_000_00,
          purchaseOrder: { buyerId: "buyer-u1", supplierId: "supp-u1" },
        },
        {
          netAdvance: 200_000_00,
          purchaseOrder: { buyerId: "buyer-u1", supplierId: "supp-u2" },
        },
        {
          netAdvance: 50_000_00,
          purchaseOrder: { buyerId: "buyer-u2", supplierId: "supp-u1" },
        },
      ]);
      prisma.orgMembership.findUnique.mockImplementation(({ where }: any) => {
        const map: Record<string, string> = {
          "buyer-u1": "buyer-org-1",
          "buyer-u2": "buyer-org-2",
          "supp-u1": "supplier-org-1",
          "supp-u2": "supplier-org-2",
        };
        const orgId = map[where.userId];
        return Promise.resolve(orgId ? { organisationId: orgId } : null);
      });

      const result = await service.calculateLPExposure("lp-org");
      expect(result.total).toBe(350_000_00);
      expect(result.count).toBe(3);
      expect(result.perBuyer["buyer-org-1"]).toBe(300_000_00);
      expect(result.perBuyer["buyer-org-2"]).toBe(50_000_00);
      expect(result.perSupplier["supplier-org-1"]).toBe(150_000_00);
      expect(result.perSupplier["supplier-org-2"]).toBe(200_000_00);
    });

    it("should handle members with no org membership", async () => {
      prisma.orgMembership.findMany.mockResolvedValue([
        { userId: "lp-user-1" },
      ]);
      prisma.earlyPaymentRequest.findMany.mockResolvedValue([
        {
          netAdvance: 100_000_00,
          purchaseOrder: { buyerId: "orphan", supplierId: "orphan2" },
        },
      ]);
      prisma.orgMembership.findUnique.mockResolvedValue(null);

      const result = await service.calculateLPExposure("lp-org");
      expect(result.total).toBe(100_000_00);
      expect(result.count).toBe(1);
      expect(result.perBuyer).toEqual({});
      expect(result.perSupplier).toEqual({});
    });

    it("should query FUNDED status early payments for LP members", async () => {
      prisma.orgMembership.findMany.mockResolvedValue([
        { userId: "u1" },
        { userId: "u2" },
      ]);
      prisma.earlyPaymentRequest.findMany.mockResolvedValue([]);

      await service.calculateLPExposure("lp-org");

      expect(prisma.earlyPaymentRequest.findMany).toHaveBeenCalledWith({
        where: {
          liquidityPartnerId: { in: ["u1", "u2"] },
          status: "FUNDED",
        },
        include: {
          purchaseOrder: { select: { buyerId: true, supplierId: true } },
        },
      });
    });

    it("should return zero when LP org has no members", async () => {
      prisma.orgMembership.findMany.mockResolvedValue([]);
      prisma.earlyPaymentRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateLPExposure("lp-org");
      expect(result.total).toBe(0);
      expect(result.count).toBe(0);
    });
  });
});
