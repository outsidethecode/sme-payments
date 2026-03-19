import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService, SignatureData } from "../ledger/ledger.service";
import { PoliciesService } from "../policies/policies.service";
import { PolicyEvaluationService } from "../policies/policy-evaluation.service";
import { OrganisationsService } from "../organisations/organisations.service";
import { SettlementService } from "../settlements/settlement.service";
import { InstrumentService } from "../settlements/instrument.service";
import { SettlementCurrency } from "../settlements/settlement-adapter.interface";
import { RiskSnapshotService } from "./risk-snapshot.service";
import {
  FeatureFlagService,
  FeatureFlag,
} from "../config/feature-flags.service";

/** Default ujrah fee if no policy rule specifies a custom feeBps */
const DEFAULT_FEE_BPS = 250;

@Injectable()
export class EarlyPaymentsService {
  private readonly logger = new Logger(EarlyPaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private policies: PoliciesService,
    private policyEngine: PolicyEvaluationService,
    private orgs: OrganisationsService,
    private settlement: SettlementService,
    private instrumentService: InstrumentService,
    private riskSnapshot: RiskSnapshotService,
    private featureFlags: FeatureFlagService,
  ) {}

  /** Check whether two users belong to the same organisation */
  private async isSameOrg(userA: string, userB: string): Promise<boolean> {
    const [orgA, orgB] = await Promise.all([
      this.orgs.getOrgByUserId(userA),
      this.orgs.getOrgByUserId(userB),
    ]);
    return !!(orgA && orgB && orgA.id === orgB.id);
  }

  /**
   * Supplier requests early payment on a FULFILLMENT / SHIPPED / DELIVERED PO.
   * The PO must have a locked payment instrument (not yet settled).
   * Transitions the instrument LOCKED → FINANCING_REQUESTED.
   */
  async requestEarlyPayment(
    purchaseOrderId: string,
    supplierId: string,
    sig?: SignatureData,
  ) {
    // ── Feature flag gate ──
    const supplierOrg = await this.orgs.getOrgByUserId(supplierId);
    const earlyPaymentsEnabled = await this.featureFlags.isEnabled(
      FeatureFlag.EARLY_PAYMENTS,
      supplierOrg?.id,
    );
    if (!earlyPaymentsEnabled) {
      throw new ForbiddenException(
        "Early payments feature is not enabled for your organisation",
      );
    }

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { paymentLock: true },
    });

    if (!po) throw new NotFoundException("Purchase order not found");
    const sameOrg = await this.isSameOrg(po.supplierId, supplierId);
    if (!sameOrg) {
      throw new ForbiddenException(
        "Only the supplier organisation of this PO can request early payment",
      );
    }
    const eligibleStatuses = ["FULFILLMENT", "SHIPPED", "DELIVERED"];
    if (!eligibleStatuses.includes(po.status)) {
      throw new BadRequestException(
        `PO must be in FULFILLMENT, SHIPPED, or DELIVERED status to request early payment (currently ${po.status})`,
      );
    }
    if (!po.paymentLock || po.paymentLock.status !== "LOCKED") {
      throw new BadRequestException(
        "PO must have a locked payment to request early payment",
      );
    }

    // ── Policy engine gate ──────────────────────────────────
    const epDecision = await this.policyEngine.evaluateForActor(
      supplierId,
      "EARLY_PAYMENT" as any,
      "EARLY_PAYMENT",
      purchaseOrderId,
      { amountMinorUnits: po.amount, currency: po.currency },
    );
    if (!epDecision.allowed) {
      if (epDecision.requiresApproval) {
        return {
          pendingApproval: true,
          approvalRequestId: epDecision.approvalRequestId,
          reason: epDecision.reason,
        } as any;
      }
      throw new ForbiddenException(
        epDecision.reason || "Action denied by policy engine",
      );
    }

    // Guard: instrument must exist and be in LOCKED state
    const instrument = await this.prisma.paymentInstrument.findUnique({
      where: { purchaseOrderId },
    });
    if (!instrument) {
      throw new BadRequestException(
        "PO has no payment instrument — cannot request early payment",
      );
    }

    // Check if an early payment request already exists — return it (idempotent)
    const existing = await this.prisma.earlyPaymentRequest.findUnique({
      where: { purchaseOrderId },
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
      },
    });
    if (existing) {
      return existing;
    }

    // Determine fee BPS from LP funding policies (use highest feeBps from any active FUNDING_LIMIT rule)
    // At request time we don't know the LP yet, so use DEFAULT_FEE_BPS as baseline
    const feeAmount = Math.round((po.amount * DEFAULT_FEE_BPS) / 10_000);
    const netAdvance = po.amount - feeAmount;

    // Transition instrument LOCKED → FINANCING_REQUESTED
    await this.instrumentService.requestFinancing(instrument.id, supplierId);

    const request = await this.prisma.earlyPaymentRequest.create({
      data: {
        purchaseOrderId,
        supplierId,
        faceValue: po.amount,
        serviceFee: feeAmount,
        netAdvance,
        currency: po.currency as any,
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
   * LP funds an early payment request.
   *
   * DOUBLE-PAYMENT PREVENTION:
   * 1. Validate request + PO + LP balance + policies  (reads)
   * 2. Atomically flip instrument beneficiary → LIQUIDITY_PROVIDER
   *    via SELECT FOR UPDATE  (serializes with settlement path)
   * 3. Transfer the advance via the settlement adapter  (side-effect)
   * 4. Update earlyPay → FUNDED + record platform fee  (commit)
   *
   * If step 3 fails, step 2 is compensated via revertFinancing().
   */
  async fund(id: string, lpId: string, sig?: SignatureData) {
    const request = await this.prisma.earlyPaymentRequest.findUnique({
      where: { id },
      include: { purchaseOrder: true },
    });

    if (!request)
      throw new NotFoundException("Early payment request not found");

    // ── Idempotency guard: if already FUNDED by this LP, return existing ──
    if (request.status === "FUNDED" && request.liquidityPartnerId === lpId) {
      const full = await this.prisma.earlyPaymentRequest.findUnique({
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
            },
          },
        },
      });
      return full;
    }

    if (request.status !== "REQUESTED") {
      throw new BadRequestException(
        `Cannot fund a request in ${request.status} status`,
      );
    }

    // Guard: PO must still be in a fundable state
    const fundableStatuses = ["FULFILLMENT", "SHIPPED", "DELIVERED"];
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

    // Guard: instrument must exist and be in FINANCING_REQUESTED state
    const instrument = await this.prisma.paymentInstrument.findUnique({
      where: { purchaseOrderId: request.purchaseOrderId },
    });
    if (!instrument) {
      throw new BadRequestException(
        "PO has no payment instrument — cannot fund",
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

    // ── Policy engine v2 gate ────────────────────────────────
    const lpFundDecision = await this.policyEngine.evaluateForActor(
      lpId,
      "LP_FUNDING" as any,
      "EARLY_PAYMENT",
      id,
      {
        amountMinorUnits: request.netAdvance,
        currency: request.purchaseOrder.currency,
      },
    );
    if (!lpFundDecision.allowed) {
      if (lpFundDecision.requiresApproval) {
        return {
          pendingApproval: true,
          approvalRequestId: lpFundDecision.approvalRequestId,
          reason: lpFundDecision.reason,
        } as any;
      }
      throw new ForbiddenException(
        lpFundDecision.reason || "Action denied by policy engine",
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

    // ── STEP 2: Atomic beneficiary flip ──────────────────────
    // SELECT FOR UPDATE serializes this with any concurrent settlePO() call.
    // If a settlement is already in progress, this will block or fail.
    await this.instrumentService.confirmFinancing(
      { instrumentId: instrument.id, financingPartnerId: lpId },
      lpId,
    );

    // ── STEP 3: Transfer advance via settlement adapter ──────
    // If this fails, we must compensate by reverting the beneficiary.
    const currency = (request.purchaseOrder.currency ||
      "GBP") as SettlementCurrency;
    const lpOrg2 = lpOrg || (await this.orgs.getOrgByUserId(lpId));
    const supplierOrg2 = await this.orgs.getOrgByUserId(request.supplierId);
    const lpAccountRef = lpOrg2?.bankIban || undefined;
    const supplierAccountRef = supplierOrg2?.bankIban || undefined;

    let transferResult: { externalRef: string | null };
    try {
      transferResult = await this.settlement.transferAdvance({
        purchaseOrderId: request.purchaseOrderId,
        earlyPaymentRequestId: id,
        lpId,
        lpAccountRef,
        supplierId: request.supplierId,
        supplierAccountRef,
        amount: request.netAdvance,
        currency,
      });
    } catch (err) {
      // ── Compensating transaction: revert beneficiary ─────
      this.logger.warn(
        `Transfer failed for instrument ${instrument.id}, reverting financing: ${err.message}`,
      );
      await this.instrumentService.revertFinancing(instrument.id, lpId);
      throw err; // re-throw so caller sees the original failure
    }

    // ── STEP 4: Commit earlyPay status + record fee ──────────
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
          currency: request.currency as any,
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
        instrumentId: instrument.id,
        beneficiaryFlipped: "SUPPLIER → LIQUIDITY_PROVIDER",
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
          status: { in: ["ACCEPTED", "FULFILLMENT", "SHIPPED", "DELIVERED"] },
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

    // Enrich with risk snapshots
    const poIds = requests.map((r) => r.purchaseOrderId);
    const snapshots = await this.riskSnapshot.computeForPOs(poIds);

    return requests.map((r) => ({
      ...this.formatEarlyPayment(r),
      risk: snapshots.get(r.purchaseOrderId) ?? null,
    }));
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
      faceValueMinor: ep.faceValue,
      serviceFeeMinor: ep.serviceFee,
      netAdvanceMinor: ep.netAdvance,
      currency: ep.currency || "GBP",
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
            totalAmountMinor: ep.purchaseOrder.amount,
            currency: ep.purchaseOrder.currency || "GBP",
            buyer: ep.purchaseOrder.buyer || undefined,
            supplier: ep.purchaseOrder.supplier || undefined,
            paymentLock: ep.purchaseOrder.paymentLock
              ? {
                  status: ep.purchaseOrder.paymentLock.status,
                  amountPennies: ep.purchaseOrder.paymentLock.amount,
                  amountMinor: ep.purchaseOrder.paymentLock.amount,
                }
              : undefined,
          }
        : undefined,
      supplier: ep.supplier || undefined,
      liquidityPartner: ep.liquidityPartner || undefined,
    };
  }
}
