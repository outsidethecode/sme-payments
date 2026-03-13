import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

// ── Configuration ────────────────────────────────────────────

export interface FraudRuleConfig {
  /** Max POs a buyer can create per day */
  maxPOsPerBuyerPerDay: number;
  /** Max total PO value a buyer can create per day (in minor units) */
  maxDailyValuePerBuyer: number;
  /** PO amount above which evidence attachments are mandatory */
  mandatoryEvidenceThreshold: number;
  /** Allowed supplier IDs (empty = no whitelist enforcement) */
  supplierWhitelist: string[];
  /** Max POs a supplier can receive per day */
  maxPOsPerSupplierPerDay: number;
}

/** Per-currency fraud thresholds (minor units) */
const FRAUD_CONFIG_BY_CURRENCY: Record<string, FraudRuleConfig> = {
  GBP: {
    maxPOsPerBuyerPerDay: 50,
    maxDailyValuePerBuyer: 50_000_000, // £500,000
    mandatoryEvidenceThreshold: 10_000_000, // £100,000
    supplierWhitelist: [],
    maxPOsPerSupplierPerDay: 100,
  },
  SAR: {
    maxPOsPerBuyerPerDay: 50,
    maxDailyValuePerBuyer: 187_500_000, // SAR 1,875,000 (~£500k equiv)
    mandatoryEvidenceThreshold: 37_500_000, // SAR 375,000 (~£100k equiv)
    supplierWhitelist: [],
    maxPOsPerSupplierPerDay: 100,
  },
};

const DEFAULT_FRAUD_CONFIG: FraudRuleConfig = FRAUD_CONFIG_BY_CURRENCY["GBP"];

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

  /** Get current fraud configuration (includes per-currency map) */
  getConfig(): FraudRuleConfig & {
    configByCurrency: Record<string, FraudRuleConfig>;
  } {
    return { ...this.config, configByCurrency: this.getAllConfigs() };
  }

  /** Get fraud configs for all supported currencies */
  getAllConfigs(): Record<string, FraudRuleConfig> {
    return Object.fromEntries(
      Object.entries(FRAUD_CONFIG_BY_CURRENCY).map(([k, v]) => [k, { ...v }]),
    );
  }

  /** Get fraud config for a specific currency */
  getConfigForCurrency(currency: string): FraudRuleConfig {
    return { ...(FRAUD_CONFIG_BY_CURRENCY[currency] ?? this.config) };
  }

  /**
   * Run all fraud checks before PO creation.
   * Throws if any check fails. Returns array of warnings for soft limits.
   */
  async checkPOCreation(
    buyerId: string,
    supplierId: string,
    amount: number,
    currency: string = "GBP",
  ): Promise<{ passed: boolean; warnings: string[]; flags: string[] }> {
    const warnings: string[] = [];
    const flags: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cfg = this.getConfigForCurrency(currency);

    // ── 1. Buyer daily PO count velocity check ──
    const buyerDailyCount = await this.prisma.purchaseOrder.count({
      where: {
        buyerId,
        createdAt: { gte: today },
      },
    });

    if (buyerDailyCount >= cfg.maxPOsPerBuyerPerDay) {
      const flag = await this.createFlag(
        buyerId,
        "VELOCITY_DAILY_PO_COUNT",
        "HIGH",
        {
          limit: cfg.maxPOsPerBuyerPerDay,
          actual: buyerDailyCount,
          window: "24h",
          currency,
        },
      );
      flags.push(flag.id);
      throw new BadRequestException(
        `Velocity limit exceeded: ${buyerDailyCount} POs created today (limit: ${cfg.maxPOsPerBuyerPerDay})`,
      );
    }

    if (buyerDailyCount >= cfg.maxPOsPerBuyerPerDay * 0.8) {
      warnings.push(
        `Approaching daily PO limit: ${buyerDailyCount}/${cfg.maxPOsPerBuyerPerDay}`,
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
    if (totalDailyValue > cfg.maxDailyValuePerBuyer) {
      const flag = await this.createFlag(
        buyerId,
        "VELOCITY_DAILY_VALUE",
        "HIGH",
        {
          limit: cfg.maxDailyValuePerBuyer,
          actual: totalDailyValue,
          window: "24h",
          currency,
        },
      );
      flags.push(flag.id);
      throw new BadRequestException(
        `Daily value limit exceeded: ${totalDailyValue} (limit: ${cfg.maxDailyValuePerBuyer})`,
      );
    }

    if (totalDailyValue > cfg.maxDailyValuePerBuyer * 0.8) {
      warnings.push(
        `Approaching daily value limit: ${totalDailyValue}/${cfg.maxDailyValuePerBuyer}`,
      );
    }

    // ── 3. Supplier whitelist check ──
    if (
      cfg.supplierWhitelist.length > 0 &&
      !cfg.supplierWhitelist.includes(supplierId)
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

    if (supplierDailyCount >= cfg.maxPOsPerSupplierPerDay) {
      const flag = await this.createFlag(
        supplierId,
        "VELOCITY_SUPPLIER_DAILY_COUNT",
        "MEDIUM",
        {
          limit: cfg.maxPOsPerSupplierPerDay,
          actual: supplierDailyCount,
          window: "24h",
          currency,
        },
      );
      flags.push(flag.id);
      throw new BadRequestException(
        `Supplier daily PO limit exceeded: ${supplierDailyCount} (limit: ${cfg.maxPOsPerSupplierPerDay})`,
      );
    }

    return { passed: true, warnings, flags };
  }

  /**
   * Check if evidence is mandatory for a PO of the given amount.
   */
  isEvidenceMandatory(amount: number, currency: string = "GBP"): boolean {
    const cfg = this.getConfigForCurrency(currency);
    return amount >= cfg.mandatoryEvidenceThreshold;
  }

  /**
   * Enforce mandatory evidence before delivery verification.
   * If the PO amount exceeds the threshold, at least one evidence attachment is required.
   */
  async enforceEvidenceRequirement(
    purchaseOrderId: string,
    amount: number,
    currency: string = "GBP",
  ): Promise<void> {
    if (!this.isEvidenceMandatory(amount, currency)) return;

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
