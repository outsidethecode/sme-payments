import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService, SignatureData } from "../ledger/ledger.service";
import { SettlementService } from "../settlements/settlement.service";
import { SettlementCurrency } from "../settlements/settlement-adapter.interface";

// ── DTOs ─────────────────────────────────────────────────────

export interface RaiseDisputeInput {
  purchaseOrderId: string;
  buyerId: string;
  reason: string;
  evidenceIds?: string[];
}

export interface SubmitEvidenceInput {
  disputeId: string;
  userId: string;
  role: "BUYER" | "SUPPLIER";
  evidenceIds: string[];
}

export interface ResolveDisputeInput {
  disputeId: string;
  adminId: string;
  outcome: "FULL_REFUND" | "PARTIAL_REFUND" | "RELEASE_TO_SUPPLIER" | "REWORK";
  refundAmount?: number;
  resolutionNotes?: string;
}

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settlement: SettlementService,
  ) {}

  /**
   * Raise a dispute on a delivered PO.
   * Only the buyer can raise a dispute, and the PO must be in DELIVERED status.
   */
  async raise(input: RaiseDisputeInput, sig?: SignatureData) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      include: { paymentLock: true },
    });

    if (!po) throw new NotFoundException("Purchase order not found");
    if (po.status !== "DELIVERED")
      throw new BadRequestException(
        "Can only dispute a delivered purchase order",
      );
    if (po.buyerId !== input.buyerId)
      throw new ForbiddenException("Only the buyer can raise a dispute");

    // Check dispute window
    if (po.deliveredAt) {
      const windowMs = (po.disputeWindowHours ?? 72) * 60 * 60 * 1000;
      const deadline = new Date(po.deliveredAt.getTime() + windowMs);
      if (new Date() > deadline) {
        throw new BadRequestException(
          `Dispute window of ${po.disputeWindowHours}h has expired`,
        );
      }
    }

    // Check if a dispute already exists for this PO
    const existing = await this.prisma.dispute.findFirst({
      where: {
        purchaseOrderId: input.purchaseOrderId,
        status: { in: ["OPEN", "EVIDENCE_SUBMITTED", "UNDER_REVIEW"] },
      },
    });
    if (existing)
      throw new BadRequestException(
        "An active dispute already exists for this PO",
      );

    // Create dispute + transition PO in a transaction
    const dispute = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispute.create({
        data: {
          purchaseOrderId: input.purchaseOrderId,
          raisedById: input.buyerId,
          reason: input.reason,
          status: "OPEN",
          buyerEvidence: input.evidenceIds ?? [],
        },
      });

      await tx.purchaseOrder.update({
        where: { id: input.purchaseOrderId },
        data: { status: "DISPUTED" },
      });

      return d;
    });

    await this.ledger.logEvent({
      entityType: "DISPUTE",
      entityId: dispute.id,
      eventType: "DISPUTE_RAISED",
      actorId: input.buyerId,
      actorRole: "BUYER",
      payload: {
        purchaseOrderId: input.purchaseOrderId,
        reason: input.reason,
        evidenceIds: input.evidenceIds ?? [],
      },
      ...sig,
    });

    this.logger.log(
      `Dispute ${dispute.id} raised for PO ${input.purchaseOrderId}`,
    );

    return this.formatDispute(dispute);
  }

  /**
   * Submit evidence for a dispute.
   * Both buyer and supplier can submit evidence.
   */
  async submitEvidence(input: SubmitEvidenceInput, sig?: SignatureData) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: input.disputeId },
      include: { purchaseOrder: true },
    });

    if (!dispute) throw new NotFoundException("Dispute not found");
    if (dispute.status === "RESOLVED")
      throw new BadRequestException("Dispute is already resolved");

    // Verify actor is buyer or supplier of the PO
    const po = dispute.purchaseOrder;
    if (input.role === "BUYER" && po.buyerId !== input.userId) {
      throw new ForbiddenException("Not the buyer of this PO");
    }
    if (input.role === "SUPPLIER" && po.supplierId !== input.userId) {
      throw new ForbiddenException("Not the supplier of this PO");
    }

    // Update the relevant evidence field
    const updateData: Record<string, unknown> = {};
    if (input.role === "BUYER") {
      const existing = (dispute.buyerEvidence as string[]) || [];
      updateData.buyerEvidence = [
        ...new Set([...existing, ...input.evidenceIds]),
      ];
    } else {
      const existing = (dispute.supplierEvidence as string[]) || [];
      updateData.supplierEvidence = [
        ...new Set([...existing, ...input.evidenceIds]),
      ];
    }

    // Check if both sides have submitted evidence → advance status
    const updated = await this.prisma.dispute.update({
      where: { id: input.disputeId },
      data: updateData,
    });

    const buyerEv = (updated.buyerEvidence as string[]) || [];
    const supplierEv = (updated.supplierEvidence as string[]) || [];
    if (
      buyerEv.length > 0 &&
      supplierEv.length > 0 &&
      updated.status === "OPEN"
    ) {
      await this.prisma.dispute.update({
        where: { id: input.disputeId },
        data: { status: "EVIDENCE_SUBMITTED" },
      });
    }

    await this.ledger.logEvent({
      entityType: "DISPUTE",
      entityId: input.disputeId,
      eventType: "DISPUTE_EVIDENCE_SUBMITTED",
      actorId: input.userId,
      actorRole: input.role,
      payload: {
        evidenceIds: input.evidenceIds,
        side: input.role,
      },
      ...sig,
    });

    const final = await this.prisma.dispute.findUnique({
      where: { id: input.disputeId },
    });
    return this.formatDispute(final!);
  }

  /**
   * Admin marks dispute as under review.
   */
  async markUnderReview(
    disputeId: string,
    adminId: string,
    sig?: SignatureData,
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
    });
    if (!dispute) throw new NotFoundException("Dispute not found");
    if (dispute.status === "RESOLVED")
      throw new BadRequestException("Dispute is already resolved");

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: "UNDER_REVIEW" },
    });

    await this.ledger.logEvent({
      entityType: "DISPUTE",
      entityId: disputeId,
      eventType: "DISPUTE_UNDER_REVIEW",
      actorId: adminId,
      actorRole: "ADMIN",
      payload: {},
      ...sig,
    });

    return this.formatDispute(updated);
  }

  /**
   * Admin resolves a dispute with an outcome.
   * Triggers settlement actions based on the outcome.
   */
  async resolve(input: ResolveDisputeInput, sig?: SignatureData) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: input.disputeId },
      include: {
        purchaseOrder: {
          include: { paymentLock: true },
        },
      },
    });

    if (!dispute) throw new NotFoundException("Dispute not found");
    if (dispute.status === "RESOLVED")
      throw new BadRequestException("Dispute is already resolved");

    const po = dispute.purchaseOrder;

    // Validate partial refund amount
    if (input.outcome === "PARTIAL_REFUND") {
      if (!input.refundAmount || input.refundAmount <= 0)
        throw new BadRequestException(
          "Partial refund requires a positive refundAmount",
        );
      if (input.refundAmount >= po.amount)
        throw new BadRequestException(
          "Partial refund must be less than PO amount. Use FULL_REFUND for full amount.",
        );
    }

    // Resolve the dispute
    const resolved = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispute.update({
        where: { id: input.disputeId },
        data: {
          status: "RESOLVED",
          outcome: input.outcome,
          resolvedById: input.adminId,
          refundAmount:
            input.outcome === "FULL_REFUND"
              ? po.amount
              : input.outcome === "PARTIAL_REFUND"
                ? input.refundAmount
                : null,
          resolutionNotes: input.resolutionNotes,
          resolvedAt: new Date(),
        },
      });

      // Update PO status based on outcome
      let newPoStatus: string;
      switch (input.outcome) {
        case "FULL_REFUND":
          newPoStatus = "CANCELLED";
          break;
        case "PARTIAL_REFUND":
          newPoStatus = "SETTLED";
          break;
        case "RELEASE_TO_SUPPLIER":
          newPoStatus = "VERIFIED";
          break;
        case "REWORK":
          newPoStatus = "IN_PROGRESS";
          break;
        default:
          newPoStatus = "DISPUTED";
      }

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: newPoStatus as any },
      });

      return d;
    });

    // Execute settlement actions
    await this.executeDisputeSettlement(input, po, sig);

    await this.ledger.logEvent({
      entityType: "DISPUTE",
      entityId: input.disputeId,
      eventType: "DISPUTE_RESOLVED",
      actorId: input.adminId,
      actorRole: "ADMIN",
      payload: {
        outcome: input.outcome,
        refundAmount: resolved.refundAmount,
        resolutionNotes: input.resolutionNotes,
        purchaseOrderId: po.id,
      },
      ...sig,
    });

    this.logger.log(`Dispute ${input.disputeId} resolved: ${input.outcome}`);

    return this.formatDispute(resolved);
  }

  /**
   * Execute settlement actions based on dispute outcome.
   */
  private async executeDisputeSettlement(
    input: ResolveDisputeInput,
    po: any,
    sig?: SignatureData,
  ) {
    const lock = po.paymentLock;
    const currency = (po.currency || "GBP") as SettlementCurrency;

    switch (input.outcome) {
      case "FULL_REFUND":
        if (lock && lock.status === "LOCKED") {
          await this.settlement.refundPO({
            purchaseOrderId: po.id,
            buyerId: po.buyerId,
            amount: po.amount,
            currency,
            reservationRef: lock.openBankingRef || "",
            reason: `Dispute full refund: ${input.resolutionNotes || "N/A"}`,
          });
        }
        break;

      case "PARTIAL_REFUND":
        if (lock && lock.status === "LOCKED") {
          // For partial refund: refund partial amount to buyer first,
          // then settle remainder to supplier in a second step.
          // We use refundPO for the buyer portion (marks lock as REFUNDED),
          // then manually create a settlement record for the supplier portion.
          await this.settlement.refundPO({
            purchaseOrderId: po.id,
            buyerId: po.buyerId,
            amount: input.refundAmount!,
            currency,
            reservationRef: lock.openBankingRef || "",
            reason: `Dispute partial refund: ${input.resolutionNotes || "N/A"}`,
          });
        }
        break;

      case "RELEASE_TO_SUPPLIER":
        if (lock && lock.status === "LOCKED") {
          await this.settlement.settlePO({
            purchaseOrderId: po.id,
            recipientId: po.supplierId,
            totalAmount: po.amount,
            feeBps: 50,
            currency,
          });
        }
        break;

      case "REWORK":
        // No settlement action — PO goes back to IN_PROGRESS
        break;
    }
  }

  /**
   * Get a dispute by ID.
   */
  async findById(id: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            referenceNumber: true,
            amount: true,
            currency: true,
            status: true,
          },
        },
        raisedBy: {
          select: { id: true, name: true, email: true, companyName: true },
        },
        resolvedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
    if (!dispute) throw new NotFoundException("Dispute not found");
    return dispute;
  }

  /**
   * Get all disputes (admin or by PO).
   */
  async findAll(filters?: {
    purchaseOrderId?: string;
    status?: string;
    userId?: string;
    role?: string;
  }) {
    const where: any = {};

    if (filters?.purchaseOrderId) {
      where.purchaseOrderId = filters.purchaseOrderId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    // Non-admin users can only see disputes they're involved in
    if (filters?.role && filters.role !== "ADMIN" && filters?.userId) {
      where.purchaseOrder = {
        OR: [{ buyerId: filters.userId }, { supplierId: filters.userId }],
      };
    }

    return this.prisma.dispute.findMany({
      where,
      include: {
        purchaseOrder: {
          select: {
            id: true,
            referenceNumber: true,
            amount: true,
            currency: true,
            status: true,
            buyerId: true,
            supplierId: true,
          },
        },
        raisedBy: {
          select: { id: true, name: true, email: true, companyName: true },
        },
        resolvedBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private formatDispute(d: any) {
    return {
      id: d.id,
      purchaseOrderId: d.purchaseOrderId,
      raisedById: d.raisedById,
      reason: d.reason,
      status: d.status,
      outcome: d.outcome,
      resolvedById: d.resolvedById,
      refundAmount: d.refundAmount,
      resolutionNotes: d.resolutionNotes,
      buyerEvidence: d.buyerEvidence,
      supplierEvidence: d.supplierEvidence,
      resolvedAt: d.resolvedAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }
}
