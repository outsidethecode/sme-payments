import { Test, TestingModule } from "@nestjs/testing";
import {
  PolicyTemplateService,
  PolicyTemplate,
} from "./policy-template.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

describe("PolicyTemplateService", () => {
  let service: PolicyTemplateService;
  let prisma: Record<string, any>;
  let ledger: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      policyRule: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      organisation: {
        findUnique: jest.fn(),
      },
      featureFlagOverride: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    ledger = {
      logEvent: jest.fn().mockResolvedValue({ id: "evt-1" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyTemplateService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledger },
      ],
    }).compile();

    service = module.get(PolicyTemplateService);
  });

  // ══════════════════════════════════════════════════════════════
  // getTemplates
  // ══════════════════════════════════════════════════════════════

  describe("getTemplates", () => {
    it("should return UK_BUYER templates (10 rules)", () => {
      const templates = service.getTemplates("BUYER", "UK");
      expect(templates.length).toBe(10);
      expect(templates[0].ruleType).toBe("PO_APPROVAL");
    });

    it("should return UK_SUPPLIER templates (4 rules)", () => {
      const templates = service.getTemplates("SUPPLIER", "UK");
      expect(templates.length).toBe(4);
      const types = new Set(templates.map((t) => t.ruleType));
      expect(types).toEqual(new Set(["SUPPLIER_ACCEPTANCE", "EARLY_PAYMENT"]));
    });

    it("should return UK_LP templates (4 rules)", () => {
      const templates = service.getTemplates("LIQUIDITY_PARTNER", "UK");
      expect(templates.length).toBe(4);
      const types = new Set(templates.map((t) => t.ruleType));
      expect(types).toEqual(new Set(["LP_FUNDING", "FUNDING_LIMIT"]));
    });

    it("should return KSA_BUYER templates (8 rules) with SAR amounts", () => {
      const templates = service.getTemplates("BUYER", "KSA");
      expect(templates.length).toBe(8);
      const poApproval = templates.find((t) => t.name.includes("50,000 SAR"));
      expect(poApproval).toBeDefined();
      expect(poApproval!.ruleType).toBe("PO_APPROVAL");
    });

    it("should return KSA_SUPPLIER templates (4 rules)", () => {
      const templates = service.getTemplates("SUPPLIER", "KSA");
      expect(templates.length).toBe(4);
      const types = new Set(templates.map((t) => t.ruleType));
      expect(types).toEqual(new Set(["SUPPLIER_ACCEPTANCE", "EARLY_PAYMENT"]));
    });

    it("should return KSA_LP templates (4 rules) with ujrah fee", () => {
      const templates = service.getTemplates("LIQUIDITY_PARTNER", "KSA");
      expect(templates.length).toBe(4);
      const limit = templates.find((t) => t.ruleType === "FUNDING_LIMIT");
      expect(limit).toBeDefined();
      expect((limit!.conditions as any).feeBps).toBe(250);
    });

    it("should return empty array for unknown org type", () => {
      const templates = service.getTemplates("UNKNOWN", "UK");
      expect(templates).toEqual([]);
    });

    it("should return empty array for unknown jurisdiction", () => {
      const templates = service.getTemplates("BUYER", "EU");
      expect(templates).toEqual([]);
    });

    it("should have all templates with required fields", () => {
      const allCombinations = [
        ["BUYER", "UK"],
        ["BUYER", "KSA"],
        ["SUPPLIER", "UK"],
        ["SUPPLIER", "KSA"],
        ["LIQUIDITY_PARTNER", "UK"],
        ["LIQUIDITY_PARTNER", "KSA"],
      ];
      for (const [orgType, jurisdiction] of allCombinations) {
        const templates = service.getTemplates(orgType, jurisdiction);
        for (const t of templates) {
          expect(t.ruleType).toBeDefined();
          expect(t.name).toBeTruthy();
          expect(t.conditions).toBeDefined();
          expect(typeof t.requiredApprovals).toBe("number");
          expect(Array.isArray(t.requiredRoles)).toBe(true);
          expect(typeof t.autoApprove).toBe("boolean");
          expect(typeof t.priority).toBe("number");
        }
      }
    });

    // ── Template Content Validation ────────────────────────────

    it("should have 3 PO_APPROVAL tiers in UK_BUYER", () => {
      const templates = service.getTemplates("BUYER", "UK");
      const poApproval = templates.filter((t) => t.ruleType === "PO_APPROVAL");
      expect(poApproval.length).toBe(3);
      // First tier should be auto-approve
      expect(
        poApproval.find((t) => t.autoApprove && t.priority === 10),
      ).toBeDefined();
      // Second tier: 1 approver
      expect(poApproval.find((t) => t.requiredApprovals === 1)).toBeDefined();
      // Third tier: 2 approvers
      expect(poApproval.find((t) => t.requiredApprovals === 2)).toBeDefined();
    });

    it("should have 3 PO_APPROVAL tiers in KSA_BUYER", () => {
      const templates = service.getTemplates("BUYER", "KSA");
      const poApproval = templates.filter((t) => t.ruleType === "PO_APPROVAL");
      expect(poApproval.length).toBe(3);
    });

    it("should have 3 LP_FUNDING tiers in UK_LP", () => {
      const templates = service.getTemplates("LIQUIDITY_PARTNER", "UK");
      const lpFunding = templates.filter((t) => t.ruleType === "LP_FUNDING");
      expect(lpFunding.length).toBe(3);
    });

    it("should have 3 LP_FUNDING tiers in KSA_LP", () => {
      const templates = service.getTemplates("LIQUIDITY_PARTNER", "KSA");
      const lpFunding = templates.filter((t) => t.ruleType === "LP_FUNDING");
      expect(lpFunding.length).toBe(3);
    });

    it("should have FUNDING_LIMIT in UK_LP with GBP defaults", () => {
      const templates = service.getTemplates("LIQUIDITY_PARTNER", "UK");
      const limit = templates.find((t) => t.ruleType === "FUNDING_LIMIT");
      expect(limit).toBeDefined();
      expect((limit!.conditions as any).maxExposureTotal).toBe(2_000_000_00);
      expect((limit!.conditions as any).feeBps).toBe(200);
    });

    it("should have FUNDING_LIMIT in KSA_LP with SAR defaults", () => {
      const templates = service.getTemplates("LIQUIDITY_PARTNER", "KSA");
      const limit = templates.find((t) => t.ruleType === "FUNDING_LIMIT");
      expect(limit).toBeDefined();
      expect((limit!.conditions as any).maxExposureTotal).toBe(5_000_000_00);
      expect((limit!.conditions as any).feeBps).toBe(250);
    });

    it("should have ESCROW_FUNDING and SETTLEMENT in UK_BUYER", () => {
      const templates = service.getTemplates("BUYER", "UK");
      const types = templates.map((t) => t.ruleType);
      expect(types).toContain("ESCROW_FUNDING");
      expect(types).toContain("SETTLEMENT");
      expect(types).toContain("DELIVERY_VERIFICATION");
    });

    it("should have ESCROW_FUNDING and SETTLEMENT in KSA_BUYER", () => {
      const templates = service.getTemplates("BUYER", "KSA");
      const types = templates.map((t) => t.ruleType);
      expect(types).toContain("ESCROW_FUNDING");
      expect(types).toContain("SETTLEMENT");
    });

    it("should have higher SAR amounts than GBP (~3.75x conversion)", () => {
      const ukBuyer = service.getTemplates("BUYER", "UK");
      const ksaBuyer = service.getTemplates("BUYER", "KSA");

      const ukAutoApprove = ukBuyer.find(
        (t) => t.ruleType === "PO_APPROVAL" && t.autoApprove,
      );
      const ksaAutoApprove = ksaBuyer.find(
        (t) => t.ruleType === "PO_APPROVAL" && t.autoApprove,
      );

      expect((ksaAutoApprove!.conditions as any).maxAmount).toBeGreaterThan(
        (ukAutoApprove!.conditions as any).maxAmount,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  // seedDefaultPolicies
  // ══════════════════════════════════════════════════════════════

  describe("seedDefaultPolicies", () => {
    it("should create all templates for a UK buyer", async () => {
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: `rule-${Math.random().toString(36).slice(2)}`,
        ...args.data,
      }));

      const result = await service.seedDefaultPolicies("org-1", "BUYER", "UK");
      expect(result.created).toBe(10);
      expect(result.skipped).toBe(0);
      expect(result.rules.length).toBe(10);
      expect(prisma.policyRule.create).toHaveBeenCalledTimes(10);
    });

    it("should create all templates for a KSA buyer", async () => {
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: `rule-${Math.random().toString(36).slice(2)}`,
        ...args.data,
      }));

      const result = await service.seedDefaultPolicies("org-1", "BUYER", "KSA");
      expect(result.created).toBe(8);
      expect(result.skipped).toBe(0);
    });

    it("should create all templates for UK supplier (4 rules)", async () => {
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-new",
        ...args.data,
      }));

      const result = await service.seedDefaultPolicies(
        "org-1",
        "SUPPLIER",
        "UK",
      );
      expect(result.created).toBe(4);
    });

    it("should create all templates for KSA supplier (4 rules)", async () => {
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-new",
        ...args.data,
      }));

      const result = await service.seedDefaultPolicies(
        "org-1",
        "SUPPLIER",
        "KSA",
      );
      expect(result.created).toBe(4);
    });

    it("should create all templates for UK LP (4 rules)", async () => {
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-new",
        ...args.data,
      }));

      const result = await service.seedDefaultPolicies(
        "org-1",
        "LIQUIDITY_PARTNER",
        "UK",
      );
      expect(result.created).toBe(4);
    });

    it("should create all templates for KSA LP (4 rules)", async () => {
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-new",
        ...args.data,
      }));

      const result = await service.seedDefaultPolicies(
        "org-1",
        "LIQUIDITY_PARTNER",
        "KSA",
      );
      expect(result.created).toBe(4);
    });

    it("should skip existing rules (idempotent)", async () => {
      let callCount = 0;
      prisma.policyRule.findFirst.mockImplementation(() => {
        callCount++;
        return callCount <= 3 ? { id: "existing" } : null;
      });
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "new-rule",
        ...args.data,
      }));

      const result = await service.seedDefaultPolicies("org-1", "BUYER", "UK");
      expect(result.skipped).toBe(3);
      expect(result.created).toBe(7);
    });

    it("should log audit event on creation", async () => {
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-1",
        ...args.data,
      }));

      await service.seedDefaultPolicies("org-1", "SUPPLIER", "UK");
      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "POLICY_TEMPLATES_SEEDED",
          entityType: "ORGANISATION",
          entityId: "org-1",
          payload: expect.objectContaining({
            orgType: "SUPPLIER",
            jurisdiction: "UK",
            templatesCreated: 4,
            templatesSkipped: 0,
          }),
        }),
      );
    });

    it("should not log audit if no rules created", async () => {
      prisma.policyRule.findFirst.mockResolvedValue({ id: "existing" });

      await service.seedDefaultPolicies("org-1", "BUYER", "UK");
      expect(ledger.logEvent).not.toHaveBeenCalled();
    });

    it("should return 0 for unknown org type", async () => {
      const result = await service.seedDefaultPolicies(
        "org-1",
        "UNKNOWN",
        "UK",
      );
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("should return 0 for unknown jurisdiction", async () => {
      const result = await service.seedDefaultPolicies("org-1", "BUYER", "EU");
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("should not throw when audit logging fails", async () => {
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-1",
        ...args.data,
      }));
      ledger.logEvent.mockRejectedValue(new Error("Ledger down"));

      const result = await service.seedDefaultPolicies(
        "org-1",
        "SUPPLIER",
        "UK",
      );
      expect(result.created).toBe(4);
    });

    it("should check for existing rules by name and org", async () => {
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-1",
        ...args.data,
      }));

      await service.seedDefaultPolicies("org-1", "SUPPLIER", "UK");

      // Verify findFirst was called with correct where clause
      expect(prisma.policyRule.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organisationId: "org-1",
            active: true,
          }),
        }),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  // resetToDefaults
  // ══════════════════════════════════════════════════════════════

  describe("resetToDefaults", () => {
    it("should deactivate existing rules and re-seed", async () => {
      prisma.policyRule.updateMany.mockResolvedValue({ count: 5 });
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-new",
        ...args.data,
      }));

      const result = await service.resetToDefaults("org-1", "SUPPLIER", "UK");
      expect(prisma.policyRule.updateMany).toHaveBeenCalledWith({
        where: { organisationId: "org-1", active: true },
        data: { active: false },
      });
      expect(result.created).toBe(4);
    });

    it("should log POLICY_RULES_RESET audit event", async () => {
      prisma.policyRule.updateMany.mockResolvedValue({ count: 3 });
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-new",
        ...args.data,
      }));

      await service.resetToDefaults("org-1", "BUYER", "UK");

      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "POLICY_RULES_RESET",
          payload: expect.objectContaining({
            deactivatedCount: 3,
            orgType: "BUYER",
            jurisdiction: "UK",
          }),
        }),
      );
    });

    it("should reset KSA LP policies correctly", async () => {
      prisma.policyRule.updateMany.mockResolvedValue({ count: 2 });
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-new",
        ...args.data,
      }));

      const result = await service.resetToDefaults(
        "org-1",
        "LIQUIDITY_PARTNER",
        "KSA",
      );
      expect(result.created).toBe(4);
    });

    it("should handle reset when no existing rules", async () => {
      prisma.policyRule.updateMany.mockResolvedValue({ count: 0 });
      prisma.policyRule.findFirst.mockResolvedValue(null);
      prisma.policyRule.create.mockImplementation((args: any) => ({
        id: "rule-new",
        ...args.data,
      }));

      const result = await service.resetToDefaults("org-1", "SUPPLIER", "UK");
      expect(result.created).toBe(4);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // getPilotReadiness
  // ══════════════════════════════════════════════════════════════

  describe("getPilotReadiness", () => {
    it("should return null for non-existent org", async () => {
      prisma.organisation.findUnique.mockResolvedValue(null);
      const result = await service.getPilotReadiness("no-org");
      expect(result).toBeNull();
    });

    it("should return 0% readiness for bare org", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Test Ltd",
        type: "BUYER",
        jurisdiction: "UK",
        onboardingStatus: "NOT_STARTED",
        bankIban: null,
        termsAcceptedAt: null,
        members: [],
      });
      prisma.policyRule.findMany.mockResolvedValue([]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([]);

      const result = await service.getPilotReadiness("org-1");
      expect(result).toBeDefined();
      expect(result!.readyPercentage).toBe(0);
      expect(result!.checks.filter((c) => c.complete)).toHaveLength(0);
    });

    it("should return 100% for fully set up org", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Test Ltd",
        type: "BUYER",
        jurisdiction: "UK",
        onboardingStatus: "COMPLETED",
        bankIban: "GB29NWBK60161331926819",
        termsAcceptedAt: new Date(),
        members: [
          {
            orgRole: "OWNER",
            user: { id: "u1", name: "Owner", role: "BUYER" },
          },
          {
            orgRole: "APPROVER",
            user: { id: "u2", name: "Approver", role: "BUYER" },
          },
          {
            orgRole: "FINANCE",
            user: { id: "u3", name: "Finance", role: "BUYER" },
          },
        ],
      });
      prisma.policyRule.findMany.mockResolvedValue([
        { id: "r1", active: true },
      ]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([
        { flag: "POLICY_ENGINE", enabled: true },
      ]);

      const result = await service.getPilotReadiness("org-1");
      expect(result!.readyPercentage).toBe(100);
      expect(result!.checks.every((c) => c.complete)).toBe(true);
    });

    it("should return partial readiness", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Test",
        type: "BUYER",
        jurisdiction: "UK",
        onboardingStatus: "COMPLETED",
        bankIban: "GB29NWBK60161331926819",
        termsAcceptedAt: new Date(),
        members: [
          { orgRole: "OWNER", user: { id: "u1", name: "O", role: "BUYER" } },
        ],
      });
      prisma.policyRule.findMany.mockResolvedValue([
        { id: "r1", active: true },
      ]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([]);

      const result = await service.getPilotReadiness("org-1");
      // 5/8 complete: kyb, bank, onboarding, policy_rules, terms_accepted
      // missing: has_approver, has_finance, feature_flags
      expect(result!.readyPercentage).toBe(63); // 5/8 = 62.5 → 63
    });

    it("should check for APPROVER member", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Test",
        type: "BUYER",
        jurisdiction: "UK",
        onboardingStatus: "COMPLETED",
        bankIban: "GB29NWBK60161331926819",
        termsAcceptedAt: new Date(),
        members: [
          {
            orgRole: "APPROVER",
            user: { id: "u1", name: "A", role: "BUYER" },
          },
        ],
      });
      prisma.policyRule.findMany.mockResolvedValue([
        { id: "r1", active: true },
      ]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([]);

      const result = await service.getPilotReadiness("org-1");
      const approverCheck = result!.checks.find(
        (c) => c.key === "has_approver",
      );
      expect(approverCheck!.complete).toBe(true);
    });

    it("should check for FINANCE member", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Test",
        type: "BUYER",
        jurisdiction: "UK",
        onboardingStatus: "COMPLETED",
        bankIban: "GB29NWBK60161331926819",
        termsAcceptedAt: new Date(),
        members: [
          {
            orgRole: "FINANCE",
            user: { id: "u1", name: "F", role: "BUYER" },
          },
        ],
      });
      prisma.policyRule.findMany.mockResolvedValue([
        { id: "r1", active: true },
      ]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([]);

      const result = await service.getPilotReadiness("org-1");
      const financeCheck = result!.checks.find((c) => c.key === "has_finance");
      expect(financeCheck!.complete).toBe(true);
    });

    it("should detect KYB_VERIFIED as kyb complete", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Test",
        type: "BUYER",
        jurisdiction: "UK",
        onboardingStatus: "KYB_VERIFIED",
        bankIban: null,
        termsAcceptedAt: null,
        members: [],
      });
      prisma.policyRule.findMany.mockResolvedValue([]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([]);

      const result = await service.getPilotReadiness("org-1");
      const kybCheck = result!.checks.find((c) => c.key === "kyb_verified");
      expect(kybCheck!.complete).toBe(true);
      // But onboarding_complete should be false (KYB_VERIFIED != COMPLETED)
      const onboardCheck = result!.checks.find(
        (c) => c.key === "onboarding_complete",
      );
      expect(onboardCheck!.complete).toBe(false);
    });

    it("should return 8 checks total", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Test",
        type: "BUYER",
        jurisdiction: "UK",
        onboardingStatus: "NOT_STARTED",
        bankIban: null,
        termsAcceptedAt: null,
        members: [],
      });
      prisma.policyRule.findMany.mockResolvedValue([]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([]);

      const result = await service.getPilotReadiness("org-1");
      expect(result!.checks.length).toBe(8);
    });

    it("should include org metadata in response", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Al-Rajhi Trading Co",
        type: "BUYER",
        jurisdiction: "KSA",
        onboardingStatus: "NOT_STARTED",
        bankIban: null,
        termsAcceptedAt: null,
        members: [],
      });
      prisma.policyRule.findMany.mockResolvedValue([]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([]);

      const result = await service.getPilotReadiness("org-1");
      expect(result!.organisationId).toBe("org-1");
      expect(result!.organisationName).toBe("Al-Rajhi Trading Co");
      expect(result!.orgType).toBe("BUYER");
      expect(result!.jurisdiction).toBe("KSA");
    });

    it("should check feature flag POLICY_ENGINE", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Test",
        type: "BUYER",
        jurisdiction: "UK",
        onboardingStatus: "NOT_STARTED",
        bankIban: null,
        termsAcceptedAt: null,
        members: [],
      });
      prisma.policyRule.findMany.mockResolvedValue([]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([
        { flag: "POLICY_ENGINE", enabled: true },
      ]);

      const result = await service.getPilotReadiness("org-1");
      const flagCheck = result!.checks.find((c) => c.key === "feature_flags");
      expect(flagCheck!.complete).toBe(true);
    });

    it("should mark feature_flags incomplete when flag is disabled", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Test",
        type: "BUYER",
        jurisdiction: "UK",
        onboardingStatus: "NOT_STARTED",
        bankIban: null,
        termsAcceptedAt: null,
        members: [],
      });
      prisma.policyRule.findMany.mockResolvedValue([]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([
        { flag: "POLICY_ENGINE", enabled: false },
      ]);

      const result = await service.getPilotReadiness("org-1");
      const flagCheck = result!.checks.find((c) => c.key === "feature_flags");
      expect(flagCheck!.complete).toBe(false);
    });

    it("should count no policy rules as incomplete", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Test",
        type: "BUYER",
        jurisdiction: "UK",
        onboardingStatus: "COMPLETED",
        bankIban: "GB29NWBK60161331926819",
        termsAcceptedAt: new Date(),
        members: [],
      });
      prisma.policyRule.findMany.mockResolvedValue([]);
      prisma.featureFlagOverride.findMany.mockResolvedValue([]);

      const result = await service.getPilotReadiness("org-1");
      const policyCheck = result!.checks.find((c) => c.key === "policy_rules");
      expect(policyCheck!.complete).toBe(false);
    });
  });
});
