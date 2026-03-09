import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import {
  SETTLEMENT_ADAPTER,
  SettlementAdapter,
  SettlementCurrency,
  TransferStatus,
  TransferResult,
} from "./settlement-adapter.interface";

// ── DTO types ────────────────────────────────────────────────

export interface ReserveForPOInput {
  purchaseOrderId: string;
  buyerId: string;
  buyerAccountRef?: string;
  amount: number;
  currency: SettlementCurrency;
}

export interface SettlePOInput {
  purchaseOrderId: string;
  /** Who receives the net amount (supplier or LP in early-pay) */
  recipientId: string;
  recipientAccountRef?: string;
  totalAmount: number;
  feeBps: number;
  currency: SettlementCurrency;
  /** If set, this is an early-pay settlement */
  earlyPaymentRequestId?: string;
}

export interface TransferAdvanceInput {
  purchaseOrderId: string;
  earlyPaymentRequestId: string;
  lpId: string;
  lpAccountRef?: string;
  supplierId: string;
  supplierAccountRef?: string;
  amount: number;
  currency: SettlementCurrency;
}

export interface RefundPOInput {
  purchaseOrderId: string;
  buyerId: string;
  buyerAccountRef?: string;
  amount: number;
  currency: SettlementCurrency;
  reservationRef: string;
  reason?: string;
}

export interface ReconcileRefInput {
  externalRef: string;
  settlementId: string;
}

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(SETTLEMENT_ADAPTER)
    private readonly adapter: SettlementAdapter,
  ) {}

  /** Returns the name of the active settlement adapter */
  getAdapterName(): string {
    return this.adapter.name;
  }

  // ── Reserve funds (payment lock) ──────────────────────────

  /**
   * Reserve funds from the buyer when a PO is accepted.
   * Creates a PaymentLock record and delegates to the adapter.
   */
  async reserveForPO(input: ReserveForPOInput): Promise<{
    paymentLockId: string;
    externalRef: string;
    status: TransferStatus;
  }> {
    const result = await this.adapter.reserveFunds({
      purchaseOrderId: input.purchaseOrderId,
      payerId: input.buyerId,
      payerAccountRef: input.buyerAccountRef,
      amount: input.amount,
      currency: input.currency,
      description: `Payment lock for PO ${input.purchaseOrderId}`,
    });

    if (result.status === TransferStatus.FAILED) {
      throw new BadRequestException(
        result.failureReason || "Failed to reserve funds",
      );
    }

    // Create PaymentLock record
    const lock = await this.prisma.paymentLock.create({
      data: {
        purchaseOrderId: input.purchaseOrderId,
        buyerId: input.buyerId,
        amount: input.amount,
        status: "LOCKED",
        openBankingRef: result.externalRef,
        lockedAt: result.processedAt,
      },
    });

    // Log payment lock event
    await this.ledger.logEvent({
      entityType: "PAYMENT_LOCK",
      entityId: lock.id,
      eventType: "PAYMENT_LOCK_CONFIRMED",
      actorId: input.buyerId,
      actorRole: "BUYER",
      payload: {
        purchaseOrderId: input.purchaseOrderId,
        amount: input.amount,
        currency: input.currency,
        externalRef: result.externalRef,
        settlementRail: this.adapter.name,
      },
    });

    this.logger.log(
      `Reserved ${input.amount} ${input.currency} for PO ${input.purchaseOrderId} → lock ${lock.id} ref ${result.externalRef}`,
    );

    return {
      paymentLockId: lock.id,
      externalRef: result.externalRef,
      status: result.status,
    };
  }

  // ── Settle PO (release to recipient) ─────────────────────

  /**
   * Complete settlement of a PO: release locked funds to recipient,
   * deduct platform fee, create Settlement record.
   */
  async settlePO(input: SettlePOInput): Promise<{
    settlementId: string;
    externalRef: string;
    feeAmount: number;
    netAmount: number;
  }> {
    // Look up the payment lock to get the reservation ref
    const lock = await this.prisma.paymentLock.findUnique({
      where: { purchaseOrderId: input.purchaseOrderId },
    });
    if (!lock || lock.status !== "LOCKED") {
      throw new BadRequestException("No active payment lock for this PO");
    }

    const feeAmount = Math.round((input.totalAmount * input.feeBps) / 10_000);
    const netAmount = input.totalAmount - feeAmount;

    // Release funds to recipient via adapter
    const result = await this.adapter.releaseFunds({
      reservationRef: lock.openBankingRef || "",
      purchaseOrderId: input.purchaseOrderId,
      recipientId: input.recipientId,
      recipientAccountRef: input.recipientAccountRef,
      amount: netAmount,
      currency: input.currency,
      description: `Settlement for PO ${input.purchaseOrderId}`,
    });

    if (result.status === TransferStatus.FAILED) {
      throw new BadRequestException(
        result.failureReason || "Failed to release funds",
      );
    }

    // Create Settlement + PaymentLock update + PlatformFee in a transaction
    const settlement = await this.prisma.$transaction(async (tx) => {
      // Update payment lock
      await tx.paymentLock.update({
        where: { id: lock.id },
        data: { status: "RELEASED", releasedAt: new Date() },
      });

      // Create settlement record
      const s = await tx.settlement.create({
        data: {
          purchaseOrderId: input.purchaseOrderId,
          fromUserId: lock.buyerId,
          toUserId: input.recipientId,
          amount: netAmount,
          type: input.earlyPaymentRequestId
            ? "EARLY_PAY_SETTLEMENT"
            : "STANDARD",
          status: "COMPLETED",
          completedAt: result.processedAt,
          externalRef: result.externalRef,
          settlementRail: this.adapter.name,
          currency: input.currency,
        },
      });

      // Platform fee
      await tx.platformFee.create({
        data: {
          purchaseOrderId: input.purchaseOrderId,
          feeType: "TRANSACTION",
          amount: feeAmount,
        },
      });

      return s;
    });

    // Log settlement events
    await this.ledger.logEvent({
      entityType: "PAYMENT_LOCK",
      entityId: lock.id,
      eventType: "PAYMENT_LOCK_RELEASED",
      actorId: input.recipientId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: input.purchaseOrderId,
        amount: input.totalAmount,
        currency: input.currency,
      },
    });

    await this.ledger.logEvent({
      entityType: "SETTLEMENT",
      entityId: settlement.id,
      eventType: "SETTLEMENT_INITIATED",
      actorId: input.recipientId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: input.purchaseOrderId,
        recipientId: input.recipientId,
        totalAmount: input.totalAmount,
        feeAmount,
        netAmount,
        currency: input.currency,
        settlementRail: this.adapter.name,
        externalRef: result.externalRef,
        type: input.earlyPaymentRequestId ? "EARLY_PAY_SETTLEMENT" : "STANDARD",
      },
    });

    this.logger.log(
      `Settled PO ${input.purchaseOrderId}: ${netAmount} ${input.currency} → ${input.recipientId} (fee ${feeAmount})`,
    );

    return {
      settlementId: settlement.id,
      externalRef: result.externalRef,
      feeAmount,
      netAmount,
    };
  }

  // ── Transfer advance (LP → Supplier) ─────────────────────

  /**
   * LP advances funds to supplier for early payment.
   * This is a direct transfer, not a release of locked funds.
   */
  async transferAdvance(input: TransferAdvanceInput): Promise<{
    settlementId: string;
    externalRef: string;
  }> {
    const result = await this.adapter.transferFunds({
      purchaseOrderId: input.purchaseOrderId,
      fromId: input.lpId,
      fromAccountRef: input.lpAccountRef,
      toId: input.supplierId,
      toAccountRef: input.supplierAccountRef,
      amount: input.amount,
      currency: input.currency,
      description: `Early payment advance for PO ${input.purchaseOrderId}`,
    });

    if (result.status === TransferStatus.FAILED) {
      throw new BadRequestException(
        result.failureReason || "Failed to transfer advance",
      );
    }

    // Record the advance settlement
    const settlement = await this.prisma.settlement.create({
      data: {
        purchaseOrderId: input.purchaseOrderId,
        fromUserId: input.lpId,
        toUserId: input.supplierId,
        amount: input.amount,
        type: "EARLY_PAY_ADVANCE",
        status: "COMPLETED",
        completedAt: result.processedAt,
        externalRef: result.externalRef,
        settlementRail: this.adapter.name,
        currency: input.currency,
      },
    });

    // Log advance transfer event
    await this.ledger.logEvent({
      entityType: "SETTLEMENT",
      entityId: settlement.id,
      eventType: "EARLY_PAY_FUNDED",
      actorId: input.lpId,
      actorRole: "LIQUIDITY_PARTNER",
      payload: {
        purchaseOrderId: input.purchaseOrderId,
        earlyPaymentRequestId: input.earlyPaymentRequestId,
        lpId: input.lpId,
        supplierId: input.supplierId,
        amount: input.amount,
        currency: input.currency,
        settlementRail: this.adapter.name,
        externalRef: result.externalRef,
      },
    });

    this.logger.log(
      `Advanced ${input.amount} ${input.currency} LP→Supplier for PO ${input.purchaseOrderId}`,
    );

    return {
      settlementId: settlement.id,
      externalRef: result.externalRef,
    };
  }

  // ── Refund locked funds ──────────────────────────────────

  /**
   * Refund previously locked funds back to the buyer.
   * Used when a PO is cancelled after payment lock.
   */
  async refundPO(input: RefundPOInput): Promise<{
    externalRef: string;
    status: TransferStatus;
  }> {
    const result = await this.adapter.refund({
      reservationRef: input.reservationRef,
      purchaseOrderId: input.purchaseOrderId,
      recipientId: input.buyerId,
      recipientAccountRef: input.buyerAccountRef,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
    });

    if (result.status === TransferStatus.FAILED) {
      throw new BadRequestException(result.failureReason || "Failed to refund");
    }

    // Update payment lock
    await this.prisma.paymentLock.update({
      where: { purchaseOrderId: input.purchaseOrderId },
      data: { status: "REFUNDED", releasedAt: new Date() },
    });

    // Log refund event
    await this.ledger.logEvent({
      entityType: "PAYMENT_LOCK",
      entityId: input.purchaseOrderId,
      eventType: "PAYMENT_LOCK_REFUNDED",
      actorId: input.buyerId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: input.purchaseOrderId,
        amount: input.amount,
        currency: input.currency,
        reason: input.reason,
        externalRef: result.externalRef,
      },
    });

    this.logger.log(
      `Refunded ${input.amount} ${input.currency} for PO ${input.purchaseOrderId}`,
    );

    return {
      externalRef: result.externalRef,
      status: result.status,
    };
  }

  // ── Reconcile ────────────────────────────────────────────

  /**
   * Check the status of a settlement's external reference against
   * the payment rail and update our records if needed.
   */
  async reconcile(input: ReconcileRefInput): Promise<{
    externalRef: string;
    previousStatus: string;
    currentStatus: string;
    changed: boolean;
  }> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: input.settlementId },
    });

    if (!settlement) {
      throw new BadRequestException("Settlement not found");
    }

    const railResult = await this.adapter.reconcile({
      externalRef: input.externalRef,
    });

    const previousStatus = settlement.status;
    let newStatus = settlement.status;

    // Map rail status to our settlement status
    if (
      railResult.status === TransferStatus.COMPLETED &&
      settlement.status !== "COMPLETED"
    ) {
      newStatus = "COMPLETED";
    } else if (
      railResult.status === TransferStatus.FAILED &&
      settlement.status !== "FAILED"
    ) {
      newStatus = "FAILED";
    }

    const changed = newStatus !== previousStatus;

    if (changed) {
      await this.prisma.settlement.update({
        where: { id: input.settlementId },
        data: {
          status: newStatus as any,
          completedAt:
            newStatus === "COMPLETED" ? railResult.confirmedAt : undefined,
        },
      });

      this.logger.log(
        `Reconciled settlement ${input.settlementId}: ${previousStatus} → ${newStatus}`,
      );
    }

    return {
      externalRef: input.externalRef,
      previousStatus,
      currentStatus: newStatus,
      changed,
    };
  }

  // ── Query helpers ────────────────────────────────────────

  /**
   * Get all settlements for a PO.
   */
  async findByPO(purchaseOrderId: string) {
    return this.prisma.settlement.findMany({
      where: { purchaseOrderId },
      include: {
        fromUser: { select: { id: true, name: true, companyName: true } },
        toUser: { select: { id: true, name: true, companyName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get all settlements visible to a user (by role).
   */
  async findAll(userId: string, role: string) {
    const where: Record<string, unknown> =
      role === "ADMIN"
        ? {}
        : { OR: [{ fromUserId: userId }, { toUserId: userId }] };

    return this.prisma.settlement.findMany({
      where,
      include: {
        purchaseOrder: {
          select: {
            id: true,
            referenceNumber: true,
            amount: true,
            currency: true,
            status: true,
          },
        },
        fromUser: { select: { id: true, name: true, companyName: true } },
        toUser: { select: { id: true, name: true, companyName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get pending settlements that may need reconciliation.
   */
  async findPendingSettlements() {
    return this.prisma.settlement.findMany({
      where: { status: "PENDING" },
      include: {
        purchaseOrder: {
          select: { id: true, referenceNumber: true, currency: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }
}
