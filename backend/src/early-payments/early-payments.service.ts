import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService, SignatureData } from "../ledger/ledger.service";
import { PoliciesService } from "../policies/policies.service";
import { OrganisationsService } from "../organisations/organisations.service";
import { SettlementService } from "../settlements/settlement.service";
import { SettlementCurrency } from "../settlements/settlement-adapter.interface";

/** Default ujrah fee if no policy rule specifies a custom feeBps */
const DEFAULT_FEE_BPS = 250;

@Injectable()
export class EarlyPaymentsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private policies: PoliciesService,
    private orgs: OrganisationsService,
    private settlement: SettlementService,
  ) {}

  /**
   * Supplier requests early payment on an ACCEPTED / IN_PROGRESS / DELIVERED PO.
   * The PO must have a locked payment but not yet settled.
   */
  async requestEarlyPayment(
    purchaseOrderId: string,
    supplierId: string,
    sig?: SignatureData,
  ) {
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
    const eligibleStatuses = [
      "ACCEPTED",
      "IN_PROGRESS",
      "SHIPPED",
      "DELIVERED",
    ];
    if (!eligibleStatuses.includes(po.status)) {
      throw new BadRequestException(
        `PO must be in ACCEPTED, IN_PROGRESS, SHIPPED, or DELIVERED status to request early payment (currently ${po.status})`,
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

    // Determine fee BPS from LP funding policies (use highest feeBps from any active FUNDING_LIMIT rule)
    // At request time we don't know the LP yet, so use DEFAULT_FEE_BPS as baseline
    const feeAmount = Math.round((po.amount * DEFAULT_FEE_BPS) / 10_000);
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

    const event = await this.ledger.logEvent({
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
      ...sig,
    });

    const result = this.formatEarlyPayment(request);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
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
  async fund(id: string, lpId: string, sig?: SignatureData) {
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

    // Guard: PO must still be in a fundable state
    const fundableStatuses = [
      "ACCEPTED",
      "IN_PROGRESS",
      "SHIPPED",
      "DELIVERED",
    ];
    if (!fundableStatuses.includes(request.purchaseOrder.status)) {
      // Auto-expire the stale request
      await this.prisma.earlyPaymentRequest.update({
        where: { id },
        data: { status: "EXPIRED" },
      });
      await this.ledger.logEvent({
        entityType: "EARLY_PAYMENT",
        entityId: id,
        eventType: "EARLY_PAY_EXPIRED",
        actorId: lpId,
        actorRole: "SYSTEM",
        payload: {
          reason: `PO already in ${request.purchaseOrder.status} status`,
          purchaseOrderId: request.purchaseOrderId,
        },
      });
      throw new BadRequestException(
        `Cannot fund — PO is already ${request.purchaseOrder.status}`,
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

    // ── LP Funding Policy Evaluation ─────────────────────────
    const lpOrg = await this.orgs.getOrgByUserId(lpId);
    if (lpOrg) {
      // Resolve buyer & supplier org IDs for concentration checks
      const buyerOrg = await this.orgs.getOrgByUserId(
        request.purchaseOrder.buyerId,
      );
      const supplierOrg = await this.orgs.getOrgByUserId(
        request.purchaseOrder.supplierId,
      );

      const fundingCheck = await this.policies.evaluateLPFunding(
        lpOrg.id,
        buyerOrg?.id || null,
        supplierOrg?.id || null,
        request.netAdvance,
      );

      if (!fundingCheck.allowed) {
        await this.ledger.logEvent({
          entityType: "EARLY_PAYMENT",
          entityId: id,
          eventType: "EARLY_PAY_BLOCKED",
          actorId: lpId,
          actorRole: "LIQUIDITY_PARTNER",
          payload: {
            reason: fundingCheck.reason,
            currentExposure: fundingCheck.currentExposure,
            limits: fundingCheck.limits,
            requestedAmount: request.netAdvance,
          },
        });
        throw new BadRequestException(
          `Funding blocked by policy: ${fundingCheck.reason}`,
        );
      }
    }
    // ── End LP Funding Policy Evaluation ─────────────────────

    // Resolve currency and account refs
    const currency = (request.purchaseOrder.currency ||
      "GBP") as SettlementCurrency;
    const lpOrg2 = lpOrg || (await this.orgs.getOrgByUserId(lpId));
    const supplierOrg2 = await this.orgs.getOrgByUserId(request.supplierId);
    const lpAccountRef = lpOrg2?.bankIban || undefined;
    const supplierAccountRef = supplierOrg2?.bankIban || undefined;

    // Transfer advance via settlement adapter
    const transferResult = await this.settlement.transferAdvance({
      purchaseOrderId: request.purchaseOrderId,
      earlyPaymentRequestId: id,
      lpId,
      lpAccountRef,
      supplierId: request.supplierId,
      supplierAccountRef,
      amount: request.netAdvance,
      currency,
    });

    // Update request status and record fee
    const result = await this.prisma.$transaction(async (tx) => {
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

    const event = await this.ledger.logEvent({
      entityType: "EARLY_PAYMENT",
      entityId: id,
      eventType: "EARLY_PAY_FUNDED",
      actorId: lpId,
      actorRole: "LIQUIDITY_PARTNER",
      payload: {
        netAdvance: request.netAdvance,
        serviceFee: request.serviceFee,
        faceValue: request.faceValue,
        settlementRail: this.settlement.getAdapterName(),
        externalRef: transferResult.externalRef,
      },
      ...sig,
    });

    const formatted = this.formatEarlyPayment(result);
    return { ...formatted, _receipt: this.ledger.buildReceipt(event) };
  }

  /**
   * Get the marketplace of available early payment requests for LPs
   */
  async getMarketplace() {
    const requests = await this.prisma.earlyPaymentRequest.findMany({
      where: {
        status: "REQUESTED",
        // Only show requests where the PO is still in a fundable state
        purchaseOrder: {
          status: { in: ["ACCEPTED", "IN_PROGRESS", "SHIPPED", "DELIVERED"] },
        },
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
