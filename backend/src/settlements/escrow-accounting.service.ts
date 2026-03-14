import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EscrowTxType, Currency, Prisma } from "@prisma/client";

// ── Types ────────────────────────────────────────────────────

export interface RecordTxInput {
  escrowAccountId: string;
  amountMinor: number;
  currency: Currency;
  purchaseOrderId?: string;
  counterpartyId?: string;
  reference: string;
  ledgerEventId?: string;
}

export interface EscrowStatement {
  escrowAccountId: string;
  label: string;
  currency: Currency;
  currentBalance: number;
  transactions: Array<{
    id: string;
    type: EscrowTxType;
    amountMinor: number;
    balanceAfter: number;
    purchaseOrderId: string | null;
    counterpartyId: string | null;
    reference: string;
    createdAt: Date;
  }>;
}

export interface BalanceVerification {
  escrowAccountId: string;
  shadowBalance: number;
  computedBalance: number;
  match: boolean;
  transactionCount: number;
}

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class EscrowAccountingService {
  private readonly logger = new Logger(EscrowAccountingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Record transactions ────────────────────────────────────

  /**
   * Record a DEPOSIT when buyer funds hit escrow (confirmEscrowFunding).
   * The escrow balanceMinor should already have been incremented.
   */
  async recordDeposit(
    input: RecordTxInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; balanceAfter: number }> {
    return this.record(EscrowTxType.DEPOSIT, input, tx);
  }

  /**
   * Record a RELEASE when funds leave escrow to supplier or LP.
   */
  async recordRelease(
    input: RecordTxInput & { releaseType: "RELEASE_SUPPLIER" | "RELEASE_LP" },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; balanceAfter: number }> {
    return this.record(input.releaseType as EscrowTxType, input, tx);
  }

  /**
   * Record a REFUND when buyer gets money back from escrow.
   */
  async recordRefund(
    input: RecordTxInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; balanceAfter: number }> {
    return this.record(EscrowTxType.REFUND_BUYER, input, tx);
  }

  /**
   * Record a FEE_DEDUCTION when platform fee is taken.
   */
  async recordFee(
    input: RecordTxInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; balanceAfter: number }> {
    return this.record(EscrowTxType.FEE_DEDUCTION, input, tx);
  }

  // ── Query methods ──────────────────────────────────────────

  /**
   * Produce an escrow statement: ordered list of all transactions
   * for a given escrow account, optionally filtered by date range.
   */
  async getStatement(
    escrowAccountId: string,
    dateRange?: { from?: Date; to?: Date },
  ): Promise<EscrowStatement> {
    const account = await this.prisma.escrowAccount.findUnique({
      where: { id: escrowAccountId },
    });
    if (!account) throw new NotFoundException("Escrow account not found");

    const where: Prisma.EscrowTransactionWhereInput = {
      escrowAccountId,
    };
    if (dateRange?.from || dateRange?.to) {
      where.createdAt = {};
      if (dateRange.from) where.createdAt.gte = dateRange.from;
      if (dateRange.to) where.createdAt.lte = dateRange.to;
    }

    const transactions = await this.prisma.escrowTransaction.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        amountMinor: true,
        balanceAfter: true,
        purchaseOrderId: true,
        counterpartyId: true,
        reference: true,
        createdAt: true,
      },
    });

    return {
      escrowAccountId,
      label: account.label,
      currency: account.currency,
      currentBalance: account.balanceMinor,
      transactions,
    };
  }

  /**
   * Verify that the sum of all escrow transactions matches the
   * current shadow balance on the escrow account.
   */
  async verifyBalance(escrowAccountId: string): Promise<BalanceVerification> {
    const account = await this.prisma.escrowAccount.findUnique({
      where: { id: escrowAccountId },
    });
    if (!account) throw new NotFoundException("Escrow account not found");

    // Sum all transactions: DEPOSIT adds, everything else subtracts
    const transactions = await this.prisma.escrowTransaction.findMany({
      where: { escrowAccountId },
      select: { type: true, amountMinor: true },
    });

    let computedBalance = 0;
    for (const tx of transactions) {
      if (tx.type === EscrowTxType.DEPOSIT) {
        computedBalance += tx.amountMinor;
      } else {
        computedBalance -= tx.amountMinor;
      }
    }

    const match = computedBalance === account.balanceMinor;
    if (!match) {
      this.logger.warn(
        `Balance mismatch for escrow ${escrowAccountId}: shadow=${account.balanceMinor}, computed=${computedBalance}`,
      );
    }

    return {
      escrowAccountId,
      shadowBalance: account.balanceMinor,
      computedBalance,
      match,
      transactionCount: transactions.length,
    };
  }

  // ── Internal ───────────────────────────────────────────────

  /**
   * Core method: creates an EscrowTransaction with the correct
   * running balance. Uses the escrow account's current balanceMinor
   * (which should already reflect the increment/decrement).
   */
  private async record(
    type: EscrowTxType,
    input: RecordTxInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; balanceAfter: number }> {
    const client = tx ?? this.prisma;

    // Read the current balance (after the increment/decrement)
    const account = await client.escrowAccount.findUnique({
      where: { id: input.escrowAccountId },
      select: { balanceMinor: true },
    });

    if (!account) {
      throw new NotFoundException(
        `Escrow account ${input.escrowAccountId} not found`,
      );
    }

    const balanceAfter = account.balanceMinor;

    const record = await client.escrowTransaction.create({
      data: {
        escrowAccountId: input.escrowAccountId,
        type,
        amountMinor: input.amountMinor,
        currency: input.currency,
        balanceAfter,
        purchaseOrderId: input.purchaseOrderId,
        counterpartyId: input.counterpartyId,
        reference: input.reference,
        ledgerEventId: input.ledgerEventId,
      },
    });

    this.logger.debug(
      `Escrow tx ${type}: ${input.amountMinor} ${input.currency} → balance ${balanceAfter} (account ${input.escrowAccountId})`,
    );

    return { id: record.id, balanceAfter };
  }
}
