import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { ApprovalDecision, ApprovalStatus } from "@prisma/client";

export interface CreateApprovalRequestInput {
  entityType: string;
  entityId: string;
  organisationId: string;
  policyRuleId: string;
  requiredApprovals: number;
  /** Hours until the request expires (null = no expiry) */
  expiresInHours?: number;
  /** Hours until escalation (null = no escalation) */
  escalateAfterHours?: number;
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Create an approval request tied to a policy rule evaluation.
   */
  async createRequest(input: CreateApprovalRequestInput) {
    const now = new Date();

    return this.prisma.approvalRequest.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        organisationId: input.organisationId,
        policyRuleId: input.policyRuleId,
        requiredApprovals: input.requiredApprovals,
        expiresAt: input.expiresInHours
          ? new Date(now.getTime() + input.expiresInHours * 60 * 60 * 1000)
          : null,
        escalateAfter: input.escalateAfterHours
          ? new Date(now.getTime() + input.escalateAfterHours * 60 * 60 * 1000)
          : null,
      },
      include: {
        policyRule: { select: { id: true, name: true, requiredRoles: true } },
        approvals: true,
      },
    });
  }

  /**
   * Get an approval request by ID.
   */
  async findById(id: string) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id },
      include: {
        policyRule: { select: { id: true, name: true, requiredRoles: true } },
        approvals: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!request) throw new NotFoundException("Approval request not found");
    return request;
  }

  /**
   * Find approval requests for an entity (e.g., a PO).
   */
  async findByEntity(entityType: string, entityId: string) {
    return this.prisma.approvalRequest.findMany({
      where: { entityType, entityId },
      include: {
        policyRule: { select: { id: true, name: true, requiredRoles: true } },
        approvals: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Find pending approval requests for an organisation.
   */
  async findPendingByOrg(organisationId: string) {
    return this.prisma.approvalRequest.findMany({
      where: { organisationId, status: "PENDING" },
      include: {
        policyRule: { select: { id: true, name: true, requiredRoles: true } },
        approvals: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Submit an approval decision (APPROVE or REJECT) for an approval request.
   * Checks that:
   * - The request is PENDING
   * - The user hasn't already voted
   * - The user has the required org role
   * Returns the updated request + whether it's now fully approved.
   */
  async submitDecision(input: {
    approvalRequestId: string;
    userId: string;
    orgRole: string;
    decision: ApprovalDecision;
    comment?: string;
    signature?: string;
  }): Promise<{
    approvalRequest: any;
    isComplete: boolean;
    finalStatus: ApprovalStatus;
  }> {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: input.approvalRequestId },
      include: {
        policyRule: { select: { id: true, name: true, requiredRoles: true } },
        approvals: true,
      },
    });

    if (!request) throw new NotFoundException("Approval request not found");

    if (request.status !== "PENDING") {
      throw new BadRequestException(
        `Approval request is already ${request.status}`,
      );
    }

    // Check expiry
    if (request.expiresAt && new Date() > request.expiresAt) {
      await this.prisma.approvalRequest.update({
        where: { id: request.id },
        data: { status: "EXPIRED", resolvedAt: new Date() },
      });
      throw new BadRequestException("Approval request has expired");
    }

    // Check user hasn't already voted
    const alreadyVoted = request.approvals.some(
      (a) => a.userId === input.userId,
    );
    if (alreadyVoted) {
      throw new BadRequestException("You have already voted on this request");
    }

    // Check user has a required role (if roles are specified)
    const requiredRoles = request.policyRule.requiredRoles as string[];
    if (requiredRoles.length > 0 && !requiredRoles.includes(input.orgRole)) {
      throw new ForbiddenException(
        `Your role (${input.orgRole}) is not authorised to approve this request. Required: ${requiredRoles.join(", ")}`,
      );
    }

    // Record the approval
    await this.prisma.approval.create({
      data: {
        approvalRequestId: input.approvalRequestId,
        userId: input.userId,
        orgRole: input.orgRole as any,
        decision: input.decision,
        comment: input.comment,
        signature: input.signature,
      },
    });

    // If REJECT → immediately reject the whole request
    if (input.decision === "REJECT") {
      const updated = await this.prisma.approvalRequest.update({
        where: { id: request.id },
        data: {
          status: "REJECTED",
          resolvedAt: new Date(),
        },
        include: {
          policyRule: {
            select: { id: true, name: true, requiredRoles: true },
          },
          approvals: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });

      await this.ledger.logEvent({
        entityType: request.entityType,
        entityId: request.entityId,
        eventType: "PO_APPROVAL_REJECTED",
        actorId: input.userId,
        actorRole: input.orgRole,
        payload: {
          approvalRequestId: request.id,
          policyRuleName: request.policyRule.name,
          comment: input.comment,
        },
      });

      return {
        approvalRequest: updated,
        isComplete: true,
        finalStatus: "REJECTED",
      };
    }

    // APPROVE — increment counter
    const newCount = request.currentApprovals + 1;
    const isComplete = newCount >= request.requiredApprovals;

    const updated = await this.prisma.approvalRequest.update({
      where: { id: request.id },
      data: {
        currentApprovals: newCount,
        status: isComplete ? "APPROVED" : "PENDING",
        resolvedAt: isComplete ? new Date() : null,
      },
      include: {
        policyRule: { select: { id: true, name: true, requiredRoles: true } },
        approvals: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    await this.ledger.logEvent({
      entityType: request.entityType,
      entityId: request.entityId,
      eventType: "PO_APPROVAL_GRANTED",
      actorId: input.userId,
      actorRole: input.orgRole,
      payload: {
        approvalRequestId: request.id,
        policyRuleName: request.policyRule.name,
        approvalCount: `${newCount}/${request.requiredApprovals}`,
        comment: input.comment,
      },
    });

    return {
      approvalRequest: updated,
      isComplete,
      finalStatus: isComplete ? "APPROVED" : "PENDING",
    };
  }
}
