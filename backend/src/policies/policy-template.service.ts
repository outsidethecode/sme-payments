import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { PolicyRuleType, Prisma } from "@prisma/client";

// ── Template Definitions ──────────────────────────────────────

export interface PolicyTemplate {
  ruleType: PolicyRuleType;
  name: string;
  conditions: Record<string, unknown>;
  requiredApprovals: number;
  requiredRoles: string[];
  autoApprove: boolean;
  priority: number;
}

// ── UK/GBP Templates ──────────────────────────────────────────

const UK_BUYER_TEMPLATES: PolicyTemplate[] = [
  // PO Approval tiers
  {
    ruleType: "PO_APPROVAL",
    name: "Auto-approve POs ≤ £10,000",
    conditions: { minAmount: 0, maxAmount: 10_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "PO_APPROVAL",
    name: "1 approver for POs £10k–£50k",
    conditions: { minAmount: 10_000_01, maxAmount: 50_000_00 },
    requiredApprovals: 1,
    requiredRoles: ["APPROVER"],
    autoApprove: false,
    priority: 5,
  },
  {
    ruleType: "PO_APPROVAL",
    name: "2 approvers for POs > £50k",
    conditions: { minAmount: 50_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 2,
    requiredRoles: ["APPROVER", "FINANCE"],
    autoApprove: false,
    priority: 1,
  },
  // PO order limits
  {
    ruleType: "PO_ORDER_LIMITS",
    name: "UK PO order limits (GBP)",
    conditions: { minAmount: 500_00, maxAmount: 250_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 1,
  },
  // Escrow funding
  {
    ruleType: "ESCROW_FUNDING",
    name: "Auto-approve escrow ≤ £25,000",
    conditions: { minAmount: 0, maxAmount: 25_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "ESCROW_FUNDING",
    name: "Large escrow funding approval",
    conditions: { minAmount: 25_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE"],
    autoApprove: false,
    priority: 5,
  },
  // Settlement
  {
    ruleType: "SETTLEMENT",
    name: "Auto-settle ≤ £50,000",
    conditions: { minAmount: 0, maxAmount: 50_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "SETTLEMENT",
    name: "Large settlement approval",
    conditions: { minAmount: 50_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE", "OWNER"],
    autoApprove: false,
    priority: 5,
  },
  // Delivery verification
  {
    ruleType: "DELIVERY_VERIFICATION",
    name: "Auto-verify delivery ≤ £50,000",
    conditions: { minAmount: 0, maxAmount: 50_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "DELIVERY_VERIFICATION",
    name: "Large delivery verification",
    conditions: { minAmount: 50_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE"],
    autoApprove: false,
    priority: 5,
  },
];

const UK_SUPPLIER_TEMPLATES: PolicyTemplate[] = [
  {
    ruleType: "SUPPLIER_ACCEPTANCE",
    name: "Auto-accept POs ≤ £20,000",
    conditions: { minAmount: 0, maxAmount: 20_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "SUPPLIER_ACCEPTANCE",
    name: "Large PO acceptance approval",
    conditions: { minAmount: 20_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["APPROVER", "OWNER"],
    autoApprove: false,
    priority: 5,
  },
  {
    ruleType: "EARLY_PAYMENT",
    name: "Auto-approve early pay ≤ £15,000",
    conditions: { minAmount: 0, maxAmount: 15_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "EARLY_PAYMENT",
    name: "Large early pay approval",
    conditions: { minAmount: 15_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE"],
    autoApprove: false,
    priority: 5,
  },
];

const UK_LP_TEMPLATES: PolicyTemplate[] = [
  {
    ruleType: "LP_FUNDING",
    name: "Auto-fund ≤ £25,000",
    conditions: { minAmount: 0, maxAmount: 25_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "LP_FUNDING",
    name: "Large LP funding approval",
    conditions: { minAmount: 25_000_01, maxAmount: 100_000_00 },
    requiredApprovals: 1,
    requiredRoles: ["APPROVER"],
    autoApprove: false,
    priority: 5,
  },
  {
    ruleType: "LP_FUNDING",
    name: "Major LP commitment (2 approvers)",
    conditions: { minAmount: 100_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 2,
    requiredRoles: ["APPROVER", "FINANCE"],
    autoApprove: false,
    priority: 1,
  },
  {
    ruleType: "FUNDING_LIMIT",
    name: "Standard LP exposure limits (GBP)",
    conditions: {
      maxExposureTotal: 2_000_000_00,
      maxExposurePerBuyer: 0.4,
      maxExposurePerSupplier: 0.3,
      maxTenorDays: 90,
      feeBps: 200,
    },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 1,
  },
];

// ── KSA/SAR Templates (× ~3.75 conversion) ────────────────────

const KSA_BUYER_TEMPLATES: PolicyTemplate[] = [
  {
    ruleType: "PO_APPROVAL",
    name: "Auto-approve POs ≤ 50,000 SAR",
    conditions: { minAmount: 0, maxAmount: 50_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "PO_APPROVAL",
    name: "1 approver for POs 50k–200k SAR",
    conditions: { minAmount: 50_000_01, maxAmount: 200_000_00 },
    requiredApprovals: 1,
    requiredRoles: ["APPROVER"],
    autoApprove: false,
    priority: 5,
  },
  {
    ruleType: "PO_APPROVAL",
    name: "2 approvers for POs > 200k SAR",
    conditions: { minAmount: 200_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 2,
    requiredRoles: ["APPROVER", "FINANCE"],
    autoApprove: false,
    priority: 1,
  },
  {
    ruleType: "PO_ORDER_LIMITS",
    name: "KSA PO order limits (SAR)",
    conditions: { minAmount: 1_875_00, maxAmount: 93_750_000 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 1,
  },
  {
    ruleType: "ESCROW_FUNDING",
    name: "Auto-approve escrow ≤ 100,000 SAR",
    conditions: { minAmount: 0, maxAmount: 100_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "ESCROW_FUNDING",
    name: "Large escrow funding approval (SAR)",
    conditions: { minAmount: 100_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE"],
    autoApprove: false,
    priority: 5,
  },
  {
    ruleType: "SETTLEMENT",
    name: "Auto-settle ≤ 200,000 SAR",
    conditions: { minAmount: 0, maxAmount: 200_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "SETTLEMENT",
    name: "Large settlement approval (SAR)",
    conditions: { minAmount: 200_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE", "OWNER"],
    autoApprove: false,
    priority: 5,
  },
];

const KSA_SUPPLIER_TEMPLATES: PolicyTemplate[] = [
  {
    ruleType: "SUPPLIER_ACCEPTANCE",
    name: "Auto-accept POs ≤ 75,000 SAR",
    conditions: { minAmount: 0, maxAmount: 75_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "SUPPLIER_ACCEPTANCE",
    name: "Large PO acceptance approval (SAR)",
    conditions: { minAmount: 75_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["APPROVER", "OWNER"],
    autoApprove: false,
    priority: 5,
  },
  {
    ruleType: "EARLY_PAYMENT",
    name: "Auto-approve early pay ≤ 60,000 SAR",
    conditions: { minAmount: 0, maxAmount: 60_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "EARLY_PAYMENT",
    name: "Large early pay approval (SAR)",
    conditions: { minAmount: 60_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE"],
    autoApprove: false,
    priority: 5,
  },
];

const KSA_LP_TEMPLATES: PolicyTemplate[] = [
  {
    ruleType: "LP_FUNDING",
    name: "Auto-fund ≤ 100,000 SAR",
    conditions: { minAmount: 0, maxAmount: 100_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  },
  {
    ruleType: "LP_FUNDING",
    name: "Large LP funding approval (SAR)",
    conditions: { minAmount: 100_000_01, maxAmount: 400_000_00 },
    requiredApprovals: 1,
    requiredRoles: ["APPROVER"],
    autoApprove: false,
    priority: 5,
  },
  {
    ruleType: "LP_FUNDING",
    name: "Major LP commitment (SAR)",
    conditions: { minAmount: 400_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 2,
    requiredRoles: ["APPROVER", "FINANCE"],
    autoApprove: false,
    priority: 1,
  },
  {
    ruleType: "FUNDING_LIMIT",
    name: "Standard LP exposure limits (SAR)",
    conditions: {
      maxExposureTotal: 5_000_000_00,
      maxExposurePerBuyer: 0.4,
      maxExposurePerSupplier: 0.3,
      maxTenorDays: 90,
      feeBps: 250, // ujrah fee
    },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 1,
  },
];

// ── Template Lookup ────────────────────────────────────────────

type OrgType = "BUYER" | "SUPPLIER" | "LIQUIDITY_PARTNER";
type Jurisdiction = "UK" | "KSA";

const TEMPLATE_MAP: Record<OrgType, Record<Jurisdiction, PolicyTemplate[]>> = {
  BUYER: {
    UK: UK_BUYER_TEMPLATES,
    KSA: KSA_BUYER_TEMPLATES,
  },
  SUPPLIER: {
    UK: UK_SUPPLIER_TEMPLATES,
    KSA: KSA_SUPPLIER_TEMPLATES,
  },
  LIQUIDITY_PARTNER: {
    UK: UK_LP_TEMPLATES,
    KSA: KSA_LP_TEMPLATES,
  },
};

// ── Service ────────────────────────────────────────────────────

@Injectable()
export class PolicyTemplateService {
  private readonly logger = new Logger(PolicyTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Returns the template definitions for a given org type and jurisdiction.
   */
  getTemplates(orgType: string, jurisdiction: string): PolicyTemplate[] {
    const templates =
      TEMPLATE_MAP[orgType as OrgType]?.[jurisdiction as Jurisdiction];
    return templates ?? [];
  }

  /**
   * Seed default policy rules for an organisation based on its type and jurisdiction.
   * Skips rules that already exist (idempotent).
   * Returns the number of rules created.
   */
  async seedDefaultPolicies(
    organisationId: string,
    orgType: string,
    jurisdiction: string,
  ): Promise<{ created: number; skipped: number; rules: string[] }> {
    const templates = this.getTemplates(orgType, jurisdiction);
    if (templates.length === 0) {
      this.logger.warn(`No templates found for ${orgType} / ${jurisdiction}`);
      return { created: 0, skipped: 0, rules: [] };
    }

    let created = 0;
    let skipped = 0;
    const ruleNames: string[] = [];

    for (const tpl of templates) {
      // Idempotent: skip if an active rule with same name already exists for this org
      const existing = await this.prisma.policyRule.findFirst({
        where: { organisationId, name: tpl.name, active: true },
      });

      if (existing) {
        skipped++;
        continue;
      }

      const rule = await this.prisma.policyRule.create({
        data: {
          organisationId,
          ruleType: tpl.ruleType,
          name: tpl.name,
          conditions: tpl.conditions as Prisma.InputJsonValue,
          requiredApprovals: tpl.requiredApprovals,
          requiredRoles: tpl.requiredRoles,
          autoApprove: tpl.autoApprove,
          priority: tpl.priority,
          active: true,
        },
      });

      ruleNames.push(rule.name);
      created++;
    }

    // Audit
    if (created > 0) {
      this.ledger
        .logEvent({
          entityType: "ORGANISATION",
          entityId: organisationId,
          eventType: "POLICY_TEMPLATES_SEEDED",
          actorId: "SYSTEM",
          actorRole: "SYSTEM",
          payload: {
            orgType,
            jurisdiction,
            templatesCreated: created,
            templatesSkipped: skipped,
            rules: ruleNames,
          },
        })
        .catch((err) =>
          this.logger.warn(`Failed to log template seeding: ${err.message}`),
        );
    }

    this.logger.log(
      `Seeded ${created} policy templates for org ${organisationId} (${orgType}/${jurisdiction}), skipped ${skipped}`,
    );

    return { created, skipped, rules: ruleNames };
  }

  /**
   * Wipe custom rules and re-seed from templates.
   * Returns the seed result.
   */
  async resetToDefaults(
    organisationId: string,
    orgType: string,
    jurisdiction: string,
  ) {
    // Deactivate all existing rules
    const deactivated = await this.prisma.policyRule.updateMany({
      where: { organisationId, active: true },
      data: { active: false },
    });

    this.logger.log(
      `Deactivated ${deactivated.count} rules for org ${organisationId} before template reset`,
    );

    // Audit deactivation
    this.ledger
      .logEvent({
        entityType: "ORGANISATION",
        entityId: organisationId,
        eventType: "POLICY_RULES_RESET",
        actorId: "SYSTEM",
        actorRole: "SYSTEM",
        payload: {
          deactivatedCount: deactivated.count,
          orgType,
          jurisdiction,
        },
      })
      .catch((err) =>
        this.logger.warn(`Failed to log policy reset: ${err.message}`),
      );

    // Re-seed from templates
    return this.seedDefaultPolicies(organisationId, orgType, jurisdiction);
  }

  /**
   * Get pilot readiness checklist for an organisation.
   */
  async getPilotReadiness(organisationId: string) {
    const org = await this.prisma.organisation.findUnique({
      where: { id: organisationId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, role: true } } },
        },
      },
    });

    if (!org) return null;

    const policyRules = await this.prisma.policyRule.findMany({
      where: { organisationId, active: true },
    });

    const hasApprover = org.members.some((m) => m.orgRole === "APPROVER");
    const hasFinance = org.members.some((m) => m.orgRole === "FINANCE");

    // Check feature flags
    const flags = await this.prisma.featureFlagOverride.findMany({
      where: { organisationId },
    });
    const policyFlag = flags.find((f) => f.flag === "POLICY_ENGINE");

    const checks = [
      {
        key: "kyb_verified",
        label: "KYB Verified",
        complete:
          org.onboardingStatus === "COMPLETED" ||
          org.onboardingStatus === "KYB_VERIFIED",
      },
      {
        key: "bank_connected",
        label: "Bank IBAN Connected",
        complete: !!org.bankIban,
      },
      {
        key: "onboarding_complete",
        label: "Onboarding Complete",
        complete: org.onboardingStatus === "COMPLETED",
      },
      {
        key: "policy_rules",
        label: `Policy Rules Configured (${policyRules.length} rules)`,
        complete: policyRules.length > 0,
      },
      {
        key: "has_approver",
        label: "At least 1 APPROVER member",
        complete: hasApprover,
      },
      {
        key: "has_finance",
        label: "At least 1 FINANCE member",
        complete: hasFinance,
      },
      {
        key: "feature_flags",
        label: "Feature flags enabled",
        complete: policyFlag?.enabled === true,
      },
      {
        key: "terms_accepted",
        label: "Terms accepted",
        complete: !!org.termsAcceptedAt,
      },
    ];

    return {
      organisationId: org.id,
      organisationName: org.name,
      orgType: org.type,
      jurisdiction: org.jurisdiction,
      readyPercentage: Math.round(
        (checks.filter((c) => c.complete).length / checks.length) * 100,
      ),
      checks,
    };
  }
}
