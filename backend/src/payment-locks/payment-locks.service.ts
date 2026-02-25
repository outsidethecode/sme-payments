import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PaymentLocksService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string, role: string) {
    const where: Record<string, unknown> = {};

    if (role === "BUYER") {
      where.buyerId = userId;
    } else if (role === "SUPPLIER") {
      where.purchaseOrder = { supplierId: userId };
    }
    // ADMIN sees all

    const locks = await this.prisma.paymentLock.findMany({
      where,
      include: {
        purchaseOrder: {
          select: {
            id: true,
            referenceNumber: true,
            amount: true,
            status: true,
            buyer: { select: { id: true, name: true, companyName: true } },
            supplier: { select: { id: true, name: true, companyName: true } },
          },
        },
        buyer: { select: { id: true, name: true, companyName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return locks.map((lock) => ({
      id: lock.id,
      purchaseOrderId: lock.purchaseOrderId,
      buyerId: lock.buyerId,
      amountPennies: lock.amount,
      status: lock.status,
      lockedAt: lock.lockedAt,
      releasedAt: lock.releasedAt,
      createdAt: lock.createdAt,
      purchaseOrder: {
        id: lock.purchaseOrder.id,
        reference: lock.purchaseOrder.referenceNumber,
        totalAmountPennies: lock.purchaseOrder.amount,
        status: lock.purchaseOrder.status,
        buyer: lock.purchaseOrder.buyer,
        supplier: lock.purchaseOrder.supplier,
      },
      buyer: lock.buyer,
    }));
  }
}
