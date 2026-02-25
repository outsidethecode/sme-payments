import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { UsersService } from "../users/users.service";

// Simple PO reference generator
function generateReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${timestamp}-${random}`;
}

export interface CreatePOInput {
  buyerId: string;
  supplierId: string;
  description?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPricePennies: number;
  }>;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly users: UsersService,
  ) {}

  async create(input: CreatePOInput) {
    // Validate supplier exists and is a supplier
    const supplier = await this.users.findById(input.supplierId);
    if (!supplier || supplier.role !== "SUPPLIER") {
      throw new BadRequestException("Invalid supplier");
    }

    // Calculate total
    const amount = input.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPricePennies,
      0,
    );

    if (amount < 500_00) {
      throw new BadRequestException("Minimum order amount is £500");
    }
    if (amount > 250_000_00) {
      throw new BadRequestException("Maximum order amount is £250,000");
    }

    const po = await this.prisma.purchaseOrder.create({
      data: {
        referenceNumber: generateReference(),
        buyerId: input.buyerId,
        supplierId: input.supplierId,
        description: input.description || "",
        lineItems: input.lineItems,
        amount,
      },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
      },
    });

    // Log event
    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: po.id,
      eventType: "PO_CREATED",
      actorId: input.buyerId,
      actorRole: "BUYER",
      payload: {
        reference: po.referenceNumber,
        supplierId: po.supplierId,
        amount: po.amount,
        lineItemCount: input.lineItems.length,
      },
    });

    return this.formatPO(po);
  }

  async findAll(userId: string, role: string) {
    const where =
      role === "ADMIN"
        ? {}
        : role === "BUYER"
          ? { buyerId: userId }
          : role === "SUPPLIER"
            ? { supplierId: userId }
            : role === "LIQUIDITY_PARTNER"
              ? {
                  earlyPaymentRequest: {
                    liquidityPartnerId: userId,
                  },
                }
              : { id: "__none__" };

    const pos = await this.prisma.purchaseOrder.findMany({
      where,
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return pos.map((po) => this.formatPO(po));
  }

  async findById(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
        earlyPaymentRequest: true,
      },
    });

    if (!po) throw new NotFoundException("Purchase order not found");

    return this.formatPO(po);
  }

  async send(id: string, actorId: string) {
    const po = await this.requireStatus(id, "DRAFT");
    if (po.buyerId !== actorId)
      throw new ForbiddenException("Only the buyer can send this PO");

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "SENT" },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "PO_SENT",
      actorId,
      actorRole: "BUYER",
      payload: { supplierId: po.supplierId },
    });

    return this.formatPO(updated);
  }

  async accept(id: string, actorId: string) {
    const po = await this.requireStatus(id, "SENT");
    if (po.supplierId !== actorId)
      throw new ForbiddenException("Only the supplier can accept");

    // Check buyer has sufficient balance for payment lock
    const buyerBalance = await this.users.getBalance(po.buyerId);
    if (buyerBalance < po.amount) {
      throw new BadRequestException(
        "Buyer has insufficient funds for payment lock",
      );
    }

    // Use a transaction: update PO, create payment lock, debit buyer
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedPO = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          paymentLocked: true,
          lockedAt: new Date(),
        },
        include: {
          buyer: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
          supplier: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
        },
      });

      // Create payment lock
      const lock = await tx.paymentLock.create({
        data: {
          purchaseOrderId: id,
          buyerId: po.buyerId,
          amount: po.amount,
          status: "LOCKED",
          lockedAt: new Date(),
          openBankingRef: `OB-${Date.now().toString(36).toUpperCase()}`,
        },
      });

      // Debit buyer's balance (simulated escrow)
      await tx.user.update({
        where: { id: po.buyerId },
        data: { balance: { decrement: po.amount } },
      });

      return { ...updatedPO, paymentLock: lock };
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "PO_ACCEPTED",
      actorId,
      actorRole: "SUPPLIER",
      payload: { amount: po.amount },
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_LOCK",
      entityId: result.paymentLock.id,
      eventType: "PAYMENT_LOCK_CONFIRMED",
      actorId: actorId,
      actorRole: "SUPPLIER",
      payload: {
        purchaseOrderId: id,
        buyerId: po.buyerId,
        amount: po.amount,
        openBankingRef: result.paymentLock.openBankingRef,
      },
    });

    return this.formatPO(result);
  }

  async reject(id: string, actorId: string) {
    const po = await this.requireStatus(id, "SENT");
    if (po.supplierId !== actorId)
      throw new ForbiddenException("Only the supplier can reject");

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "PO_CANCELLED",
      actorId,
      actorRole: "SUPPLIER",
      payload: { reason: "Rejected by supplier" },
    });

    return this.formatPO(updated);
  }

  async markDelivered(id: string, actorId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException("PO not found");
    if (po.status !== "ACCEPTED" && po.status !== "IN_PROGRESS") {
      throw new BadRequestException(
        `Cannot mark as delivered from status ${po.status}`,
      );
    }
    if (po.supplierId !== actorId)
      throw new ForbiddenException("Only the supplier can mark delivery");

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "DELIVERED", deliveredAt: new Date() },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "DELIVERY_MARKED",
      actorId,
      actorRole: "SUPPLIER",
      payload: { deliveredAt: updated.deliveredAt },
    });

    return this.formatPO(updated);
  }

  async verifyDelivery(id: string, actorId: string) {
    const po = await this.requireStatus(id, "DELIVERED");
    if (po.buyerId !== actorId)
      throw new ForbiddenException("Only the buyer can verify delivery");

    // Check if there's a funded early payment request
    const earlyPay = await this.prisma.earlyPaymentRequest.findUnique({
      where: { purchaseOrderId: id },
    });
    const hasEarlyPay =
      earlyPay && earlyPay.status === "FUNDED" && earlyPay.liquidityPartnerId;

    // Settle: release payment lock → credit recipient, record fee
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedPO = await tx.purchaseOrder.update({
        where: { id },
        data: { status: "VERIFIED", verifiedAt: new Date() },
        include: {
          buyer: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
          supplier: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
        },
      });

      // Release payment lock
      const lock = await tx.paymentLock.update({
        where: { purchaseOrderId: id },
        data: { status: "RELEASED", releasedAt: new Date() },
      });

      // Calculate platform fee (0.5% = 50 BPS)
      const feeAmount = Math.round((po.amount * 50) / 10_000);
      const netAmount = po.amount - feeAmount;

      if (hasEarlyPay) {
        // Early pay scenario: LP gets the locked funds (they already paid the supplier)
        const lpId = earlyPay.liquidityPartnerId!;

        // Credit LP with the face value minus platform fee
        await tx.user.update({
          where: { id: lpId },
          data: { balance: { increment: netAmount } },
        });

        // Record LP settlement
        await tx.settlement.create({
          data: {
            purchaseOrderId: id,
            fromUserId: po.buyerId,
            toUserId: lpId,
            amount: netAmount,
            type: "EARLY_PAY_SETTLEMENT",
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });

        // Update early payment request to SETTLED
        await tx.earlyPaymentRequest.update({
          where: { id: earlyPay.id },
          data: { status: "SETTLED", settledAt: new Date() },
        });
      } else {
        // Standard scenario: credit the supplier directly
        await tx.user.update({
          where: { id: po.supplierId },
          data: { balance: { increment: netAmount } },
        });

        // Record standard settlement
        await tx.settlement.create({
          data: {
            purchaseOrderId: id,
            fromUserId: po.buyerId,
            toUserId: po.supplierId,
            amount: netAmount,
            type: "STANDARD",
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });
      }

      // Record platform fee
      await tx.platformFee.create({
        data: {
          purchaseOrderId: id,
          feeType: "TRANSACTION",
          amount: feeAmount,
        },
      });

      // Update PO to settled
      const settledPO = await tx.purchaseOrder.update({
        where: { id },
        data: { status: "SETTLED", settledAt: new Date() },
        include: {
          buyer: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
          supplier: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
          paymentLock: true,
        },
      });

      return { settledPO, feeAmount, netAmount, lock, earlyPay: hasEarlyPay };
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "DELIVERY_VERIFIED",
      actorId,
      actorRole: "BUYER",
      payload: { verifiedAt: new Date() },
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "SETTLEMENT_COMPLETED",
      actorId: actorId,
      actorRole: "BUYER",
      payload: {
        totalAmount: po.amount,
        feeAmount: result.feeAmount,
        recipientReceives: result.netAmount,
        earlyPaySettlement: result.earlyPay,
        recipientId: hasEarlyPay ? earlyPay!.liquidityPartnerId : po.supplierId,
      },
    });

    return this.formatPO(result.settledPO);
  }

  async dispute(id: string, actorId: string) {
    const po = await this.requireStatus(id, "DELIVERED");
    if (po.buyerId !== actorId)
      throw new ForbiddenException("Only the buyer can dispute");

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "DISPUTED" },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "DELIVERY_DISPUTED",
      actorId,
      actorRole: "BUYER",
      payload: {},
    });

    return this.formatPO(updated);
  }

  // ── Helpers ──────────────────────────────────────────────────

  private async requireStatus(id: string, expectedStatus: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException("Purchase order not found");
    if (po.status !== expectedStatus) {
      throw new BadRequestException(
        `PO is in ${po.status} status, expected ${expectedStatus}`,
      );
    }
    return po;
  }

  private formatPO(po: any) {
    return {
      id: po.id,
      reference: po.referenceNumber,
      buyerId: po.buyerId,
      supplierId: po.supplierId,
      status: po.status,
      totalAmountPennies: po.amount,
      lineItems: po.lineItems,
      description: po.description || null,
      acceptanceDeadline: po.acceptedAt
        ? null
        : po.status === "SENT"
          ? new Date(
              new Date(po.createdAt).getTime() +
                po.acceptanceWindowHours * 60 * 60 * 1000,
            ).toISOString()
          : null,
      paymentLocked: po.paymentLocked,
      acceptedAt: po.acceptedAt,
      deliveredAt: po.deliveredAt,
      verifiedAt: po.verifiedAt,
      settledAt: po.settledAt,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
      buyer: po.buyer || undefined,
      supplier: po.supplier || undefined,
      paymentLock: po.paymentLock
        ? {
            id: po.paymentLock.id,
            purchaseOrderId: po.paymentLock.purchaseOrderId,
            amountPennies: po.paymentLock.amount,
            status: po.paymentLock.status,
            lockedAt: po.paymentLock.lockedAt,
            releasedAt: po.paymentLock.releasedAt,
          }
        : null,
    };
  }
}
