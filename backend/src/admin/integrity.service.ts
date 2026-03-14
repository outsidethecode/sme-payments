import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

// ── Types ────────────────────────────────────────────────────

export type InvariantSeverity = "CRITICAL" | "HIGH" | "MEDIUM";

export interface InvariantViolation {
  invariantId: string;
  purchaseOrderId: string;
  expected: string;
  actual: string;
  severity: InvariantSeverity;
}

export interface IntegrityCheckResult {
  checkedAt: string;
  totalChecked: number;
  valid: number;
  violations: InvariantViolation[];
}

// ── Constants ────────────────────────────────────────────────

const DEFAULT_INTERVAL_MINUTES = 60;

/**
 * PO statuses where escrow MUST be locked (funds held in escrow).
 * These are post-escrow, pre-settlement states.
 */
const ESCROW_LOCKED_STATUSES = [
  "FULFILLMENT",
  "SHIPPED",
  "DELIVERED",
  "VERIFIED",
] as const;

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class IntegrityService {
  private readonly logger = new Logger(IntegrityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Scheduled cron job ─────────────────────────────────────

  /**
   * Runs every hour by default.
   * Frequency controlled by INTEGRITY_CHECK_INTERVAL_MINUTES env var;
   * uses EVERY_HOUR with early-return pattern (same as ReconciliationService).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const intervalMinutes = parseInt(
      process.env.INTEGRITY_CHECK_INTERVAL_MINUTES ??
        String(DEFAULT_INTERVAL_MINUTES),
      10,
    );

    // 0 = disabled (used in tests)
    if (intervalMinutes <= 0) {
      return;
    }

    this.logger.log("Starting scheduled integrity check…");
    const result = await this.verifyAllInvariants();

    if (result.violations.length > 0) {
      this.logger.warn(
        `Integrity check found ${result.violations.length} violation(s)`,
      );
      for (const v of result.violations) {
        this.logger.warn(
          `  ${v.invariantId} [${v.severity}] PO ${v.purchaseOrderId}: expected ${v.expected}, actual ${v.actual}`,
        );
      }
    } else {
      this.logger.log(
        `Integrity check passed: ${result.valid} POs verified, 0 violations`,
      );
    }
  }

  // ── Core integrity verification ────────────────────────────

  /**
   * Verifies all financial state consistency invariants across the platform.
   * Queries all non-terminal POs with their related entities in a single
   * batch, then evaluates each invariant.
   *
   * @see documentation/financial-state-consistency-rules.md
   */
  async verifyAllInvariants(): Promise<IntegrityCheckResult> {
    const checkedAt = new Date().toISOString();

    // Fetch all POs that are in a state where invariants apply,
    // along with their related financial entities.
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: {
        status: {
          in: [
            "FULFILLMENT",
            "SHIPPED",
            "DELIVERED",
            "VERIFIED",
            "SETTLED",
            "CANCELLED",
          ],
        },
      },
      include: {
        paymentLock: true,
        paymentInstrument: true,
        earlyPaymentRequest: true,
        disputes: true,
      },
    });

    const violations: InvariantViolation[] = [];

    for (const po of purchaseOrders) {
      // ── INV-001 / INV-010 / INV-011 / INV-012: Escrow-locked states require LOCKED PaymentLock ─
      if (
        ESCROW_LOCKED_STATUSES.includes(
          po.status as (typeof ESCROW_LOCKED_STATUSES)[number],
        )
      ) {
        if (!po.paymentLock) {
          violations.push({
            invariantId: this.escrowLockedInvariantId(po.status),
            purchaseOrderId: po.id,
            expected: "PaymentLock exists with status LOCKED",
            actual: "PaymentLock does not exist",
            severity: "CRITICAL",
          });
        } else if (po.paymentLock.status !== "LOCKED") {
          violations.push({
            invariantId: this.escrowLockedInvariantId(po.status),
            purchaseOrderId: po.id,
            expected: "PaymentLock.status = LOCKED",
            actual: `PaymentLock.status = ${po.paymentLock.status}`,
            severity: "CRITICAL",
          });
        }
      }

      // ── INV-002: SETTLED PO requires RELEASED PaymentLock ──────
      if (po.status === "SETTLED") {
        if (!po.paymentLock) {
          violations.push({
            invariantId: "INV-002",
            purchaseOrderId: po.id,
            expected: "PaymentLock exists with status RELEASED",
            actual: "PaymentLock does not exist",
            severity: "CRITICAL",
          });
        } else if (po.paymentLock.status !== "RELEASED") {
          violations.push({
            invariantId: "INV-002",
            purchaseOrderId: po.id,
            expected: "PaymentLock.status = RELEASED",
            actual: `PaymentLock.status = ${po.paymentLock.status}`,
            severity: "CRITICAL",
          });
        }
      }

      // ── INV-003: SETTLED PO requires SETTLED PaymentInstrument ─
      if (po.status === "SETTLED") {
        if (!po.paymentInstrument) {
          violations.push({
            invariantId: "INV-003",
            purchaseOrderId: po.id,
            expected: "PaymentInstrument exists with status SETTLED",
            actual: "PaymentInstrument does not exist",
            severity: "CRITICAL",
          });
        } else if (po.paymentInstrument.status !== "SETTLED") {
          violations.push({
            invariantId: "INV-003",
            purchaseOrderId: po.id,
            expected: "PaymentInstrument.status = SETTLED",
            actual: `PaymentInstrument.status = ${po.paymentInstrument.status}`,
            severity: "CRITICAL",
          });
        }
      }

      // ── INV-004: CANCELLED PO (FULL_REFUND) requires REFUNDED PaymentLock ─
      if (po.status === "CANCELLED") {
        const fullRefundDispute = po.disputes?.find(
          (d) => d.outcome === "FULL_REFUND",
        );
        if (fullRefundDispute) {
          if (!po.paymentLock) {
            violations.push({
              invariantId: "INV-004",
              purchaseOrderId: po.id,
              expected: "PaymentLock exists with status REFUNDED",
              actual: "PaymentLock does not exist",
              severity: "HIGH",
            });
          } else if (po.paymentLock.status !== "REFUNDED") {
            violations.push({
              invariantId: "INV-004",
              purchaseOrderId: po.id,
              expected: "PaymentLock.status = REFUNDED",
              actual: `PaymentLock.status = ${po.paymentLock.status}`,
              severity: "HIGH",
            });
          }
        }
      }

      // ── INV-005: FUNDED EarlyPayment requires LP beneficiary ───
      if (po.earlyPaymentRequest?.status === "FUNDED") {
        if (!po.paymentInstrument) {
          violations.push({
            invariantId: "INV-005",
            purchaseOrderId: po.id,
            expected:
              "PaymentInstrument exists with settlementBeneficiary = LIQUIDITY_PROVIDER",
            actual: "PaymentInstrument does not exist",
            severity: "CRITICAL",
          });
        } else if (
          po.paymentInstrument.settlementBeneficiary !== "LIQUIDITY_PROVIDER"
        ) {
          violations.push({
            invariantId: "INV-005",
            purchaseOrderId: po.id,
            expected:
              "PaymentInstrument.settlementBeneficiary = LIQUIDITY_PROVIDER",
            actual: `PaymentInstrument.settlementBeneficiary = ${po.paymentInstrument.settlementBeneficiary}`,
            severity: "CRITICAL",
          });
        }
      }

      // ── INV-006: PaymentLock amount must equal PO amount ───────
      if (po.paymentLock) {
        if (po.paymentLock.amount !== po.amount) {
          violations.push({
            invariantId: "INV-006",
            purchaseOrderId: po.id,
            expected: `PaymentLock.amount = ${po.amount}`,
            actual: `PaymentLock.amount = ${po.paymentLock.amount}`,
            severity: "HIGH",
          });
        }
      }

      // ── INV-007: PaymentLock currency must match PO currency ───
      if (po.paymentLock) {
        if (po.paymentLock.currency !== po.currency) {
          violations.push({
            invariantId: "INV-007",
            purchaseOrderId: po.id,
            expected: `PaymentLock.currency = ${po.currency}`,
            actual: `PaymentLock.currency = ${po.paymentLock.currency}`,
            severity: "HIGH",
          });
        }
      }

      // ── INV-008: PaymentInstrument amount must equal PO amount ─
      if (po.paymentInstrument) {
        if (po.paymentInstrument.amount !== po.amount) {
          violations.push({
            invariantId: "INV-008",
            purchaseOrderId: po.id,
            expected: `PaymentInstrument.amount = ${po.amount}`,
            actual: `PaymentInstrument.amount = ${po.paymentInstrument.amount}`,
            severity: "HIGH",
          });
        }
      }

      // ── INV-009: PaymentInstrument currency must match PO currency
      if (po.paymentInstrument) {
        if (po.paymentInstrument.currency !== po.currency) {
          violations.push({
            invariantId: "INV-009",
            purchaseOrderId: po.id,
            expected: `PaymentInstrument.currency = ${po.currency}`,
            actual: `PaymentInstrument.currency = ${po.paymentInstrument.currency}`,
            severity: "HIGH",
          });
        }
      }
    }

    const totalChecked = purchaseOrders.length;
    const valid =
      totalChecked - new Set(violations.map((v) => v.purchaseOrderId)).size;

    return { checkedAt, totalChecked, valid, violations };
  }

  // ── Helpers ────────────────────────────────────────────────

  /**
   * Maps a PO status to its specific INV-00x ID for the
   * "escrow must be locked" family of invariants.
   */
  private escrowLockedInvariantId(status: string): string {
    switch (status) {
      case "FULFILLMENT":
        return "INV-001";
      case "SHIPPED":
        return "INV-010";
      case "DELIVERED":
        return "INV-011";
      case "VERIFIED":
        return "INV-012";
      default:
        return "INV-001";
    }
  }
}
