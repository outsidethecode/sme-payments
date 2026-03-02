import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  SettlementAdapter,
  SettlementCurrency,
  TransferStatus,
  TransferResult,
  ReserveFundsInput,
  ReleaseFundsInput,
  TransferFundsInput,
  RefundInput,
  ReconcileInput,
  ReconcileResult,
} from "./settlement-adapter.interface";

/**
 * Simulated Settlement Adapter
 *
 * Wraps the existing User.balance debit/credit logic behind the
 * abstract SettlementAdapter interface.  Used for demo mode and
 * when no real bank rails are configured.
 *
 * "External refs" are synthetic identifiers prefixed with SIM-.
 */
@Injectable()
export class SimulatedAdapter implements SettlementAdapter {
  readonly name = "SIMULATED";
  readonly supportedCurrencies: SettlementCurrency[] = ["GBP", "SAR"];

  /** In-memory map of reservation refs → amount reserved (for reconcile) */
  private reservations = new Map<
    string,
    { payerId: string; amount: number; status: TransferStatus; createdAt: Date }
  >();

  constructor(private readonly prisma: PrismaService) {}

  // ── reserveFunds ─────────────────────────────────────────

  async reserveFunds(input: ReserveFundsInput): Promise<TransferResult> {
    const ref = `SIM-RSV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Debit the payer's simulated balance
    const user = await this.prisma.user.findUnique({
      where: { id: input.payerId },
      select: { balance: true },
    });

    if (!user || user.balance < input.amount) {
      this.reservations.set(ref, {
        payerId: input.payerId,
        amount: input.amount,
        status: TransferStatus.FAILED,
        createdAt: new Date(),
      });
      return {
        externalRef: ref,
        status: TransferStatus.FAILED,
        processedAt: new Date(),
        failureReason: "Insufficient balance",
      };
    }

    await this.prisma.user.update({
      where: { id: input.payerId },
      data: { balance: { decrement: input.amount } },
    });

    this.reservations.set(ref, {
      payerId: input.payerId,
      amount: input.amount,
      status: TransferStatus.RESERVED,
      createdAt: new Date(),
    });

    return {
      externalRef: ref,
      status: TransferStatus.RESERVED,
      processedAt: new Date(),
    };
  }

  // ── releaseFunds ─────────────────────────────────────────

  async releaseFunds(input: ReleaseFundsInput): Promise<TransferResult> {
    const ref = `SIM-REL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Credit recipient's balance (the money was already debited during reservation)
    await this.prisma.user.update({
      where: { id: input.recipientId },
      data: { balance: { increment: input.amount } },
    });

    // Mark the original reservation as completed
    const reservation = this.reservations.get(input.reservationRef);
    if (reservation) {
      reservation.status = TransferStatus.COMPLETED;
    }

    return {
      externalRef: ref,
      status: TransferStatus.COMPLETED,
      processedAt: new Date(),
    };
  }

  // ── transferFunds ────────────────────────────────────────

  async transferFunds(input: TransferFundsInput): Promise<TransferResult> {
    const ref = `SIM-TRF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Check sender balance
    const sender = await this.prisma.user.findUnique({
      where: { id: input.fromId },
      select: { balance: true },
    });

    if (!sender || sender.balance < input.amount) {
      return {
        externalRef: ref,
        status: TransferStatus.FAILED,
        processedAt: new Date(),
        failureReason: "Insufficient balance",
      };
    }

    // Atomic debit + credit
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: input.fromId },
        data: { balance: { decrement: input.amount } },
      }),
      this.prisma.user.update({
        where: { id: input.toId },
        data: { balance: { increment: input.amount } },
      }),
    ]);

    return {
      externalRef: ref,
      status: TransferStatus.COMPLETED,
      processedAt: new Date(),
    };
  }

  // ── refund ───────────────────────────────────────────────

  async refund(input: RefundInput): Promise<TransferResult> {
    const ref = `SIM-RFD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Credit the original payer back
    await this.prisma.user.update({
      where: { id: input.recipientId },
      data: { balance: { increment: input.amount } },
    });

    // Mark original reservation as refunded
    const reservation = this.reservations.get(input.reservationRef);
    if (reservation) {
      reservation.status = TransferStatus.REFUNDED;
    }

    return {
      externalRef: ref,
      status: TransferStatus.REFUNDED,
      processedAt: new Date(),
    };
  }

  // ── reconcile ────────────────────────────────────────────

  async reconcile(input: ReconcileInput): Promise<ReconcileResult> {
    // In simulated mode, all operations are instant — just look up our reservation map
    const reservation = this.reservations.get(input.externalRef);
    if (reservation) {
      return {
        externalRef: input.externalRef,
        status: reservation.status,
        confirmedAt: reservation.createdAt,
      };
    }

    // For non-reservation refs (release, transfer, refund) — they are always instant
    if (input.externalRef.startsWith("SIM-")) {
      return {
        externalRef: input.externalRef,
        status: TransferStatus.COMPLETED,
        confirmedAt: new Date(),
      };
    }

    return {
      externalRef: input.externalRef,
      status: TransferStatus.FAILED,
      failureReason: "Unknown reference",
    };
  }
}
