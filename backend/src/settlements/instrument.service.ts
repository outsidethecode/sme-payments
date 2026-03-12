import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

// ── Types ────────────────────────────────────────────────────

export type InstrumentStatusType =
  | "CREATED"
  | "LOCK_REQUESTED"
  | "LOCKED"
  | "RELEASE_PENDING"
  | "RELEASED"
  | "REFUNDED"
  | "FAILED";

export interface CreateInstrumentInput {
  purchaseOrderId: string;
  amount: number;
  currency: string;
  payerAccountRef?: string;
}

export interface ConfirmLockInput {
  instrumentId: string;
  bankReference: string;
  escrowReference?: string;
}

export interface RequestReleaseInput {
  instrumentId: string;
  recipientAccountRef?: string;
}

export interface ConfirmReleaseInput {
  instrumentId: string;
  bankReference: string;
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
    LOCKED: ["RELEASE_PENDING", "REFUNDED"],
    RELEASE_PENDING: ["RELEASED", "FAILED"],
    RELEASED: [],
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
   * This is the first step before requesting a lock from the bank.
   */
  async create(input: CreateInstrumentInput, actorId: string) {
    const instrument = await this.prisma.paymentInstrument.create({
      data: {
        purchaseOrderId: input.purchaseOrderId,
        amount: input.amount,
        currency: input.currency,
        payerAccountRef: input.payerAccountRef ?? null,
        status: "CREATED",
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

  // ── Request Release ────────────────────────────────────────

  /**
   * Transition LOCKED → RELEASE_PENDING.
   * Called when the platform is about to release funds to recipient.
   */
  async requestRelease(input: RequestReleaseInput, actorId: string) {
    const instrument = await this.findAndValidateTransition(
      input.instrumentId,
      "RELEASE_PENDING",
    );

    const updated = await this.prisma.paymentInstrument.update({
      where: { id: input.instrumentId },
      data: {
        status: "RELEASE_PENDING",
        recipientAccountRef: input.recipientAccountRef ?? null,
      },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: instrument.id,
      eventType: "INSTRUMENT_RELEASE_REQUESTED",
      actorId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: instrument.purchaseOrderId,
        amount: instrument.amount,
        currency: instrument.currency,
        recipientAccountRef: input.recipientAccountRef ?? null,
      },
    });

    this.logger.log(
      `Instrument ${input.instrumentId}: LOCKED → RELEASE_PENDING`,
    );

    return updated;
  }

  // ── Confirm Release ────────────────────────────────────────

  /**
   * Transition RELEASE_PENDING → RELEASED.
   * Called when the bank confirms the release.
   */
  async confirmRelease(input: ConfirmReleaseInput, actorId: string) {
    const instrument = await this.findAndValidateTransition(
      input.instrumentId,
      "RELEASED",
    );

    const updated = await this.prisma.paymentInstrument.update({
      where: { id: input.instrumentId },
      data: {
        status: "RELEASED",
        bankReference: input.bankReference,
        releasedAt: new Date(),
      },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_INSTRUMENT",
      entityId: instrument.id,
      eventType: "INSTRUMENT_RELEASED",
      actorId,
      actorRole: "SYSTEM",
      payload: {
        purchaseOrderId: instrument.purchaseOrderId,
        amount: instrument.amount,
        currency: instrument.currency,
        bankReference: input.bankReference,
      },
    });

    this.logger.log(
      `Instrument ${input.instrumentId}: RELEASE_PENDING → RELEASED (bank ref: ${input.bankReference})`,
    );

    return updated;
  }

  // ── Refund ─────────────────────────────────────────────────

  /**
   * Transition LOCKED → REFUNDED.
   * Called when a locked instrument needs to be refunded (e.g. dispute).
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
        failureReason: input.reason,
        releasedAt: new Date(), // marks the time funds were returned
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
      },
    });

    this.logger.log(
      `Instrument ${input.instrumentId}: LOCKED → REFUNDED (${input.reason})`,
    );

    return updated;
  }

  // ── Fail ───────────────────────────────────────────────────

  /**
   * Transition to FAILED state (from CREATED, LOCK_REQUESTED, or RELEASE_PENDING).
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
