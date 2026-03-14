import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OrganisationsService } from "../organisations/organisations.service";
import { SettlementCurrency } from "./settlement-adapter.interface";

/**
 * Platform fee constants.
 * Canonical source: packages/shared/src/constants/config.ts → PLATFORM_FEES
 */
const PLATFORM_TRANSACTION_FEE_BPS = 50; // 0.5%

/** Calculate fee in smallest currency unit (matches shared/utils calculateServiceFee). */
function calculateServiceFee(amount: number, feeBps: number): number {
  return Math.round((amount * feeBps) / 10_000);
}

// ── Types ────────────────────────────────────────────────────

export type SettlementRecipientType =
  | "SUPPLIER"
  | "LIQUIDITY_PROVIDER"
  | "BUYER";

export interface SettlementPlan {
  /** Who receives the net settlement amount */
  recipient: SettlementRecipientType;
  recipientUserId: string;
  recipientBankIban: string | null;
  /** PO gross amount (smallest currency unit) */
  grossAmount: number;
  /** Platform fee amount deducted */
  platformFee: number;
  /** Fee in basis points used */
  feeBps: number;
  /** Net amount paid to recipient */
  netAmount: number;
  currency: SettlementCurrency;
  /** If LP repayment, link to the early payment request */
  earlyPaymentRequestId?: string;
}

export type DisputeOutcomeType =
  | "FULL_REFUND"
  | "PARTIAL_REFUND"
  | "RELEASE_TO_SUPPLIER"
  | "REWORK";

export interface DisputeSettlementPlan {
  outcome: DisputeOutcomeType;
  /** New PO status after dispute resolution */
  newPoStatus: string;
  /** Settlement actions to execute (in order) */
  actions: DisputeSettlementAction[];
}

export type DisputeSettlementAction =
  | {
      type: "REFUND";
      recipientUserId: string;
      amount: number;
      currency: SettlementCurrency;
      reason: string;
    }
  | {
      type: "SETTLE";
      recipientUserId: string;
      recipientBankIban: string | null;
      grossAmount: number;
      platformFee: number;
      feeBps: number;
      netAmount: number;
      currency: SettlementCurrency;
    }
  | { type: "NOOP"; reason: string };

// ── Service ──────────────────────────────────────────────────

/**
 * Single source of truth for settlement routing decisions.
 *
 * Centralises:
 *   - Recipient resolution (supplier vs LP vs buyer)
 *   - Fee calculation (using shared PLATFORM_FEES constants)
 *   - Dispute outcome → settlement action mapping
 *
 * Consumed by PurchaseOrdersService.acknowledgeObligation() and
 * DisputesService.resolve() — neither should contain inline routing logic.
 *
 * @see documentation/operational-financial-hardening-plan.md — Phase 2
 */
@Injectable()
export class SettlementRouterService {
  private readonly logger = new Logger(SettlementRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganisationsService,
  ) {}

  // ── Normal settlement routing ──────────────────────────────

  /**
   * Determine the settlement plan for a PO that has reached VERIFIED.
   * Returns who gets paid, how much, and the fee breakdown.
   *
   * @param poId - Purchase order ID
   * @returns SettlementPlan with recipient, amounts, and fee breakdown
   */
  async resolveSettlement(poId: string): Promise<SettlementPlan> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { id: true, amount: true, currency: true, supplierId: true },
    });
    if (!po) throw new BadRequestException(`PO ${poId} not found`);

    const instrument = await this.prisma.paymentInstrument.findUnique({
      where: { purchaseOrderId: poId },
    });
    if (!instrument) {
      throw new BadRequestException(`PO ${poId} has no payment instrument`);
    }

    const earlyPay = await this.prisma.earlyPaymentRequest.findUnique({
      where: { purchaseOrderId: poId },
    });

    const currency = (po.currency || "GBP") as SettlementCurrency;
    const feeBps = PLATFORM_TRANSACTION_FEE_BPS;
    const platformFee = calculateServiceFee(po.amount, feeBps);
    const netAmount = po.amount - platformFee;

    // Resolve recipient from instrument beneficiary
    const resolved = await this.resolveRecipient(
      instrument.settlementBeneficiary,
      po.supplierId,
      earlyPay,
    );

    return {
      recipient: resolved.type,
      recipientUserId: resolved.userId,
      recipientBankIban: resolved.bankIban,
      grossAmount: po.amount,
      platformFee,
      feeBps,
      netAmount,
      currency,
      earlyPaymentRequestId:
        resolved.type === "LIQUIDITY_PROVIDER" && earlyPay
          ? earlyPay.id
          : undefined,
    };
  }

  // ── Dispute settlement routing ─────────────────────────────

  /**
   * Determine the settlement actions for a dispute resolution.
   * Returns the new PO status and an ordered list of settlement actions.
   *
   * @param poId - Purchase order ID
   * @param outcome - Dispute resolution outcome
   * @param refundAmount - Required for PARTIAL_REFUND
   * @param resolutionNotes - Admin notes (used in refund reason)
   */
  async resolveDisputeSettlement(
    poId: string,
    outcome: DisputeOutcomeType,
    refundAmount?: number,
    resolutionNotes?: string,
  ): Promise<DisputeSettlementPlan> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { paymentLock: true },
    });
    if (!po) throw new BadRequestException(`PO ${poId} not found`);

    const currency = (po.currency || "GBP") as SettlementCurrency;
    const lock = po.paymentLock;
    const hasLockedFunds = lock && lock.status === "LOCKED";

    const newPoStatus = this.mapOutcomeToPoStatus(outcome);

    const actions: DisputeSettlementAction[] = [];

    switch (outcome) {
      case "FULL_REFUND": {
        if (hasLockedFunds) {
          actions.push({
            type: "REFUND",
            recipientUserId: po.buyerId,
            amount: po.amount,
            currency,
            reason: `Dispute full refund: ${resolutionNotes || "N/A"}`,
          });
        } else {
          actions.push({
            type: "NOOP",
            reason: "No locked funds to refund",
          });
        }
        break;
      }

      case "PARTIAL_REFUND": {
        if (!refundAmount || refundAmount <= 0) {
          throw new BadRequestException(
            "Partial refund requires a positive refundAmount",
          );
        }
        if (refundAmount >= po.amount) {
          throw new BadRequestException(
            "Partial refund must be less than the PO amount. Use FULL_REFUND for full amount.",
          );
        }

        if (hasLockedFunds) {
          // Step 1: Refund partial amount to buyer
          actions.push({
            type: "REFUND",
            recipientUserId: po.buyerId,
            amount: refundAmount,
            currency,
            reason: `Dispute partial refund: ${resolutionNotes || "N/A"}`,
          });

          // NOTE: Settling the remainder to the supplier after a partial refund
          // requires the payment lock to remain in a state that allows settlement.
          // Currently refundPO() marks the lock as REFUNDED, blocking settlePO().
          // A future enhancement (Phase 3+) should add a PARTIALLY_REFUNDED lock
          // state to support this flow. For now, the PO status is set to SETTLED
          // by the dispute resolver, signalling that the partial amount was handled.
        } else {
          actions.push({
            type: "NOOP",
            reason: "No locked funds to refund",
          });
        }
        break;
      }

      case "RELEASE_TO_SUPPLIER": {
        if (hasLockedFunds) {
          const feeBps = PLATFORM_TRANSACTION_FEE_BPS;
          const platformFee = calculateServiceFee(po.amount, feeBps);
          const supplierOrg = await this.orgs.getOrgByUserId(po.supplierId);

          actions.push({
            type: "SETTLE",
            recipientUserId: po.supplierId,
            recipientBankIban: supplierOrg?.bankIban || null,
            grossAmount: po.amount,
            platformFee,
            feeBps,
            netAmount: po.amount - platformFee,
            currency,
          });
        } else {
          actions.push({
            type: "NOOP",
            reason: "No locked funds to release",
          });
        }
        break;
      }

      case "REWORK": {
        actions.push({
          type: "NOOP",
          reason: "PO returned to FULFILLMENT — no settlement action",
        });
        break;
      }
    }

    return { outcome, newPoStatus, actions };
  }

  // ── Shared helpers ─────────────────────────────────────────

  /**
   * Resolve the settlement recipient from the instrument's beneficiary field.
   * This is the SINGLE SOURCE OF TRUTH for who gets paid.
   */
  private async resolveRecipient(
    settlementBeneficiary: string | null,
    supplierId: string,
    earlyPay: { liquidityPartnerId: string | null; status: string } | null,
  ): Promise<{
    type: SettlementRecipientType;
    userId: string;
    bankIban: string | null;
  }> {
    const beneficiary = settlementBeneficiary || "SUPPLIER";

    if (beneficiary === "LIQUIDITY_PROVIDER" && earlyPay?.liquidityPartnerId) {
      const org = await this.orgs.getOrgByUserId(earlyPay.liquidityPartnerId);
      return {
        type: "LIQUIDITY_PROVIDER",
        userId: earlyPay.liquidityPartnerId,
        bankIban: org?.bankIban || null,
      };
    }

    if (beneficiary === "BUYER") {
      // Future: direct buyer refund routing
      return { type: "BUYER", userId: supplierId, bankIban: null };
    }

    // Default: pay the supplier
    const org = await this.orgs.getOrgByUserId(supplierId);
    return {
      type: "SUPPLIER",
      userId: supplierId,
      bankIban: org?.bankIban || null,
    };
  }

  /**
   * Map dispute outcome to resulting PO status.
   */
  private mapOutcomeToPoStatus(outcome: DisputeOutcomeType): string {
    switch (outcome) {
      case "FULL_REFUND":
        return "CANCELLED";
      case "PARTIAL_REFUND":
        return "SETTLED";
      case "RELEASE_TO_SUPPLIER":
        return "VERIFIED";
      case "REWORK":
        return "FULFILLMENT";
      default:
        return "DISPUTED";
    }
  }
}
