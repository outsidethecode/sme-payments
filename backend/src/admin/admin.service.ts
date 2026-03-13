import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Currency } from "@prisma/client";

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [
      totalPOs,
      totalVolume,
      activeLocks,
      earlyPayments,
      totalFees,
      totalUsers,
      settledPOs,
      volumeByCurrencyRaw,
      feesByCurrencyRaw,
      escrowBalanceRaw,
      lockedAmountRaw,
    ] = await Promise.all([
      this.prisma.purchaseOrder.count(),

      this.prisma.purchaseOrder.aggregate({
        _sum: { amount: true },
      }),

      this.prisma.paymentLock.count({
        where: { status: "LOCKED" },
      }),

      this.prisma.earlyPaymentRequest.count({
        where: { status: { in: ["FUNDED", "SETTLED"] } },
      }),

      this.prisma.platformFee.aggregate({
        _sum: { amount: true },
      }),

      this.prisma.user.count(),

      this.prisma.purchaseOrder.count({
        where: { status: "SETTLED" },
      }),

      this.prisma.purchaseOrder.groupBy({
        by: ["currency"],
        _sum: { amount: true },
      }),

      this.prisma.platformFee.groupBy({
        by: ["currency"],
        _sum: { amount: true },
      }),

      this.prisma.escrowAccount.groupBy({
        by: ["currency"],
        where: { active: true },
        _sum: { balanceMinor: true },
      }),

      this.prisma.paymentLock.groupBy({
        by: ["currency"],
        where: { status: "LOCKED" },
        _sum: { amount: true },
      }),
    ]);

    const volumeByCurrency: Record<string, number> = {};
    for (const row of volumeByCurrencyRaw) {
      volumeByCurrency[row.currency] = row._sum.amount ?? 0;
    }

    const feesByCurrency: Record<string, number> = {};
    for (const row of feesByCurrencyRaw) {
      feesByCurrency[row.currency] = row._sum.amount ?? 0;
    }

    const escrowBalanceByCurrency: Record<string, number> = {};
    for (const row of escrowBalanceRaw) {
      escrowBalanceByCurrency[row.currency] = row._sum.balanceMinor ?? 0;
    }

    const lockedAmountByCurrency: Record<string, number> = {};
    for (const row of lockedAmountRaw) {
      lockedAmountByCurrency[row.currency] = row._sum.amount ?? 0;
    }

    const totalVolumePennies = totalVolume._sum.amount ?? 0;
    const totalFeesPennies = totalFees._sum.amount ?? 0;

    return {
      totalPOs,
      settledPOs,
      totalVolumePennies,
      totalVolumeMinor: totalVolumePennies,
      activeLocks,
      earlyPayments,
      totalFeesPennies,
      totalFeesMinor: totalFeesPennies,
      totalUsers,
      volumeByCurrency,
      feesByCurrency,
      escrowBalanceByCurrency,
      lockedAmountByCurrency,
    };
  }

  // ── Escrow Account Management ──────────────────────────────

  async listEscrowAccounts() {
    return this.prisma.escrowAccount.findMany({
      orderBy: [{ country: "asc" }, { currency: "asc" }],
      include: {
        _count: { select: { instruments: true } },
      },
    });
  }

  async getEscrowAccount(id: string) {
    return this.prisma.escrowAccount.findUniqueOrThrow({
      where: { id },
      include: {
        _count: { select: { instruments: true, reconciliationReports: true } },
      },
    });
  }

  async createEscrowAccount(input: {
    label: string;
    bank: string;
    country: string;
    currency: string;
  }) {
    return this.prisma.escrowAccount.create({
      data: {
        label: input.label,
        bank: input.bank,
        country: input.country,
        currency: input.currency as Currency,
        balanceMinor: 0,
        active: true,
      },
    });
  }

  async updateEscrowAccount(
    id: string,
    input: { label?: string; active?: boolean },
  ) {
    return this.prisma.escrowAccount.update({
      where: { id },
      data: input,
    });
  }
}
