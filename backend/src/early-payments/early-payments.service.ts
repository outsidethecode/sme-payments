import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

@Injectable()
export class EarlyPaymentsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  /**
   * Supplier requests early payment on an ACCEPTED PO
   * The PO must be accepted (payment locked) but not yet delivered/settled
   */
  async requestEarlyPayment(purchaseOrderId: string, supplierId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { paymentLock: true },
    });

    if (!po) throw new NotFoundException("Purchase order not found");
    if (po.supplierId !== supplierId) {
      throw new ForbiddenException(
        "Only the supplier of this PO can request early payment",
      );
    }
    if (po.status !== "ACCEPTED" && po.status !== "IN_PROGRESS") {
      throw new BadRequestException(
        `PO must be in ACCEPTED or IN_PROGRESS status to request early payment (currently ${po.status})`,
      );
    }
    if (!po.paymentLock || po.paymentLock.status !== "LOCKED") {
      throw new BadRequestException(
        "PO must have a locked payment to request early payment",
      );
    }

    // Check if an early payment request already exists
    const existing = await this.prisma.earlyPaymentRequest.findUnique({
      where: { purchaseOrderId },
    });
    if (existing) {
      throw new BadRequestException(
        "An early payment request already exists for this PO",
      );
    }

    // Calculate service fee: flat 2.5% (250 BPS) — ujrah model
    const feeAmount = Math.round((po.amount * 250) / 10_000);
    const netAdvance = po.amount - feeAmount;

    const request = await this.prisma.earlyPaymentRequest.create({
      data: {
        purchaseOrderId,
        supplierId,
        faceValue: po.amount,
        serviceFee: feeAmount,
        netAdvance,
        status: "REQUESTED",
      },
      include: {
        purchaseOrder: {
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

    await this.ledger.logEvent({
      entityType: "EARLY_PAYMENT",
      entityId: request.id,
      eventType: "EARLY_PAY_REQUESTED",
      actorId: supplierId,
      actorRole: "SUPPLIER",
      payload: {
        purchaseOrderId,
        faceValue: po.amount,
        serviceFee: feeAmount,
        netAdvance,
      },
    });

    return this.formatEarlyPayment(request);
  }

  /**
   * Get all early payment requests (filtered by role)
   */
  async findAll(userId: string, role: string) {
    const where: Record<string, unknown> = {};

    if (role === "SUPPLIER") {
      where.supplierId = userId;
    } else if (role === "LIQUIDITY_PARTNER") {
      // LPs see all REQUESTED (available to fund) and their own funded ones
      where.OR = [{ status: "REQUESTED" }, { liquidityPartnerId: userId }];
    }
    // ADMIN sees all

    const requests = await this.prisma.earlyPaymentRequest.findMany({
      where,
      include: {
        purchaseOrder: {
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
        liquidityPartner: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return requests.map((r) => this.formatEarlyPayment(r));
  }

  /**
   * Get a single early payment request by ID
   */
  async findById(id: string) {
    const request = await this.prisma.earlyPaymentRequest.findUnique({
      where: { id },
      include: {
        purchaseOrder: {
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
        liquidityPartner: {
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

    if (!request)
      throw new NotFoundException("Early payment request not found");
    return this.formatEarlyPayment(request);
  }

  /**
   * LP funds an early payment request
   * LP pays supplier the net advance, LP assumes delivery risk
   */
  async fund(id: string, lpId: string) {
    const request = await this.prisma.earlyPaymentRequest.findUnique({
      where: { id },
      include: { purchaseOrder: true },
    });

    if (!request)
      throw new NotFoundException("Early payment request not found");
    if (request.status !== "REQUESTED") {
      throw new BadRequestException(
        `Cannot fund a request in ${request.status} status`,
      );
    }

    // Verify LP has sufficient balance
    const lp = await this.prisma.user.findUnique({ where: { id: lpId } });
    if (!lp) throw new NotFoundException("LP not found");
    if (lp.role !== "LIQUIDITY_PARTNER") {
      throw new ForbiddenException(
        "Only liquidity partners can fund early payments",
      );
    }
    if (lp.balance < request.netAdvance) {
      throw new BadRequestException(
        `Insufficient balance. Required: ${request.netAdvance}, Available: ${lp.balance}`,
      );
    }

    // Execute the funding in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Debit LP balance
      await tx.user.update({
        where: { id: lpId },
        data: { balance: { decrement: request.netAdvance } },
      });

      // Credit supplier with net advance
      await tx.user.update({
        where: { id: request.supplierId },
        data: { balance: { increment: request.netAdvance } },
      });

      // Update request status
      const updated = await tx.earlyPaymentRequest.update({
        where: { id },
        data: {
          liquidityPartnerId: lpId,
          status: "FUNDED",
          fundedAt: new Date(),
          riskAcknowledged: true,
        },
        include: {
          purchaseOrder: {
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
          liquidityPartner: {
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

      // Record the advance settlement
      await tx.settlement.create({
        data: {
          purchaseOrderId: request.purchaseOrderId,
          fromUserId: lpId,
          toUserId: request.supplierId,
          amount: request.netAdvance,
          type: "EARLY_PAY_ADVANCE",
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });

      // Record the facilitation fee
      await tx.platformFee.create({
        data: {
          purchaseOrderId: request.purchaseOrderId,
          feeType: "EARLY_PAY_FACILITATION",
          amount: request.serviceFee,
        },
      });

      return updated;
    });

    await this.ledger.logEvent({
      entityType: "EARLY_PAYMENT",
      entityId: id,
      eventType: "EARLY_PAY_FUNDED",
      actorId: lpId,
      actorRole: "LIQUIDITY_PARTNER",
      payload: {
        netAdvance: request.netAdvance,
        serviceFee: request.serviceFee,
        faceValue: request.faceValue,
      },
    });

    return this.formatEarlyPayment(result);
  }

  /**
   * Get the marketplace of available early payment requests for LPs
   */
  async getMarketplace() {
    const requests = await this.prisma.earlyPaymentRequest.findMany({
      where: { status: "REQUESTED" },
      include: {
        purchaseOrder: {
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
      orderBy: { createdAt: "desc" },
    });

    return requests.map((r) => this.formatEarlyPayment(r));
  }

  // ── Helpers ──────────────────────────────────────────────────

  private formatEarlyPayment(ep: any) {
    return {
      id: ep.id,
      purchaseOrderId: ep.purchaseOrderId,
      supplierId: ep.supplierId,
      liquidityPartnerId: ep.liquidityPartnerId || null,
      faceValuePennies: ep.faceValue,
      serviceFeePennies: ep.serviceFee,
      netAdvancePennies: ep.netAdvance,
      status: ep.status,
      riskAcknowledged: ep.riskAcknowledged,
      fundedAt: ep.fundedAt,
      settledAt: ep.settledAt,
      createdAt: ep.createdAt,
      purchaseOrder: ep.purchaseOrder
        ? {
            id: ep.purchaseOrder.id,
            reference: ep.purchaseOrder.referenceNumber,
            status: ep.purchaseOrder.status,
            totalAmountPennies: ep.purchaseOrder.amount,
            buyer: ep.purchaseOrder.buyer || undefined,
            supplier: ep.purchaseOrder.supplier || undefined,
            paymentLock: ep.purchaseOrder.paymentLock
              ? {
                  status: ep.purchaseOrder.paymentLock.status,
                  amountPennies: ep.purchaseOrder.paymentLock.amount,
                }
              : undefined,
          }
        : undefined,
      supplier: ep.supplier || undefined,
      liquidityPartner: ep.liquidityPartner || undefined,
    };
  }
}
