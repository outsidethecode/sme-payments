import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

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
    ]);

    return {
      totalPOs,
      settledPOs,
      totalVolumePennies: totalVolume._sum.amount ?? 0,
      activeLocks,
      earlyPayments,
      totalFeesPennies: totalFees._sum.amount ?? 0,
      totalUsers,
    };
  }
}
