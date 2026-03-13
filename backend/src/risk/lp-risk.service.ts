import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

// ── Types ────────────────────────────────────────────────────

export interface ExposureReport {
  liquidityPartnerId: string;
  currency: string;
  totalExposure: number;
  exposureByCurrency: Record<string, number>;
  fundingLimit: number | null;
  utilisationPct: number | null;
  buyerConcentration: Record<string, number>;
  supplierConcentration: Record<string, number>;
  fundingSuspended: boolean;
  suspensionReason: string | null;
  alerts: string[];
}

export interface ConcentrationAlert {
  type: "BUYER" | "SUPPLIER";
  entityId: string;
  entityName: string;
  exposureAmount: number;
  totalExposure: number;
  concentrationPct: number;
  threshold: number;
}

// ── Configuration ────────────────────────────────────────────

export interface LpRiskConfig {
  /** Max concentration percentage for a single buyer (e.g. 30 = 30%) */
  maxBuyerConcentrationPct: number;
  /** Max concentration percentage for a single supplier */
  maxSupplierConcentrationPct: number;
  /** Utilisation percentage at which to auto-suspend (e.g. 95 = 95%) */
  autoSuspendUtilisationPct: number;
  /** Utilisation warning threshold (e.g. 80 = 80%) */
  warningUtilisationPct: number;
}

const DEFAULT_LP_RISK_CONFIG: LpRiskConfig = {
  maxBuyerConcentrationPct: 30,
  maxSupplierConcentrationPct: 40,
  autoSuspendUtilisationPct: 95,
  warningUtilisationPct: 80,
};

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class LpRiskService {
  private readonly logger = new Logger(LpRiskService.name);
  private config: LpRiskConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {
    this.config = { ...DEFAULT_LP_RISK_CONFIG };
  }

  /** Update LP risk configuration */
  updateConfig(partial: Partial<LpRiskConfig>) {
    this.config = { ...this.config, ...partial };
    return this.config;
  }

  /** Get current config */
  getConfig(): LpRiskConfig {
    return { ...this.config };
  }

  /**
   * Calculate real-time exposure for a liquidity partner.
   * Exposure = sum of all funded but unsettled early payment advances.
   */
  async calculateExposure(lpId: string): Promise<ExposureReport> {
    // Get LP's organisation (funding limit + currency)
    const lpOrg = await this.prisma.organisation.findFirst({
      where: {
        members: { some: { userId: lpId } },
        type: "LIQUIDITY_PARTNER",
      },
      select: { fundingLimitTotal: true, currency: true },
    });

    const fundingLimit = lpOrg?.fundingLimitTotal ?? null;
    const orgCurrency = lpOrg?.currency ?? "GBP";

    // Get all active (funded but not yet settled) early payment requests
    const activeAdvances = await this.prisma.earlyPaymentRequest.findMany({
      where: {
        liquidityPartnerId: lpId,
        status: { in: ["FUNDED", "APPROVED"] },
      },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            buyerId: true,
            supplierId: true,
            amount: true,
          },
        },
        supplier: {
          select: { id: true, name: true },
        },
      },
    });

    // Calculate total exposure and per-currency breakdown
    const exposureByCurrency: Record<string, number> = {};
    const totalExposure = activeAdvances.reduce((sum, a) => {
      const ccy = a.currency ?? orgCurrency;
      exposureByCurrency[ccy] = (exposureByCurrency[ccy] ?? 0) + a.netAdvance;
      return sum + a.netAdvance;
    }, 0);

    // Build concentration maps
    const buyerConcentration: Record<string, number> = {};
    const supplierConcentration: Record<string, number> = {};

    for (const adv of activeAdvances) {
      const buyerId = adv.purchaseOrder.buyerId;
      const supplierId = adv.purchaseOrder.supplierId;

      buyerConcentration[buyerId] =
        (buyerConcentration[buyerId] ?? 0) + adv.netAdvance;
      supplierConcentration[supplierId] =
        (supplierConcentration[supplierId] ?? 0) + adv.netAdvance;
    }

    // Check for alerts
    const alerts: string[] = [];
    const utilisationPct =
      fundingLimit && fundingLimit > 0
        ? Math.round((totalExposure / fundingLimit) * 100)
        : null;

    if (utilisationPct !== null) {
      if (utilisationPct >= this.config.autoSuspendUtilisationPct) {
        alerts.push(
          `CRITICAL: Utilisation at ${utilisationPct}% — auto-suspension threshold (${this.config.autoSuspendUtilisationPct}%) breached`,
        );
      } else if (utilisationPct >= this.config.warningUtilisationPct) {
        alerts.push(
          `WARNING: Utilisation at ${utilisationPct}% — approaching limit (${this.config.autoSuspendUtilisationPct}%)`,
        );
      }
    }

    // Check concentration alerts
    if (totalExposure > 0) {
      for (const [buyerId, amount] of Object.entries(buyerConcentration)) {
        const pct = Math.round((amount / totalExposure) * 100);
        if (pct > this.config.maxBuyerConcentrationPct) {
          alerts.push(
            `CONCENTRATION: Buyer ${buyerId} at ${pct}% of exposure (limit: ${this.config.maxBuyerConcentrationPct}%)`,
          );
        }
      }

      for (const [supplierId, amount] of Object.entries(
        supplierConcentration,
      )) {
        const pct = Math.round((amount / totalExposure) * 100);
        if (pct > this.config.maxSupplierConcentrationPct) {
          alerts.push(
            `CONCENTRATION: Supplier ${supplierId} at ${pct}% of exposure (limit: ${this.config.maxSupplierConcentrationPct}%)`,
          );
        }
      }
    }

    // Check if funding should be auto-suspended
    let fundingSuspended = false;
    let suspensionReason: string | null = null;

    if (
      utilisationPct !== null &&
      utilisationPct >= this.config.autoSuspendUtilisationPct
    ) {
      fundingSuspended = true;
      suspensionReason = `Auto-suspended: utilisation at ${utilisationPct}% (limit: ${this.config.autoSuspendUtilisationPct}%)`;
    }

    return {
      liquidityPartnerId: lpId,
      currency: orgCurrency,
      totalExposure,
      exposureByCurrency,
      fundingLimit,
      utilisationPct,
      buyerConcentration,
      supplierConcentration,
      fundingSuspended,
      suspensionReason,
      alerts,
    };
  }

  /**
   * Check if an LP can fund a new early payment request.
   * Throws if funding limits would be breached.
   */
  async checkFundingEligibility(
    lpId: string,
    requestedAmount: number,
  ): Promise<{
    eligible: boolean;
    currentExposure: number;
    newExposure: number;
    fundingLimit: number | null;
  }> {
    const exposure = await this.calculateExposure(lpId);

    if (exposure.fundingSuspended) {
      throw new BadRequestException(
        `Funding suspended for LP: ${exposure.suspensionReason}`,
      );
    }

    const newExposure = exposure.totalExposure + requestedAmount;

    if (
      exposure.fundingLimit &&
      newExposure >
        exposure.fundingLimit * (this.config.autoSuspendUtilisationPct / 100)
    ) {
      throw new BadRequestException(
        `Funding would breach utilisation limit: ${newExposure} / ${exposure.fundingLimit} (${this.config.autoSuspendUtilisationPct}% threshold)`,
      );
    }

    return {
      eligible: true,
      currentExposure: exposure.totalExposure,
      newExposure,
      fundingLimit: exposure.fundingLimit,
    };
  }

  /**
   * Take an exposure snapshot and persist it for historical tracking.
   */
  async takeSnapshot(lpId: string) {
    const exposure = await this.calculateExposure(lpId);

    const snapshot = await this.prisma.lpExposureSnapshot.create({
      data: {
        liquidityPartnerId: lpId,
        totalExposure: exposure.totalExposure,
        buyerConcentration: exposure.buyerConcentration as any,
        supplierConcentration: exposure.supplierConcentration as any,
        fundingSuspended: exposure.fundingSuspended,
        suspensionReason: exposure.suspensionReason,
      },
    });

    if (exposure.alerts.length > 0) {
      await this.ledger.logEvent({
        entityType: "LP_RISK",
        entityId: lpId,
        eventType: "EXPOSURE_SNAPSHOT",
        actorId: lpId,
        actorRole: "LIQUIDITY_PARTNER",
        payload: {
          snapshotId: snapshot.id,
          totalExposure: exposure.totalExposure,
          fundingLimit: exposure.fundingLimit,
          utilisationPct: exposure.utilisationPct,
          alertCount: exposure.alerts.length,
          fundingSuspended: exposure.fundingSuspended,
        },
      });
    }

    return { snapshot, exposure };
  }

  /**
   * Get exposure history for an LP.
   */
  async getSnapshotHistory(lpId: string, limit = 50) {
    return this.prisma.lpExposureSnapshot.findMany({
      where: { liquidityPartnerId: lpId },
      orderBy: { snapshotAt: "desc" },
      take: limit,
    });
  }
}
