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

  // ── getTemplates ──────────────────────────────────────────

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

    it("should return KSA_BUYER templates with SAR amounts", () => {
      const templates = service.getTemplates("BUYER", "KSA");
      expect(templates.length).toBeGreaterThan(0);
      const poApproval = templates.find((t) => t.name.includes("50,000 SAR"));
      expect(poApproval).toBeDefined();
      expect(poApproval!.ruleType).toBe("PO_APPROVAL");
    });

    it("should return KSA_SUPPLIER templates (4 rules)", () => {
      const templates = service.getTemplates("SUPPLIER", "KSA");
      expect(templates.length).toBe(4);
    });

    it("should return KSA_LP templates with ujrah fee", () => {
      const templates = service.getTemplates("LIQUIDITY_PARTNER", "KSA");
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
  });

  // ── seedDefaultPolicies ───────────────────────────────────

  describe("seedDefaultPolicies", () => {
    it("should create all templates for a UK buyer", async () => {
      prisma.policyRule.findFirst.mockResolvedValue(null); // nothing existing
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

    it("should skip existing rules (idempotent)", async () => {
      // First 3 calls: existing rules found; rest: no existing
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
  });

  // ── resetToDefaults ───────────────────────────────────────

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
      expect(result.created).toBe(4); // UK supplier has 4 templates
      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "POLICY_RULES_RESET",
        }),
      );
    });
  });

  // ── getPilotReadiness ─────────────────────────────────────

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
        { flag: "POLICY_ENGINE_V2", enabled: true },
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
  });
});
