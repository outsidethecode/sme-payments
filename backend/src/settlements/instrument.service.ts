import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { Currency } from "@prisma/client";

// ── Types ────────────────────────────────────────────────────

export type InstrumentStatusType =
  | "CREATED"
  | "LOCK_REQUESTED"
  | "LOCKED"
  | "FINANCING_REQUESTED"
  | "FINANCING_FUNDED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "REFUNDED"
  | "FAILED";

export type SettlementBeneficiaryType =
  | "SUPPLIER"
  | "LIQUIDITY_PROVIDER"
  | "BUYER";

export interface CreateInstrumentInput {
  purchaseOrderId: string;
  amount: number;
  currency: string;
  payerAccountRef?: string;
  buyerOrgId?: string;
  supplierOrgId?: string;
  escrowAccountId?: string;
}

export interface ConfirmLockInput {
  instrumentId: string;
  bankReference: string;
  escrowReference?: string;
}

export interface RequestSettlementInput {
  instrumentId: string;
  recipientAccountRef?: string;
}

export interface ConfirmSettlementInput {
  instrumentId: string;
  bankReference: string;
}

export interface ConfirmFinancingInput {
  instrumentId: string;
  financingPartnerId: string;
}

export interface RefundInstrumentInput {
  instrumentId: string;
  reason: string;
}

// ── Valid transitions ────────────────────────────────────────

const VALID_TRANSITIONS: Record<InstrumentStatusType, InstrumentStatusType[]> =
  {
    CREATED: ["LOCK_REQUESTED", "FAILED"],
    LOCK_REQUESTED: ["LOCKED", "FAILED"],
    LOCKED: ["FINANCING_REQUESTED", "SETTLEMENT_PENDING", "REFUNDED"],
    FINANCING_REQUESTED: ["FINANCING_FUNDED", "SETTLEMENT_PENDING", "FAILED"],
    FINANCING_FUNDED: ["SETTLEMENT_PENDING"],
    SETTLEMENT_PENDING: ["SETTLED", "FAILED"],
    SETTLED: [],
    REFUNDED: [],
    FAILED: [],
  };

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class InstrumentService {
  private readonly logger = new Logger(InstrumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  // ── Create ─────────────────────────────────────────────────

  /**
   * Create a new PaymentInstrument in CREATED status.
   * settlementBeneficiary defaults to SUPPLIER.
   */
  async create(input: CreateInstrumentInput, actorId: string) {
    const instrument = await this.prisma.paymentInstrument.create({
      data: {
        purchaseOrderId: input.purchaseOrderId,
        amount: input.amount,
        currency: input.currency as Currency,
        payerAccountRef: input.payerAccountRef ?? null,
        status: "CREATED",
        settlementBeneficiary: "SUPPLIER",
        buyerOrgId: input.buyerOrgId ?? null,
        supplierOrgId: input.supplierOrgId ?? null,
        escrowAccountId: input.escrowAccountId ?? null,
      },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: instrument.id,
      eventType: "INSTRUMENT_CREATED",
      actorId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: input.purchaseOrderId,
        amount: input.amount,
        currency: input.currency,
        payerAccountRef: input.payerAccountRef ?? null,
        settlementBeneficiary: "SUPPLIER",
      },
    });

    this.logger.log(
      `Instrument ${instrument.id} created for PO ${input.purchaseOrderId}`,
    );

    return instrument;
  }

  // ── Request Lock ───────────────────────────────────────────

  /**
   * Transition CREATED → LOCK_REQUESTED.
   * Called when the platform is about to call the bank adapter.
   */
  async requestLock(instrumentId: string, actorId: string) {
    const instrument = await this.findAndValidateTransition(
      instrumentId,
      "LOCK_REQUESTED",
    );

    const updated = await this.prisma.paymentInstrument.update({
      where: { id: instrumentId },
      data: { status: "LOCK_REQUESTED" },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: instrument.id,
      eventType: "INSTRUMENT_LOCK_REQUESTED",
      actorId,
      actorRole: "BUYER",
      payload: {
        purchaseOrderId: instrument.purchaseOrderId,
        amount: instrument.amount,
        currency: instrument.currency,
        previousStatus: instrument.status,
      },
    });

    this.logger.log(`Instrument ${instrumentId}: CREATED → LOCK_REQUESTED`);

    return updated;
  }

  // ── Confirm Lock ───────────────────────────────────────────

  /**
   * Transition LOCK_REQUESTED → LOCKED.
   * Called when the bank confirms the reservation.
   */
  async confirmLock(input: ConfirmLockInput, actorId: string) {
    const instrument = await this.findAndValidateTransition(
      input.instrumentId,
      "LOCKED",
    );

    const updated = await this.prisma.paymentInstrument.update({
      where: { id: input.instrumentId },
      data: {
        status: "LOCKED",
        bankReference: input.bankReference,
        escrowReference: input.escrowReference ?? null,
        lockedAt: new Date(),
      },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: instrument.id,
      eventType: "INSTRUMENT_LOCKED",
      actorId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: instrument.purchaseOrderId,
        amount: instrument.amount,
        currency: instrument.currency,
        bankReference: input.bankReference,
        escrowReference: input.escrowReference ?? null,
      },
    });

    this.logger.log(
      `Instrument ${input.instrumentId}: LOCK_REQUESTED → LOCKED (bank ref: ${input.bankReference})`,
    );

    return updated;
  }

  // ── Request Financing ──────────────────────────────────────

  /**
   * Transition LOCKED → FINANCING_REQUESTED.
   * Called when a supplier requests early payment for this instrument.
   */
  async requestFinancing(instrumentId: string, actorId: string) {
    const instrument = await this.findAndValidateTransition(
      instrumentId,
      "FINANCING_REQUESTED",
    );

    const updated = await this.prisma.paymentInstrument.update({
      where: { id: instrumentId },
      data: { status: "FINANCING_REQUESTED" },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: instrument.id,
      eventType: "FINANCING_REQUESTED",
      actorId,
      actorRole: "SUPPLIER",
      payload: {
        purchaseOrderId: instrument.purchaseOrderId,
        amount: instrument.amount,
        currency: instrument.currency,
        settlementBeneficiary: instrument.settlementBeneficiary,
      },
    });

    this.logger.log(`Instrument ${instrumentId}: LOCKED → FINANCING_REQUESTED`);

    return updated;
  }

  // ── Confirm Financing (atomic beneficiary flip) ────────────

  /**
   * Transition FINANCING_REQUESTED → FINANCING_FUNDED.
   * Atomically flips settlementBeneficiary from SUPPLIER to LIQUIDITY_PROVIDER.
   *
   * Uses SELECT FOR UPDATE to serialize concurrent access — this is the
   * core protection against double-payment race conditions.
   */
  async confirmFinancing(input: ConfirmFinancingInput, actorId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      // SELECT FOR UPDATE — serializes concurrent access
      const rows = await tx.$queryRaw<any[]>`
        SELECT * FROM payment_instruments
        WHERE id = ${input.instrumentId}
        FOR UPDATE
      `;

      const instrument = rows[0];
      if (!instrument) {
        throw new BadRequestException(
          `Payment instrument ${input.instrumentId} not found`,
        );
      }

      const status = instrument.status as InstrumentStatusType;
      if (status !== "FINANCING_REQUESTED") {
        throw new BadRequestException(
          `Cannot fund: instrument is ${status}, expected FINANCING_REQUESTED`,
        );
      }

      if (instrument.settlement_beneficiary !== "SUPPLIER") {
        throw new BadRequestException(
          `Cannot fund: beneficiary already set to ${instrument.settlement_beneficiary}`,
        );
      }

      return tx.paymentInstrument.update({
        where: { id: input.instrumentId },
        data: {
          status: "FINANCING_FUNDED",
          settlementBeneficiary: "LIQUIDITY_PROVIDER",
          financingPartnerId: input.financingPartnerId,
        },
      });
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: input.instrumentId,
      eventType: "FINANCING_FUNDED",
      actorId,
      actorRole: "LIQUIDITY_PARTNER",
      payload: {
        purchaseOrderId: updated.purchaseOrderId,
        amount: updated.amount,
        currency: updated.currency,
        previousBeneficiary: "SUPPLIER",
        newBeneficiary: "LIQUIDITY_PROVIDER",
        financingPartnerId: input.financingPartnerId,
      },
    });

    this.logger.log(
      `Instrument ${input.instrumentId}: FINANCING_REQUESTED → FINANCING_FUNDED (beneficiary → LIQUIDITY_PROVIDER)`,
    );

    return updated;
  }

  // ── Revert Financing (compensating transaction) ────────────

  /**
   * Revert FINANCING_FUNDED → LOCKED (or FINANCING_REQUESTED → LOCKED).
   * Used as a compensating transaction when the bank adapter fails after
   * the beneficiary was flipped.
   */
  async revertFinancing(instrumentId: string, actorId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT * FROM payment_instruments
        WHERE id = ${instrumentId}
        FOR UPDATE
      `;

      const instrument = rows[0];
      if (!instrument) {
        throw new BadRequestException(
          `Payment instrument ${instrumentId} not found`,
        );
      }

      const status = instrument.status as InstrumentStatusType;
      if (status !== "FINANCING_FUNDED" && status !== "FINANCING_REQUESTED") {
        throw new BadRequestException(
          `Cannot revert financing: instrument is ${status}`,
        );
      }

      return tx.paymentInstrument.update({
        where: { id: instrumentId },
        data: {
          status: "LOCKED",
          settlementBeneficiary: "SUPPLIER",
          financingPartnerId: null,
        },
      });
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: instrumentId,
      eventType: "FINANCING_REVERTED",
      actorId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: updated.purchaseOrderId,
        reason: "Bank adapter failure — compensating transaction",
        previousBeneficiary: "LIQUIDITY_PROVIDER",
        newBeneficiary: "SUPPLIER",
      },
    });

    this.logger.warn(
      `Instrument ${instrumentId}: FINANCING reverted → LOCKED (beneficiary → SUPPLIER)`,
    );

    return updated;
  }

  // ── Request Settlement ─────────────────────────────────────

  /**
   * Transition LOCKED | FINANCING_FUNDED → SETTLEMENT_PENDING.
   * Uses SELECT FOR UPDATE to atomically block LP funding.
   *
   * This is the settlement gate — once SETTLEMENT_PENDING, no LP can fund.
   */
  async requestSettlement(input: RequestSettlementInput, actorId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT * FROM payment_instruments
        WHERE id = ${input.instrumentId}
        FOR UPDATE
      `;

      const instrument = rows[0];
      if (!instrument) {
        throw new BadRequestException(
          `Payment instrument ${input.instrumentId} not found`,
        );
      }

      const status = instrument.status as InstrumentStatusType;
      const allowed = VALID_TRANSITIONS[status];
      if (!allowed.includes("SETTLEMENT_PENDING")) {
        throw new BadRequestException(
          `Invalid instrument transition: ${status} → SETTLEMENT_PENDING`,
        );
      }

      return tx.paymentInstrument.update({
        where: { id: input.instrumentId },
        data: {
          status: "SETTLEMENT_PENDING",
          recipientAccountRef: input.recipientAccountRef ?? null,
        },
      });
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: input.instrumentId,
      eventType: "SETTLEMENT_INITIATED",
      actorId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: updated.purchaseOrderId,
        amount: updated.amount,
        currency: updated.currency,
        settlementBeneficiary: updated.settlementBeneficiary,
        recipientAccountRef: input.recipientAccountRef ?? null,
      },
    });

    this.logger.log(
      `Instrument ${input.instrumentId}: → SETTLEMENT_PENDING (beneficiary: ${updated.settlementBeneficiary})`,
    );

    return updated;
  }

  // ── Confirm Settlement ─────────────────────────────────────

  /**
   * Transition SETTLEMENT_PENDING → SETTLED.
   * Called when the bank confirms the release.
   */
  async confirmSettlement(input: ConfirmSettlementInput, actorId: string) {
    const instrument = await this.findAndValidateTransition(
      input.instrumentId,
      "SETTLED",
    );

    const updated = await this.prisma.paymentInstrument.update({
      where: { id: input.instrumentId },
      data: {
        status: "SETTLED",
        bankReference: input.bankReference,
        settledAt: new Date(),
      },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: instrument.id,
      eventType: "INSTRUMENT_SETTLED",
      actorId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: instrument.purchaseOrderId,
        amount: instrument.amount,
        currency: instrument.currency,
        bankReference: input.bankReference,
        settlementBeneficiary: updated.settlementBeneficiary,
      },
    });

    this.logger.log(
      `Instrument ${input.instrumentId}: SETTLEMENT_PENDING → SETTLED (bank ref: ${input.bankReference})`,
    );

    return updated;
  }

  // ── Refund ─────────────────────────────────────────────────

  /**
   * Transition LOCKED → REFUNDED.
   * Called when a locked instrument needs to be refunded (e.g. dispute).
   * Sets beneficiary to BUYER.
   */
  async refund(input: RefundInstrumentInput, actorId: string) {
    const instrument = await this.findAndValidateTransition(
      input.instrumentId,
      "REFUNDED",
    );

    const updated = await this.prisma.paymentInstrument.update({
      where: { id: input.instrumentId },
      data: {
        status: "REFUNDED",
        settlementBeneficiary: "BUYER",
        failureReason: input.reason,
        settledAt: new Date(), // marks the time funds were returned
      },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: instrument.id,
      eventType: "INSTRUMENT_REFUNDED",
      actorId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: instrument.purchaseOrderId,
        amount: instrument.amount,
        currency: instrument.currency,
        reason: input.reason,
        settlementBeneficiary: "BUYER",
      },
    });

    this.logger.log(
      `Instrument ${input.instrumentId}: LOCKED → REFUNDED (${input.reason})`,
    );

    return updated;
  }

  // ── Fail ───────────────────────────────────────────────────

  /**
   * Transition to FAILED state (from CREATED, LOCK_REQUESTED, FINANCING_REQUESTED, or SETTLEMENT_PENDING).
   */
  async fail(instrumentId: string, reason: string, actorId: string) {
    const instrument = await this.findAndValidateTransition(
      instrumentId,
      "FAILED",
    );

    const updated = await this.prisma.paymentInstrument.update({
      where: { id: instrumentId },
      data: {
        status: "FAILED",
        failureReason: reason,
      },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: instrument.id,
      eventType: "INSTRUMENT_FAILED",
      actorId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: instrument.purchaseOrderId,
        amount: instrument.amount,
        currency: instrument.currency,
        reason,
        previousStatus: instrument.status,
      },
    });

    this.logger.warn(
      `Instrument ${instrumentId}: ${instrument.status} → FAILED (${reason})`,
    );

    return updated;
  }

  // ── Query ──────────────────────────────────────────────────

  async findByPO(purchaseOrderId: string) {
    return this.prisma.paymentInstrument.findUnique({
      where: { purchaseOrderId },
    });
  }

  // ── Transition validation ──────────────────────────────────

  private async findAndValidateTransition(
    instrumentId: string,
    targetStatus: InstrumentStatusType,
  ) {
    const instrument = await this.prisma.paymentInstrument.findUnique({
      where: { id: instrumentId },
    });

    if (!instrument) {
      throw new BadRequestException(
        `Payment instrument ${instrumentId} not found`,
      );
    }

    const currentStatus = instrument.status as InstrumentStatusType;
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed.includes(targetStatus)) {
      throw new BadRequestException(
        `Invalid instrument transition: ${currentStatus} → ${targetStatus}`,
      );
    }

    return instrument;
  }
}
