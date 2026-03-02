import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PolicyRuleType } from "@prisma/client";

/** Shape of policy rule conditions JSON */
export interface PolicyConditions {
  /** Minimum amount (inclusive) in smallest currency unit */
  minAmount?: number;
  /** Maximum amount (inclusive) in smallest currency unit */
  maxAmount?: number;
  // ── LP funding limit conditions ──
  /** Max total exposure across all funded early payments */
  maxExposureTotal?: number;
  /** Max exposure to a single buyer org (as ratio 0–1 of maxExposureTotal) */
  maxExposurePerBuyer?: number;
  /** Max exposure to a single supplier org (as ratio 0–1 of maxExposureTotal) */
  maxExposurePerSupplier?: number;
  /** Max payment tenor in days */
  maxTenorDays?: number;
  /** Whitelisted buyer org IDs (empty = all allowed) */
  whitelistedBuyerOrgIds?: string[];
  /** Whitelisted supplier org IDs (empty = all allowed) */
  whitelistedSupplierOrgIds?: string[];
  /** Override fee in basis points (null = use platform default) */
  feeBps?: number;
}

export interface CreatePolicyRuleInput {
  organisationId: string;
  ruleType: PolicyRuleType;
  name: string;
  conditions: PolicyConditions;
  requiredApprovals?: number;
  requiredRoles?: string[];
  autoApprove?: boolean;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface PolicyEvaluation {
  requiresApproval: boolean;
  autoApprove: boolean;
  requiredApprovals: number;
  requiredRoles: string[];
  matchedRule: { id: string; name: string } | null;
}

@Injectable()
export class PoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ──────────────────────────────────────────────────

  async create(input: CreatePolicyRuleInput) {
    return this.prisma.policyRule.create({
      data: {
        organisationId: input.organisationId,
        ruleType: input.ruleType,
        name: input.name,
        conditions: input.conditions as any,
        requiredApprovals: input.requiredApprovals ?? 1,
        requiredRoles: input.requiredRoles ?? [],
        autoApprove: input.autoApprove ?? false,
        priority: input.priority ?? 0,
        metadata: input.metadata as any,
      },
    });
  }

  async findById(id: string) {
    const rule = await this.prisma.policyRule.findUnique({
      where: { id },
      include: { organisation: { select: { id: true, name: true } } },
    });
    if (!rule) throw new NotFoundException("Policy rule not found");
    return rule;
  }

  async findByOrg(organisationId: string, ruleType?: PolicyRuleType) {
    return this.prisma.policyRule.findMany({
      where: {
        organisationId,
        active: true,
        ...(ruleType ? { ruleType } : {}),
      },
      orderBy: { priority: "desc" },
    });
  }

  async update(
    id: string,
    data: Partial<
      Pick<
        CreatePolicyRuleInput,
        | "name"
        | "conditions"
        | "requiredApprovals"
        | "requiredRoles"
        | "autoApprove"
        | "priority"
        | "metadata"
      >
    > & { active?: boolean },
  ) {
    const existing = await this.prisma.policyRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Policy rule not found");

    return this.prisma.policyRule.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.conditions !== undefined && {
          conditions: data.conditions as any,
        }),
        ...(data.requiredApprovals !== undefined && {
          requiredApprovals: data.requiredApprovals,
        }),
        ...(data.requiredRoles !== undefined && {
          requiredRoles: data.requiredRoles,
        }),
        ...(data.autoApprove !== undefined && {
          autoApprove: data.autoApprove,
        }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.active !== undefined && { active: data.active }),
        ...(data.metadata !== undefined && { metadata: data.metadata as any }),
      },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.policyRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Policy rule not found");

    // Soft delete — mark inactive
    return this.prisma.policyRule.update({
      where: { id },
      data: { active: false },
    });
  }

  // ── Policy Evaluation ─────────────────────────────────────

  /**
   * Evaluate PO approval policies for a buyer organisation.
   * Finds the highest-priority active PO_APPROVAL rule whose amount range matches.
   * Returns whether approval is needed, how many approvals, and which roles.
   */
  async evaluatePOApproval(
    organisationId: string,
    amountSmallestUnit: number,
  ): Promise<PolicyEvaluation> {
    const rules = await this.prisma.policyRule.findMany({
      where: {
        organisationId,
        ruleType: "PO_APPROVAL",
        active: true,
      },
      orderBy: { priority: "desc" },
    });

    for (const rule of rules) {
      const cond = rule.conditions as unknown as PolicyConditions;
      const minOk =
        cond.minAmount === undefined || amountSmallestUnit >= cond.minAmount;
      const maxOk =
        cond.maxAmount === undefined || amountSmallestUnit <= cond.maxAmount;

      if (minOk && maxOk) {
        return {
          requiresApproval: true,
          autoApprove: rule.autoApprove,
          requiredApprovals: rule.requiredApprovals,
          requiredRoles: rule.requiredRoles,
          matchedRule: { id: rule.id, name: rule.name },
        };
      }
    }

    // No matching rule → no approval needed (backward-compatible)
    return {
      requiresApproval: false,
      autoApprove: true,
      requiredApprovals: 0,
      requiredRoles: [],
      matchedRule: null,
    };
  }

  // ── LP Exposure Evaluation ────────────────────────────────

  /**
   * Evaluate whether an LP can fund a specific early payment based on their funding policy.
   * Returns { allowed, reason?, currentExposure, limits }.
   */
  async evaluateLPFunding(
    lpOrgId: string,
    buyerOrgId: string | null,
    supplierOrgId: string | null,
    fundingAmount: number,
  ): Promise<{
    allowed: boolean;
    reason?: string;
    currentExposure: {
      total: number;
      perBuyer: Record<string, number>;
      perSupplier: Record<string, number>;
    };
    limits: PolicyConditions | null;
  }> {
    // Get the LP's funding limit policy
    const rules = await this.prisma.policyRule.findMany({
      where: {
        organisationId: lpOrgId,
        ruleType: "FUNDING_LIMIT",
        active: true,
      },
      orderBy: { priority: "desc" },
    });

    const rule = rules[0]; // Use highest priority
    if (!rule) {
      // No funding policy = no limits enforced
      return {
        allowed: true,
        currentExposure: { total: 0, perBuyer: {}, perSupplier: {} },
        limits: null,
      };
    }

    const cond = rule.conditions as unknown as PolicyConditions;

    // Calculate current exposure from funded (not yet settled) early payments
    const exposure = await this.calculateLPExposure(lpOrgId);

    // Check total exposure
    if (
      cond.maxExposureTotal &&
      exposure.total + fundingAmount > cond.maxExposureTotal
    ) {
      return {
        allowed: false,
        reason: `Total exposure would exceed limit: ${exposure.total + fundingAmount} > ${cond.maxExposureTotal}`,
        currentExposure: exposure,
        limits: cond,
      };
    }

    // Check per-buyer concentration
    if (cond.maxExposurePerBuyer && cond.maxExposureTotal && buyerOrgId) {
      const maxPerBuyer = Math.round(
        cond.maxExposureTotal * cond.maxExposurePerBuyer,
      );
      const currentBuyerExposure = exposure.perBuyer[buyerOrgId] ?? 0;
      if (currentBuyerExposure + fundingAmount > maxPerBuyer) {
        return {
          allowed: false,
          reason: `Buyer concentration would exceed limit: ${currentBuyerExposure + fundingAmount} > ${maxPerBuyer}`,
          currentExposure: exposure,
          limits: cond,
        };
      }
    }

    // Check per-supplier concentration
    if (cond.maxExposurePerSupplier && cond.maxExposureTotal && supplierOrgId) {
      const maxPerSupplier = Math.round(
        cond.maxExposureTotal * cond.maxExposurePerSupplier,
      );
      const currentSupplierExposure = exposure.perSupplier[supplierOrgId] ?? 0;
      if (currentSupplierExposure + fundingAmount > maxPerSupplier) {
        return {
          allowed: false,
          reason: `Supplier concentration would exceed limit: ${currentSupplierExposure + fundingAmount} > ${maxPerSupplier}`,
          currentExposure: exposure,
          limits: cond,
        };
      }
    }

    // Check whitelist (if set)
    if (
      cond.whitelistedBuyerOrgIds &&
      cond.whitelistedBuyerOrgIds.length > 0 &&
      buyerOrgId &&
      !cond.whitelistedBuyerOrgIds.includes(buyerOrgId)
    ) {
      return {
        allowed: false,
        reason: `Buyer org ${buyerOrgId} is not in the LP's whitelist`,
        currentExposure: exposure,
        limits: cond,
      };
    }

    if (
      cond.whitelistedSupplierOrgIds &&
      cond.whitelistedSupplierOrgIds.length > 0 &&
      supplierOrgId &&
      !cond.whitelistedSupplierOrgIds.includes(supplierOrgId)
    ) {
      return {
        allowed: false,
        reason: `Supplier org ${supplierOrgId} is not in the LP's whitelist`,
        currentExposure: exposure,
        limits: cond,
      };
    }

    return {
      allowed: true,
      currentExposure: exposure,
      limits: cond,
    };
  }

  /**
   * Calculate an LP's current exposure from funded-but-not-settled early payments.
   * Groups by buyer org and supplier org for concentration checks.
   */
  async calculateLPExposure(lpOrgId: string): Promise<{
    total: number;
    perBuyer: Record<string, number>;
    perSupplier: Record<string, number>;
    count: number;
  }> {
    // Get all members of this LP org to find LP user IDs
    const lpMembers = await this.prisma.orgMembership.findMany({
      where: { organisationId: lpOrgId },
      select: { userId: true },
    });
    const lpUserIds = lpMembers.map((m) => m.userId);

    // Get funded (not settled) early payments by any user in this LP org
    const fundedRequests = await this.prisma.earlyPaymentRequest.findMany({
      where: {
        liquidityPartnerId: { in: lpUserIds },
        status: "FUNDED",
      },
      include: {
        purchaseOrder: {
          select: {
            buyerId: true,
            supplierId: true,
          },
        },
      },
    });

    let total = 0;
    const perBuyer: Record<string, number> = {};
    const perSupplier: Record<string, number> = {};

    for (const req of fundedRequests) {
      total += req.netAdvance;

      // Get buyer's org
      const buyerMembership = await this.prisma.orgMembership.findUnique({
        where: { userId: req.purchaseOrder.buyerId },
        select: { organisationId: true },
      });
      if (buyerMembership) {
        const orgId = buyerMembership.organisationId;
        perBuyer[orgId] = (perBuyer[orgId] ?? 0) + req.netAdvance;
      }

      // Get supplier's org
      const supplierMembership = await this.prisma.orgMembership.findUnique({
        where: { userId: req.purchaseOrder.supplierId },
        select: { organisationId: true },
      });
      if (supplierMembership) {
        const orgId = supplierMembership.organisationId;
        perSupplier[orgId] = (perSupplier[orgId] ?? 0) + req.netAdvance;
      }
    }

    return { total, perBuyer, perSupplier, count: fundedRequests.length };
  }
}
