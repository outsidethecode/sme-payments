import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import {
  SETTLEMENT_ADAPTER,
  SettlementAdapter,
  SettlementCurrency,
  TransferStatus,
  TransferResult,
} from "./settlement-adapter.interface";
import { InstrumentService } from "./instrument.service";

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

// ── Webhook types ────────────────────────────────────────────

export type BankWebhookStatus = "CONFIRMED" | "FAILED";

export interface BankWebhookPayload {
  /** Adapter-assigned external reference (e.g. SIM-RSV-xxx, SARIE-RSV-xxx) */
  externalRef: string;
  /** Bank-side outcome */
  status: BankWebhookStatus;
  /** Amount in smallest currency unit (pence / halalah) */
  amount: number;
  /** Bank's own reference (for audit trail) */
  bankReference: string;
  /** ISO-8601 timestamp from the bank */
  timestamp: string;
  /** HMAC-SHA256 signature of the payload */
  signature: string;
}

export interface BankWebhookResult {
  accepted: boolean;
  externalRef: string;
  action: "confirmed" | "failed" | "no-op";
  detail: string;
}

/** Maximum age (ms) for a webhook timestamp before it's rejected (replay protection) */
const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly instrumentService: InstrumentService,
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
   *
   * Async state machine:
   *   1. Create PaymentLock in PENDING state (intent recorded)
   *   2. Log PAYMENT_LOCK_REQUESTED ledger event
   *   3. Call adapter.reserveFunds()
   *   4a. On success → confirmLock() (PENDING → LOCKED)
   *   4b. On failure → failLock()   (PENDING → LOCK_FAILED)
   *
   * This ensures the platform always has a record of the intent
   * before any external call is made (bank state ≠ platform state).
   */
  async reserveForPO(input: ReserveForPOInput): Promise<{
    paymentLockId: string;
    externalRef: string;
    status: TransferStatus;
  }> {
    // Step 0: Create PaymentInstrument (financial contract abstraction)
    const instrument = await this.instrumentService.create(
      {
        purchaseOrderId: input.purchaseOrderId,
        amount: input.amount,
        currency: input.currency,
        payerAccountRef: input.buyerAccountRef,
      },
      input.buyerId,
    );

    // Step 1: Create lock in PENDING state (record intent BEFORE calling bank)
    const lock = await this.prisma.paymentLock.create({
      data: {
        purchaseOrderId: input.purchaseOrderId,
        buyerId: input.buyerId,
        amount: input.amount,
        status: "PENDING",
      },
    });

    // Step 1b: Instrument → LOCK_REQUESTED
    await this.instrumentService.requestLock(instrument.id, input.buyerId);

    // Step 2: Log the request event (immutable intent)
    await this.ledger.logEvent({
      entityType: "PAYMENT_LOCK",
      entityId: lock.id,
      eventType: "PAYMENT_LOCK_REQUESTED",
      actorId: input.buyerId,
      actorRole: "BUYER",
      payload: {
        purchaseOrderId: input.purchaseOrderId,
        amount: input.amount,
        currency: input.currency,
        settlementRail: this.adapter.name,
        instrumentId: instrument.id,
      },
    });

    // Step 3: Call the external adapter
    let result: TransferResult;
    try {
      result = await this.adapter.reserveFunds({
        purchaseOrderId: input.purchaseOrderId,
        payerId: input.buyerId,
        payerAccountRef: input.buyerAccountRef,
        amount: input.amount,
        currency: input.currency,
        description: `Payment lock for PO ${input.purchaseOrderId}`,
      });
    } catch (error) {
      // Adapter threw — record failure on both lock and instrument
      await this.failLock(lock.id, (error as Error).message);
      await this.instrumentService.fail(
        instrument.id,
        (error as Error).message,
        input.buyerId,
      );
      throw new BadRequestException(
        (error as Error).message || "Failed to reserve funds",
      );
    }

    // Step 4: Transition based on adapter result
    if (result.status === TransferStatus.FAILED) {
      const reason = result.failureReason || "Adapter returned FAILED";
      await this.failLock(lock.id, reason);
      await this.instrumentService.fail(instrument.id, reason, input.buyerId);
      throw new BadRequestException(
        result.failureReason || "Failed to reserve funds",
      );
    }

    // Success → confirm lock and instrument
    await this.confirmLock(lock.id, result.externalRef, result.processedAt);
    await this.instrumentService.confirmLock(
      {
        instrumentId: instrument.id,
        bankReference: result.externalRef,
      },
      input.buyerId,
    );

    this.logger.log(
      `Reserved ${input.amount} ${input.currency} for PO ${input.purchaseOrderId} → lock ${lock.id} instrument ${instrument.id} ref ${result.externalRef}`,
    );

    return {
      paymentLockId: lock.id,
      externalRef: result.externalRef,
      status: result.status,
    };
  }

  // ── Lock state transitions ───────────────────────────────

  /**
   * Transition a payment lock from PENDING → LOCKED.
   * Called when the adapter (or a webhook) confirms the reservation.
   */
  async confirmLock(
    lockId: string,
    externalRef: string,
    processedAt: Date,
  ): Promise<void> {
    const lock = await this.prisma.paymentLock.update({
      where: { id: lockId },
      data: {
        status: "LOCKED",
        openBankingRef: externalRef,
        lockedAt: processedAt,
      },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_LOCK",
      entityId: lock.id,
      eventType: "PAYMENT_LOCK_CONFIRMED",
      actorId: lock.buyerId,
      actorRole: "BUYER",
      payload: {
        purchaseOrderId: lock.purchaseOrderId,
        amount: lock.amount,
        externalRef,
        settlementRail: this.adapter.name,
      },
    });

    this.logger.log(`Lock ${lockId} confirmed → LOCKED (ref ${externalRef})`);
  }

  /**
   * Transition a payment lock from PENDING → LOCK_FAILED.
   * Called when the adapter (or a webhook) rejects the reservation.
   */
  async failLock(lockId: string, reason: string): Promise<void> {
    const lock = await this.prisma.paymentLock.update({
      where: { id: lockId },
      data: {
        status: "LOCK_FAILED",
        failedAt: new Date(),
        failureReason: reason,
      },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_LOCK",
      entityId: lock.id,
      eventType: "PAYMENT_LOCK_FAILED",
      actorId: lock.buyerId,
      actorRole: "BUYER",
      payload: {
        purchaseOrderId: lock.purchaseOrderId,
        amount: lock.amount,
        reason,
        settlementRail: this.adapter.name,
      },
    });

    this.logger.warn(`Lock ${lockId} failed → LOCK_FAILED: ${reason}`);
  }

  // ── Settle PO (release to recipient) ─────────────────────

  /**
   * Settle a PO: release locked funds to recipient, deduct platform fee.
   *
   * Async state machine:
   *   1. Look up lock, calculate fees
   *   2. Create Settlement as PROCESSING (intent recorded)
   *   3. Log SETTLEMENT_PROCESSING ledger event
   *   4. Call adapter.releaseFunds()
   *   5a. On success → confirmSettlement() (PROCESSING → COMPLETED)
   *   5b. On failure → failSettlement() (PROCESSING → FAILED)
   */
  async settlePO(input: SettlePOInput): Promise<{
    settlementId: string;
    externalRef: string;
    feeAmount: number;
    netAmount: number;
  }> {
    // Step 1: Look up the payment lock
    const lock = await this.prisma.paymentLock.findUnique({
      where: { purchaseOrderId: input.purchaseOrderId },
    });
    if (!lock || lock.status !== "LOCKED") {
      throw new BadRequestException("No active payment lock for this PO");
    }

    const feeAmount = Math.round((input.totalAmount * input.feeBps) / 10_000);
    const netAmount = input.totalAmount - feeAmount;

    // Step 1b: Instrument → SETTLEMENT_PENDING (if not already transitioned by acknowledgeObligation)
    const instrument = await this.instrumentService.findByPO(
      input.purchaseOrderId,
    );
    if (
      instrument &&
      ["LOCKED", "FINANCING_FUNDED", "FINANCING_REQUESTED"].includes(
        instrument.status,
      )
    ) {
      await this.instrumentService.requestSettlement(
        {
          instrumentId: instrument.id,
          recipientAccountRef: input.recipientAccountRef,
        },
        input.recipientId,
      );
    }

    // Step 2: Create settlement as PROCESSING (intent-first)
    const settlement = await this.prisma.settlement.create({
      data: {
        purchaseOrderId: input.purchaseOrderId,
        fromUserId: lock.buyerId,
        toUserId: input.recipientId,
        amount: netAmount,
        type: input.earlyPaymentRequestId ? "EARLY_PAY_SETTLEMENT" : "STANDARD",
        status: "PROCESSING",
        settlementRail: this.adapter.name,
        currency: input.currency,
      },
    });

    // Step 3: Log processing event (immutable intent)
    await this.ledger.logEvent({
      entityType: "SETTLEMENT",
      entityId: settlement.id,
      eventType: "SETTLEMENT_PROCESSING",
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
        type: input.earlyPaymentRequestId ? "EARLY_PAY_SETTLEMENT" : "STANDARD",
        instrumentId: instrument?.id ?? null,
      },
    });

    // Step 4: Call the external adapter
    let result: TransferResult;
    try {
      result = await this.adapter.releaseFunds({
        reservationRef: lock.openBankingRef || "",
        purchaseOrderId: input.purchaseOrderId,
        recipientId: input.recipientId,
        recipientAccountRef: input.recipientAccountRef,
        amount: netAmount,
        currency: input.currency,
        description: `Settlement for PO ${input.purchaseOrderId}`,
      });
    } catch (error) {
      await this.failSettlement(settlement.id, (error as Error).message);
      if (instrument && instrument.status === "LOCKED") {
        await this.instrumentService
          .fail(instrument.id, (error as Error).message, input.recipientId)
          .catch(() => {}); // best-effort; instrument may already be in SETTLEMENT_PENDING
      }
      throw new BadRequestException(
        (error as Error).message || "Failed to release funds",
      );
    }

    if (result.status === TransferStatus.FAILED) {
      const reason = result.failureReason || "Adapter returned FAILED";
      await this.failSettlement(settlement.id, reason);
      if (
        instrument &&
        ["LOCKED", "SETTLEMENT_PENDING"].includes(instrument.status)
      ) {
        await this.instrumentService
          .fail(instrument.id, reason, input.recipientId)
          .catch(() => {});
      }
      throw new BadRequestException(
        result.failureReason || "Failed to release funds",
      );
    }

    // Step 5: Confirm — update lock, settlement, and platform fee in transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentLock.update({
        where: { id: lock.id },
        data: { status: "RELEASED", releasedAt: new Date() },
      });

      await tx.platformFee.create({
        data: {
          purchaseOrderId: input.purchaseOrderId,
          feeType: "TRANSACTION",
          amount: feeAmount,
        },
      });
    });

    await this.confirmSettlement(
      settlement.id,
      result.externalRef,
      result.processedAt,
    );

    // Step 5b: Instrument → SETTLED
    if (instrument) {
      await this.instrumentService
        .confirmSettlement(
          { instrumentId: instrument.id, bankReference: result.externalRef },
          input.recipientId,
        )
        .catch(() => {}); // best-effort if instrument was already transitioned
    }

    // Log lock release event
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

  // ── Settlement state transitions ─────────────────────────

  /**
   * Transition a settlement from PROCESSING → COMPLETED.
   * Called when the adapter (or a webhook) confirms the transfer.
   */
  async confirmSettlement(
    settlementId: string,
    externalRef: string,
    processedAt: Date,
  ): Promise<void> {
    const settlement = await this.prisma.settlement.update({
      where: { id: settlementId },
      data: {
        status: "COMPLETED",
        externalRef,
        completedAt: processedAt,
      },
    });

    await this.ledger.logEvent({
      entityType: "SETTLEMENT",
      entityId: settlement.id,
      eventType: "SETTLEMENT_CONFIRMED",
      actorId: settlement.toUserId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: settlement.purchaseOrderId,
        amount: settlement.amount,
        externalRef,
        settlementRail: settlement.settlementRail,
        type: settlement.type,
      },
    });

    this.logger.log(
      `Settlement ${settlementId} confirmed → COMPLETED (ref ${externalRef})`,
    );
  }

  /**
   * Transition a settlement from PROCESSING → FAILED.
   * Called when the adapter (or a webhook) rejects the transfer.
   */
  async failSettlement(settlementId: string, reason: string): Promise<void> {
    const settlement = await this.prisma.settlement.update({
      where: { id: settlementId },
      data: {
        status: "FAILED",
        failureReason: reason,
      },
    });

    await this.ledger.logEvent({
      entityType: "SETTLEMENT",
      entityId: settlement.id,
      eventType: "SETTLEMENT_FAILED",
      actorId: settlement.toUserId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: settlement.purchaseOrderId,
        amount: settlement.amount,
        reason,
        settlementRail: settlement.settlementRail,
        type: settlement.type,
      },
    });

    this.logger.warn(`Settlement ${settlementId} failed → FAILED: ${reason}`);
  }

  // ── Transfer advance (LP → Supplier) ─────────────────────

  /**
   * LP advances funds to supplier for early payment.
   *
   * Async state machine:
   *   1. Create Settlement as PROCESSING (intent recorded)
   *   2. Log SETTLEMENT_PROCESSING ledger event
   *   3. Call adapter.transferFunds()
   *   4a. On success → confirmSettlement() (PROCESSING → COMPLETED)
   *   4b. On failure → failSettlement() (PROCESSING → FAILED)
   */
  async transferAdvance(input: TransferAdvanceInput): Promise<{
    settlementId: string;
    externalRef: string;
  }> {
    // Step 1: Create settlement as PROCESSING (intent-first)
    const settlement = await this.prisma.settlement.create({
      data: {
        purchaseOrderId: input.purchaseOrderId,
        fromUserId: input.lpId,
        toUserId: input.supplierId,
        amount: input.amount,
        type: "EARLY_PAY_ADVANCE",
        status: "PROCESSING",
        settlementRail: this.adapter.name,
        currency: input.currency,
      },
    });

    // Step 2: Log processing event (immutable intent)
    await this.ledger.logEvent({
      entityType: "SETTLEMENT",
      entityId: settlement.id,
      eventType: "SETTLEMENT_PROCESSING",
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
        type: "EARLY_PAY_ADVANCE",
      },
    });

    // Step 3: Call the external adapter
    let result: TransferResult;
    try {
      result = await this.adapter.transferFunds({
        purchaseOrderId: input.purchaseOrderId,
        fromId: input.lpId,
        fromAccountRef: input.lpAccountRef,
        toId: input.supplierId,
        toAccountRef: input.supplierAccountRef,
        amount: input.amount,
        currency: input.currency,
        description: `Early payment advance for PO ${input.purchaseOrderId}`,
      });
    } catch (error) {
      await this.failSettlement(settlement.id, (error as Error).message);
      throw new BadRequestException(
        (error as Error).message || "Failed to transfer advance",
      );
    }

    if (result.status === TransferStatus.FAILED) {
      await this.failSettlement(
        settlement.id,
        result.failureReason || "Adapter returned FAILED",
      );
      throw new BadRequestException(
        result.failureReason || "Failed to transfer advance",
      );
    }

    // Step 4: Confirm
    await this.confirmSettlement(
      settlement.id,
      result.externalRef,
      result.processedAt,
    );

    // Log advance-specific event
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
   *
   * Async state machine:
   *   1. Log PAYMENT_LOCK_REFUND_REQUESTED ledger event (intent)
   *   2. Call adapter.refund()
   *   3a. On success → update lock to REFUNDED, log PAYMENT_LOCK_REFUNDED
   *   3b. On failure → throw (lock stays LOCKED)
   */
  async refundPO(input: RefundPOInput): Promise<{
    externalRef: string;
    status: TransferStatus;
  }> {
    // Step 1: Log refund intent (immutable record before external call)
    await this.ledger.logEvent({
      entityType: "PAYMENT_LOCK",
      entityId: input.purchaseOrderId,
      eventType: "PAYMENT_LOCK_REFUND_REQUESTED",
      actorId: input.buyerId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: input.purchaseOrderId,
        amount: input.amount,
        currency: input.currency,
        reason: input.reason,
        reservationRef: input.reservationRef,
        settlementRail: this.adapter.name,
      },
    });

    // Step 2: Call the external adapter
    let result: TransferResult;
    try {
      result = await this.adapter.refund({
        reservationRef: input.reservationRef,
        purchaseOrderId: input.purchaseOrderId,
        recipientId: input.buyerId,
        recipientAccountRef: input.buyerAccountRef,
        amount: input.amount,
        currency: input.currency,
        reason: input.reason,
      });
    } catch (error) {
      this.logger.warn(
        `Refund failed for PO ${input.purchaseOrderId}: ${(error as Error).message}`,
      );
      throw new BadRequestException(
        (error as Error).message || "Failed to refund",
      );
    }

    if (result.status === TransferStatus.FAILED) {
      throw new BadRequestException(result.failureReason || "Failed to refund");
    }

    // Step 3: Update payment lock to REFUNDED
    await this.prisma.paymentLock.update({
      where: { purchaseOrderId: input.purchaseOrderId },
      data: { status: "REFUNDED", releasedAt: new Date() },
    });

    // Step 3b: Refund the instrument if it exists
    const instrument = await this.instrumentService.findByPO(
      input.purchaseOrderId,
    );
    if (instrument && instrument.status === "LOCKED") {
      await this.instrumentService.refund(
        { instrumentId: instrument.id, reason: input.reason || "Refund" },
        input.buyerId,
      );
    }

    // Log confirmed refund event
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
        settlementRail: this.adapter.name,
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
    } else if (
      railResult.status === TransferStatus.PENDING &&
      settlement.status !== "PROCESSING"
    ) {
      newStatus = "PROCESSING";
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
   * Get settlements that may need reconciliation (PENDING or PROCESSING).
   */
  async findPendingSettlements() {
    return this.prisma.settlement.findMany({
      where: { status: { in: ["PENDING", "PROCESSING"] } },
      include: {
        purchaseOrder: {
          select: { id: true, referenceNumber: true, currency: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  // ── Bank webhook handler ─────────────────────────────────

  /**
   * Process an asynchronous bank callback.
   *
   * Flow:
   *   1. Verify HMAC-SHA256 signature (shared secret)
   *   2. Reject replays older than 5 minutes
   *   3. Look up PaymentLock or Settlement by externalRef
   *   4. Idempotency: if already in target state → 200 no-op
   *   5. Transition: confirmLock / failLock / confirmSettlement / failSettlement
   *   6. Log BANK_WEBHOOK_RECEIVED ledger event
   */
  async handleBankCallback(
    payload: BankWebhookPayload,
  ): Promise<BankWebhookResult> {
    // Step 1: Verify HMAC signature
    const secret = process.env.BANK_WEBHOOK_SECRET || "";
    if (!secret) {
      throw new UnauthorizedException("Webhook secret not configured");
    }
    this.verifyWebhookSignature(payload, secret);

    // Step 2: Replay protection
    const webhookAge = Date.now() - new Date(payload.timestamp).getTime();
    if (webhookAge > WEBHOOK_MAX_AGE_MS) {
      throw new BadRequestException(
        `Webhook timestamp too old (${Math.round(webhookAge / 1000)}s)`,
      );
    }

    // Step 3: Look up by externalRef — try PaymentLock first, then Settlement
    const lock = await this.prisma.paymentLock.findFirst({
      where: { openBankingRef: payload.externalRef },
    });

    const settlement = lock
      ? null
      : await this.prisma.settlement.findFirst({
          where: { externalRef: payload.externalRef },
        });

    if (!lock && !settlement) {
      throw new BadRequestException(
        `No lock or settlement found for ref ${payload.externalRef}`,
      );
    }

    let result: BankWebhookResult;

    if (lock) {
      result = await this.handleLockWebhook(lock, payload);
    } else {
      result = await this.handleSettlementWebhook(settlement!, payload);
    }

    // Step 6: Log the webhook event regardless of outcome
    // Use the entity owner as actor (FK constraint requires valid user)
    const actorId = lock ? lock.buyerId : settlement!.toUserId;
    await this.ledger.logEvent({
      entityType: lock ? "PAYMENT_LOCK" : "SETTLEMENT",
      entityId: lock ? lock.id : settlement!.id,
      eventType: "BANK_WEBHOOK_RECEIVED",
      actorId,
      actorRole: "SYSTEM",
      payload: {
        externalRef: payload.externalRef,
        bankReference: payload.bankReference,
        status: payload.status,
        amount: payload.amount,
        action: result.action,
        settlementRail: this.adapter.name,
        source: "BANK_WEBHOOK",
      },
    });

    this.logger.log(
      `Webhook processed: ref=${payload.externalRef} status=${payload.status} action=${result.action}`,
    );

    return result;
  }

  // ── Webhook helpers ──────────────────────────────────────

  /**
   * Verify HMAC-SHA256 signature.
   * Signature is computed over: externalRef|status|amount|bankReference|timestamp
   */
  verifyWebhookSignature(payload: BankWebhookPayload, secret: string): void {
    const message = [
      payload.externalRef,
      payload.status,
      payload.amount,
      payload.bankReference,
      payload.timestamp,
    ].join("|");

    const expected = createHmac("sha256", secret).update(message).digest("hex");

    const sigBuffer = Buffer.from(payload.signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException("Invalid webhook signature");
    }
  }

  private async handleLockWebhook(
    lock: any,
    payload: BankWebhookPayload,
  ): Promise<BankWebhookResult> {
    const ref = payload.externalRef;

    if (payload.status === "CONFIRMED") {
      // Idempotency: already LOCKED → no-op
      if (lock.status === "LOCKED") {
        return {
          accepted: true,
          externalRef: ref,
          action: "no-op",
          detail: "Lock already LOCKED",
        };
      }
      if (lock.status !== "PENDING") {
        return {
          accepted: true,
          externalRef: ref,
          action: "no-op",
          detail: `Lock in terminal state ${lock.status}`,
        };
      }
      await this.confirmLock(lock.id, ref, new Date(payload.timestamp));
      return {
        accepted: true,
        externalRef: ref,
        action: "confirmed",
        detail: "Lock PENDING → LOCKED",
      };
    }

    // status === "FAILED"
    if (lock.status === "LOCK_FAILED") {
      return {
        accepted: true,
        externalRef: ref,
        action: "no-op",
        detail: "Lock already LOCK_FAILED",
      };
    }
    if (lock.status !== "PENDING") {
      return {
        accepted: true,
        externalRef: ref,
        action: "no-op",
        detail: `Lock in terminal state ${lock.status}`,
      };
    }
    await this.failLock(lock.id, `Bank webhook: ${payload.bankReference}`);
    return {
      accepted: true,
      externalRef: ref,
      action: "failed",
      detail: "Lock PENDING → LOCK_FAILED",
    };
  }

  private async handleSettlementWebhook(
    settlement: any,
    payload: BankWebhookPayload,
  ): Promise<BankWebhookResult> {
    const ref = payload.externalRef;

    if (payload.status === "CONFIRMED") {
      // Idempotency: already COMPLETED → no-op
      if (settlement.status === "COMPLETED") {
        return {
          accepted: true,
          externalRef: ref,
          action: "no-op",
          detail: "Settlement already COMPLETED",
        };
      }
      if (settlement.status !== "PROCESSING") {
        return {
          accepted: true,
          externalRef: ref,
          action: "no-op",
          detail: `Settlement in state ${settlement.status}`,
        };
      }
      await this.confirmSettlement(
        settlement.id,
        ref,
        new Date(payload.timestamp),
      );
      return {
        accepted: true,
        externalRef: ref,
        action: "confirmed",
        detail: "Settlement PROCESSING → COMPLETED",
      };
    }

    // status === "FAILED"
    if (settlement.status === "FAILED") {
      return {
        accepted: true,
        externalRef: ref,
        action: "no-op",
        detail: "Settlement already FAILED",
      };
    }
    if (settlement.status !== "PROCESSING") {
      return {
        accepted: true,
        externalRef: ref,
        action: "no-op",
        detail: `Settlement in state ${settlement.status}`,
      };
    }
    await this.failSettlement(
      settlement.id,
      `Bank webhook: ${payload.bankReference}`,
    );
    return {
      accepted: true,
      externalRef: ref,
      action: "failed",
      detail: "Settlement PROCESSING → FAILED",
    };
  }
}
