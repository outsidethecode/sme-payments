import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService, SignatureData } from "../ledger/ledger.service";
import { UsersService } from "../users/users.service";
import { PoliciesService } from "../policies/policies.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { OrganisationsService } from "../organisations/organisations.service";
import { SettlementService } from "../settlements/settlement.service";
import { SettlementCurrency } from "../settlements/settlement-adapter.interface";

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
    private readonly policies: PoliciesService,
    private readonly approvals: ApprovalsService,
    private readonly orgs: OrganisationsService,
    private readonly settlement: SettlementService,
  ) {}

  async create(input: CreatePOInput) {
    // Validate supplier exists and is a supplier
    const supplier = await this.users.findById(input.supplierId);
    if (!supplier || supplier.role !== "SUPPLIER") {
      throw new BadRequestException("Invalid supplier");
    }

    // Resolve buyer org to get jurisdiction/currency
    const buyerOrg = await this.orgs.getOrgByUserId(input.buyerId);
    const currency = buyerOrg?.currency || "GBP";

    // Calculate total
    const amount = input.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPricePennies,
      0,
    );

    // Currency-aware validation (amounts in smallest unit)
    const minAmount = currency === "SAR" ? 1_875_00 : 500_00; // SAR 1,875 ≈ £500
    const maxAmount = currency === "SAR" ? 93_750_000 : 250_000_00; // SAR 937,500 ≈ £250k
    const currencySymbol = currency === "SAR" ? "SAR" : "£";

    if (amount < minAmount) {
      throw new BadRequestException(
        `Minimum order amount is ${currencySymbol}${(minAmount / 100).toLocaleString()}`,
      );
    }
    if (amount > maxAmount) {
      throw new BadRequestException(
        `Maximum order amount is ${currencySymbol}${(maxAmount / 100).toLocaleString()}`,
      );
    }

    const po = await this.prisma.purchaseOrder.create({
      data: {
        referenceNumber: generateReference(),
        buyerId: input.buyerId,
        supplierId: input.supplierId,
        description: input.description || "",
        lineItems: input.lineItems,
        amount,
        currency,
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

  async send(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.requireStatus(id, "DRAFT");
    if (po.buyerId !== actorId)
      throw new ForbiddenException("Only the buyer can send this PO");

    // ── Policy evaluation ────────────────────────────────────
    const buyerOrg = await this.orgs.getOrgByUserId(actorId);
    let requiresApproval = false;

    if (buyerOrg) {
      const evaluation = await this.policies.evaluatePOApproval(
        buyerOrg.id,
        po.amount,
      );

      if (evaluation.requiresApproval && !evaluation.autoApprove) {
        // PO needs manual approval — park in PENDING_APPROVAL
        const updated = await this.prisma.purchaseOrder.update({
          where: { id },
          data: { status: "PENDING_APPROVAL" },
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

        // Create approval chain
        await this.approvals.createRequest({
          entityType: "PURCHASE_ORDER",
          entityId: id,
          organisationId: buyerOrg.id,
          policyRuleId: evaluation.matchedRule!.id,
          requiredApprovals: evaluation.requiredApprovals,
          expiresInHours: 7 * 24, // 7 days
        });

        await this.ledger.logEvent({
          entityType: "PURCHASE_ORDER",
          entityId: id,
          eventType: "PO_APPROVAL_REQUESTED",
          actorId,
          actorRole: "BUYER",
          payload: {
            supplierId: po.supplierId,
            requiredApprovals: evaluation.requiredApprovals,
            requiredRoles: evaluation.requiredRoles,
            policyRuleId: evaluation.matchedRule!.id,
          },
          ...sig,
        });

        return this.formatPO(updated);
      }

      // Auto-approved — log it and continue to SENT
      if (evaluation.requiresApproval && evaluation.autoApprove) {
        await this.ledger.logEvent({
          entityType: "PURCHASE_ORDER",
          entityId: id,
          eventType: "PO_AUTO_APPROVED",
          actorId,
          actorRole: "BUYER",
          payload: {
            policyRuleId: evaluation.matchedRule!.id,
            amount: po.amount,
          },
        });
      }
    }
    // ── End policy evaluation ────────────────────────────────

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
      ...sig,
    });

    return this.formatPO(updated);
  }

  /**
   * Called when an approval chain completes — transitions PO from PENDING_APPROVAL → SENT.
   */
  async onApprovalComplete(poId: string, approvedBy: string) {
    const po = await this.requireStatus(poId, "PENDING_APPROVAL");

    const updated = await this.prisma.purchaseOrder.update({
      where: { id: poId },
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
      entityId: poId,
      eventType: "PO_APPROVAL_GRANTED",
      actorId: approvedBy,
      actorRole: "BUYER",
      payload: { supplierId: po.supplierId },
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: poId,
      eventType: "PO_SENT",
      actorId: approvedBy,
      actorRole: "BUYER",
      payload: { supplierId: po.supplierId, autoSentAfterApproval: true },
    });

    return this.formatPO(updated);
  }

  async accept(id: string, actorId: string, sig?: SignatureData) {
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

    // Resolve currency from the PO (or organisation)
    const currency = (po.currency || "GBP") as SettlementCurrency;

    // Resolve buyer's bank account ref (from org, if available)
    const buyerOrg = await this.orgs.getOrgByUserId(po.buyerId);
    const buyerAccountRef = buyerOrg?.bankIban || undefined;

    // Reserve funds via settlement adapter
    const reservation = await this.settlement.reserveForPO({
      purchaseOrderId: id,
      buyerId: po.buyerId,
      buyerAccountRef,
      amount: po.amount,
      currency,
    });

    // Update PO status
    const updated = await this.prisma.purchaseOrder.update({
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
        paymentLock: true,
      },
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "PO_ACCEPTED",
      actorId,
      actorRole: "SUPPLIER",
      payload: { amount: po.amount },
      ...sig,
    });

    await this.ledger.logEvent({
      entityType: "PAYMENT_LOCK",
      entityId: reservation.paymentLockId,
      eventType: "PAYMENT_LOCK_CONFIRMED",
      actorId: actorId,
      actorRole: "SUPPLIER",
      payload: {
        purchaseOrderId: id,
        buyerId: po.buyerId,
        amount: po.amount,
        externalRef: reservation.externalRef,
        settlementRail: this.settlement.getAdapterName(),
      },
    });

    return this.formatPO(updated);
  }

  async reject(id: string, actorId: string, sig?: SignatureData) {
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
      ...sig,
    });

    return this.formatPO(updated);
  }

  async markDelivered(id: string, actorId: string, sig?: SignatureData) {
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
      ...sig,
    });

    return this.formatPO(updated);
  }

  async verifyDelivery(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.requireStatus(id, "DELIVERED");
    if (po.buyerId !== actorId)
      throw new ForbiddenException("Only the buyer can verify delivery");

    // Check if there's a funded early payment request
    const earlyPay = await this.prisma.earlyPaymentRequest.findUnique({
      where: { purchaseOrderId: id },
    });
    const hasEarlyPay =
      earlyPay && earlyPay.status === "FUNDED" && earlyPay.liquidityPartnerId;

    // Resolve currency and recipient account ref
    const currency = (po.currency || "GBP") as SettlementCurrency;
    const recipientId = hasEarlyPay
      ? earlyPay!.liquidityPartnerId!
      : po.supplierId;
    const recipientOrg = await this.orgs.getOrgByUserId(recipientId);
    const recipientAccountRef = recipientOrg?.bankIban || undefined;

    // Platform fee: 0.5% = 50 BPS
    const FEE_BPS = 50;

    // Settle via settlement adapter
    const result = await this.settlement.settlePO({
      purchaseOrderId: id,
      recipientId,
      recipientAccountRef,
      totalAmount: po.amount,
      feeBps: FEE_BPS,
      currency,
      earlyPaymentRequestId: hasEarlyPay ? earlyPay!.id : undefined,
    });

    // Update PO status and early payment in a transaction
    const settledPO = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: "VERIFIED", verifiedAt: new Date() },
      });

      if (hasEarlyPay) {
        await tx.earlyPaymentRequest.update({
          where: { id: earlyPay!.id },
          data: { status: "SETTLED", settledAt: new Date() },
        });
      }

      return tx.purchaseOrder.update({
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
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "DELIVERY_VERIFIED",
      actorId,
      actorRole: "BUYER",
      payload: { verifiedAt: new Date() },
      ...sig,
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
        earlyPaySettlement: !!hasEarlyPay,
        recipientId,
        settlementRail: this.settlement.getAdapterName(),
        externalRef: result.externalRef,
      },
    });

    return this.formatPO(settledPO);
  }

  async dispute(id: string, actorId: string, sig?: SignatureData) {
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
      ...sig,
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
            externalRef: po.paymentLock.openBankingRef || null,
            lockedAt: po.paymentLock.lockedAt,
            releasedAt: po.paymentLock.releasedAt,
          }
        : null,
    };
  }
}
