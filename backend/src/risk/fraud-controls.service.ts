import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

// ── Configuration ────────────────────────────────────────────

export interface FraudRuleConfig {
  /** Max POs a buyer can create per day */
  maxPOsPerBuyerPerDay: number;
  /** Max total PO value a buyer can create per day (in smallest currency unit) */
  maxDailyValuePerBuyer: number;
  /** PO amount above which evidence attachments are mandatory */
  mandatoryEvidenceThreshold: number;
  /** Allowed supplier IDs (empty = no whitelist enforcement) */
  supplierWhitelist: string[];
  /** Max POs a supplier can receive per day */
  maxPOsPerSupplierPerDay: number;
}

const DEFAULT_FRAUD_CONFIG: FraudRuleConfig = {
  maxPOsPerBuyerPerDay: 50,
  maxDailyValuePerBuyer: 50_000_000, // 500,000 GBP/SAR
  mandatoryEvidenceThreshold: 10_000_000, // 100,000 GBP/SAR
  supplierWhitelist: [],
  maxPOsPerSupplierPerDay: 100,
};

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class FraudControlsService {
  private readonly logger = new Logger(FraudControlsService.name);
  private config: FraudRuleConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {
    this.config = { ...DEFAULT_FRAUD_CONFIG };
  }

  /** Update fraud control configuration at runtime */
  updateConfig(partial: Partial<FraudRuleConfig>) {
    this.config = { ...this.config, ...partial };
    this.logger.log(`Fraud config updated: ${JSON.stringify(this.config)}`);
    return this.config;
  }

  /** Get current fraud configuration */
  getConfig(): FraudRuleConfig {
    return { ...this.config };
  }

  /**
   * Run all fraud checks before PO creation.
   * Throws if any check fails. Returns array of warnings for soft limits.
   */
  async checkPOCreation(
    buyerId: string,
    supplierId: string,
    amount: number,
  ): Promise<{ passed: boolean; warnings: string[]; flags: string[] }> {
    const warnings: string[] = [];
    const flags: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ── 1. Buyer daily PO count velocity check ──
    const buyerDailyCount = await this.prisma.purchaseOrder.count({
      where: {
        buyerId,
        createdAt: { gte: today },
      },
    });

    if (buyerDailyCount >= this.config.maxPOsPerBuyerPerDay) {
      const flag = await this.createFlag(
        buyerId,
        "VELOCITY_DAILY_PO_COUNT",
        "HIGH",
        {
          limit: this.config.maxPOsPerBuyerPerDay,
          actual: buyerDailyCount,
          window: "24h",
        },
      );
      flags.push(flag.id);
      throw new BadRequestException(
        `Velocity limit exceeded: ${buyerDailyCount} POs created today (limit: ${this.config.maxPOsPerBuyerPerDay})`,
      );
    }

    if (buyerDailyCount >= this.config.maxPOsPerBuyerPerDay * 0.8) {
      warnings.push(
        `Approaching daily PO limit: ${buyerDailyCount}/${this.config.maxPOsPerBuyerPerDay}`,
      );
    }

    // ── 2. Buyer daily value velocity check ──
    const buyerDailyValue = await this.prisma.purchaseOrder.aggregate({
      where: {
        buyerId,
        createdAt: { gte: today },
      },
      _sum: { amount: true },
    });

    const totalDailyValue = (buyerDailyValue._sum.amount ?? 0) + amount;
    if (totalDailyValue > this.config.maxDailyValuePerBuyer) {
      const flag = await this.createFlag(
        buyerId,
        "VELOCITY_DAILY_VALUE",
        "HIGH",
        {
          limit: this.config.maxDailyValuePerBuyer,
          actual: totalDailyValue,
          window: "24h",
        },
      );
      flags.push(flag.id);
      throw new BadRequestException(
        `Daily value limit exceeded: ${totalDailyValue} (limit: ${this.config.maxDailyValuePerBuyer})`,
      );
    }

    if (totalDailyValue > this.config.maxDailyValuePerBuyer * 0.8) {
      warnings.push(
        `Approaching daily value limit: ${totalDailyValue}/${this.config.maxDailyValuePerBuyer}`,
      );
    }

    // ── 3. Supplier whitelist check ──
    if (
      this.config.supplierWhitelist.length > 0 &&
      !this.config.supplierWhitelist.includes(supplierId)
    ) {
      const flag = await this.createFlag(
        buyerId,
        "SUPPLIER_NOT_WHITELISTED",
        "CRITICAL",
        { supplierId },
      );
      flags.push(flag.id);
      throw new BadRequestException(
        "Supplier is not on the approved whitelist",
      );
    }

    // ── 4. Supplier daily PO count velocity check ──
    const supplierDailyCount = await this.prisma.purchaseOrder.count({
      where: {
        supplierId,
        createdAt: { gte: today },
      },
    });

    if (supplierDailyCount >= this.config.maxPOsPerSupplierPerDay) {
      const flag = await this.createFlag(
        supplierId,
        "VELOCITY_SUPPLIER_DAILY_COUNT",
        "MEDIUM",
        {
          limit: this.config.maxPOsPerSupplierPerDay,
          actual: supplierDailyCount,
          window: "24h",
        },
      );
      flags.push(flag.id);
      throw new BadRequestException(
        `Supplier daily PO limit exceeded: ${supplierDailyCount} (limit: ${this.config.maxPOsPerSupplierPerDay})`,
      );
    }

    return { passed: true, warnings, flags };
  }

  /**
   * Check if evidence is mandatory for a PO of the given amount.
   */
  isEvidenceMandatory(amount: number): boolean {
    return amount >= this.config.mandatoryEvidenceThreshold;
  }

  /**
   * Enforce mandatory evidence before delivery verification.
   * If the PO amount exceeds the threshold, at least one evidence attachment is required.
   */
  async enforceEvidenceRequirement(
    purchaseOrderId: string,
    amount: number,
  ): Promise<void> {
    if (!this.isEvidenceMandatory(amount)) return;

    const evidenceCount = await this.prisma.evidenceAttachment.count({
      where: { purchaseOrderId },
    });

    if (evidenceCount === 0) {
      throw new BadRequestException(
        `Evidence is mandatory for POs above ${this.config.mandatoryEvidenceThreshold}. Upload at least one evidence attachment.`,
      );
    }
  }

  /**
   * Get all fraud flags for a user.
   */
  async getFlagsForUser(userId: string) {
    return this.prisma.fraudFlag.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get all unacknowledged fraud flags (admin view).
   */
  async getUnacknowledgedFlags() {
    return this.prisma.fraudFlag.findMany({
      where: { acknowledged: false },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            companyName: true,
          },
        },
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    });
  }

  /**
   * Acknowledge a fraud flag (admin action).
   */
  async acknowledgeFlag(flagId: string, adminId: string) {
    return this.prisma.fraudFlag.update({
      where: { id: flagId },
      data: {
        acknowledged: true,
        acknowledgedBy: adminId,
        acknowledgedAt: new Date(),
      },
    });
  }

  // ── Internal helpers ───────────────────────────────────────

  private async createFlag(
    userId: string,
    ruleCode: string,
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    details: Record<string, unknown>,
  ) {
    const flag = await this.prisma.fraudFlag.create({
      data: {
        userId,
        ruleCode,
        severity,
        details: details as any,
      },
    });

    this.logger.warn(
      `Fraud flag ${flag.id}: ${ruleCode} (${severity}) for user ${userId}`,
    );

    return flag;
  }
}
