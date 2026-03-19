import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

// ── Types ────────────────────────────────────────────────────

export interface RiskFactorScore {
  /** Factor name */
  name: string;
  /** Raw score 0–10 for this factor */
  score: number;
  /** Weight used in composite (0–1) */
  weight: number;
  /** Weighted contribution to the composite */
  weighted: number;
  /** Human-readable explanation of why this score was given */
  reason: string;
}

export interface RiskSnapshot {
  /** 0–10 composite score (10 = lowest risk) */
  riskScore: number;
  /** Estimated probability of default as a percentage (0–100) */
  defaultProbability: number;
  /** Whether a payment lock exists and is LOCKED */
  paymentLocked: boolean;
  /** Current PaymentInstrument status, if any */
  instrumentStatus: string | null;
  /** Current PO status (ACCEPTED, SHIPPED, DELIVERED, etc.) */
  deliveryStatus: string;
  /** % of buyer's historical POs that had disputes raised */
  buyerDisputeRate: number;
  /** Bank reference from the instrument, if confirmed */
  bankReference: string | null;
  /** Expected settlement date (based on PO delivery date or creation + 30d) */
  expectedSettlement: string | null;
  /** Whether at least one evidence attachment exists for this PO */
  evidencePackAvailable: boolean;
  /** Individual factor scores that compose the overall risk score */
  factors: RiskFactorScore[];
}

// ── Weights ──────────────────────────────────────────────────

const WEIGHT_PAYMENT_LOCKED = 0.3;
const WEIGHT_DELIVERY_PROGRESS = 0.25;
const WEIGHT_DISPUTE_HISTORY = 0.2;
const WEIGHT_BANK_CONFIRMED = 0.15;
const WEIGHT_FRESHNESS = 0.1;

/** Days after which freshness score starts degrading */
const FRESHNESS_DECAY_DAYS = 30;

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class RiskSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute a risk snapshot for a specific purchase order.
   *
   * The score is a weighted composite:
   *   - Payment locked? (30%)
   *   - Delivery progress (25%)
   *   - Buyer dispute history (20%)
   *   - Instrument bank-confirmed? (15%)
   *   - Days since PO created / freshness (10%)
   */
  async computeForPO(purchaseOrderId: string): Promise<RiskSnapshot> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        paymentLock: { select: { status: true } },
        paymentInstrument: {
          select: { status: true, bankReference: true },
        },
        evidenceAttachments: { select: { id: true }, take: 1 },
      },
    });

    if (!po) {
      return this.emptySnapshot("UNKNOWN");
    }

    // ── Factor 1: Payment locked (0 or 10) ─────────────────
    const paymentLocked =
      po.paymentLock?.status === "LOCKED" ||
      po.paymentInstrument?.status === "LOCKED";
    const paymentScore = paymentLocked ? 10 : 0;

    // ── Factor 2: Delivery progress (0–10) ─────────────────
    const deliveryScore = this.deliveryProgressScore(po.status);

    // ── Factor 3: Buyer dispute history (0–10) ──────────────
    const { rate: buyerDisputeRate, score: disputeScore } =
      await this.buyerDisputeScore(po.buyerId);

    // ── Factor 4: Bank-confirmed instrument (0 or 10) ───────
    const bankReference = po.paymentInstrument?.bankReference ?? null;
    const bankScore = bankReference ? 10 : 0;

    // ── Factor 5: Freshness (0–10) ─────────────────────────
    const freshnessScore = this.freshnessScore(po.createdAt);

    // ── Build factor breakdown ───────────────────────────────
    const factors: RiskFactorScore[] = [
      {
        name: "Payment Security",
        score: paymentScore,
        weight: WEIGHT_PAYMENT_LOCKED,
        weighted: Number((paymentScore * WEIGHT_PAYMENT_LOCKED).toFixed(2)),
        reason: paymentLocked
          ? "Buyer funds are locked in escrow — full protection"
          : "No payment lock — funds are not secured yet",
      },
      {
        name: "Delivery Progress",
        score: deliveryScore,
        weight: WEIGHT_DELIVERY_PROGRESS,
        weighted: Number((deliveryScore * WEIGHT_DELIVERY_PROGRESS).toFixed(2)),
        reason: this.deliveryReason(po.status),
      },
      {
        name: "Buyer Track Record",
        score: disputeScore,
        weight: WEIGHT_DISPUTE_HISTORY,
        weighted: Number((disputeScore * WEIGHT_DISPUTE_HISTORY).toFixed(2)),
        reason:
          buyerDisputeRate === 0
            ? "Buyer has no dispute history — clean record"
            : `Buyer dispute rate is ${(buyerDisputeRate * 100).toFixed(1)}%`,
      },
      {
        name: "Bank Confirmation",
        score: bankScore,
        weight: WEIGHT_BANK_CONFIRMED,
        weighted: Number((bankScore * WEIGHT_BANK_CONFIRMED).toFixed(2)),
        reason: bankReference
          ? `Funds confirmed by bank (${bankReference})`
          : "Awaiting bank confirmation of reserved funds",
      },
      {
        name: "Recency",
        score: freshnessScore,
        weight: WEIGHT_FRESHNESS,
        weighted: Number((freshnessScore * WEIGHT_FRESHNESS).toFixed(2)),
        reason: this.freshnessReason(po.createdAt),
      },
    ];

    // ── Weighted composite ──────────────────────────────────
    const riskScore = Number(
      factors.reduce((sum, f) => sum + f.weighted, 0).toFixed(1),
    );

    // Default probability: inverse of risk score mapped to 0–100
    // Score 10 → ~0%, Score 0 → ~100%
    const defaultProbability = Number(
      Math.max(0, ((10 - riskScore) / 10) * 100).toFixed(1),
    );

    const expectedSettlement = po.expectedDeliveryDate
      ? po.expectedDeliveryDate.toISOString()
      : new Date(
          po.createdAt.getTime() + FRESHNESS_DECAY_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();

    return {
      riskScore,
      defaultProbability,
      paymentLocked,
      instrumentStatus: po.paymentInstrument?.status ?? null,
      deliveryStatus: po.status,
      buyerDisputeRate,
      bankReference,
      expectedSettlement,
      evidencePackAvailable: (po.evidenceAttachments?.length ?? 0) > 0,
      factors,
    };
  }

  /**
   * Batch compute risk snapshots for multiple POs.
   */
  async computeForPOs(
    purchaseOrderIds: string[],
  ): Promise<Map<string, RiskSnapshot>> {
    const results = new Map<string, RiskSnapshot>();
    for (const poId of purchaseOrderIds) {
      results.set(poId, await this.computeForPO(poId));
    }
    return results;
  }

  // ── Private scoring helpers ────────────────────────────────

  /**
   * Map PO status to a delivery progress score (0–10).
   *
   * DRAFT/SUBMITTED/APPROVED → 0 (not yet in motion)
   * ACCEPTED → 3 (supplier committed)
   * FULFILLMENT → 4
   * SHIPPED → 6 (goods in transit)
   * DELIVERED → 8 (buyer received)
   * VERIFIED → 10 (buyer confirmed delivery)
   */
  private deliveryProgressScore(status: string): number {
    switch (status) {
      case "VERIFIED":
      case "SETTLED":
      case "ACKNOWLEDGED":
        return 10;
      case "DELIVERED":
        return 8;
      case "SHIPPED":
        return 6;
      case "FULFILLMENT":
        return 4;
      case "ACCEPTED":
        return 3;
      default:
        return 0;
    }
  }

  /**
   * Compute buyer dispute rate and its inverse score.
   *
   * Rate = disputes / total buyer POs
   * Score = 10 × (1 - rate), so 0% disputes → 10, 100% → 0
   */
  private async buyerDisputeScore(
    buyerId: string,
  ): Promise<{ rate: number; score: number }> {
    const [totalPOs, disputeCount] = await Promise.all([
      this.prisma.purchaseOrder.count({ where: { buyerId } }),
      this.prisma.dispute.count({
        where: { purchaseOrder: { buyerId } },
      }),
    ]);

    if (totalPOs === 0) {
      return { rate: 0, score: 10 }; // No history → assume clean
    }

    const rate = Number((disputeCount / totalPOs).toFixed(3));
    const score = Number((10 * (1 - rate)).toFixed(1));
    return { rate, score };
  }

  /**
   * Freshness score: newer POs score higher.
   *
   * 0 days old → 10
   * FRESHNESS_DECAY_DAYS+ → 0
   * Linear decay in between.
   */
  private freshnessScore(createdAt: Date): number {
    const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays <= 0) return 10;
    if (ageDays >= FRESHNESS_DECAY_DAYS) return 0;
    return Number((10 * (1 - ageDays / FRESHNESS_DECAY_DAYS)).toFixed(1));
  }

  /** Human-readable reason for delivery progress score */
  private deliveryReason(status: string): string {
    switch (status) {
      case "VERIFIED":
      case "SETTLED":
      case "ACKNOWLEDGED":
        return "Delivery verified by buyer — maximum confidence";
      case "DELIVERED":
        return "Goods delivered, awaiting buyer verification";
      case "SHIPPED":
        return "Goods shipped and in transit";
      case "FULFILLMENT":
        return "Supplier is preparing the order";
      case "ACCEPTED":
        return "Supplier accepted — production not yet started";
      default:
        return "Order has not progressed to fulfillment yet";
    }
  }

  /** Human-readable reason for freshness score */
  private freshnessReason(createdAt: Date): string {
    const ageDays = Math.round(
      (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (ageDays <= 1) return "Created today — maximum freshness";
    if (ageDays < FRESHNESS_DECAY_DAYS)
      return `Created ${ageDays} days ago — still within the ${FRESHNESS_DECAY_DAYS}-day freshness window`;
    return `Created ${ageDays} days ago — beyond the ${FRESHNESS_DECAY_DAYS}-day freshness window`;
  }

  private emptySnapshot(deliveryStatus: string): RiskSnapshot {
    return {
      riskScore: 0,
      defaultProbability: 100,
      paymentLocked: false,
      instrumentStatus: null,
      deliveryStatus,
      buyerDisputeRate: 0,
      bankReference: null,
      expectedSettlement: null,
      evidencePackAvailable: false,
      factors: [],
    };
  }
}
