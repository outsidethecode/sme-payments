import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";

/** Maximum delegation duration: 30 days */
const MAX_DELEGATION_DAYS = 30;

export interface CreateDelegationInput {
  organisationId: string;
  delegatorUserId: string;
  delegateUserId: string;
  actions: string[];
  validFrom?: Date;
  validTo: Date;
}

@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Create a delegation: delegator grants authority for specified actions
   * to the delegate within a time window.
   *
   * Constraints:
   * - Both users must belong to the same org
   * - Delegator must be OWNER (only owners can delegate)
   * - Maximum duration: 30 days
   * - No duplicate active delegations for same pair + actions
   */
  async delegate(input: CreateDelegationInput) {
    const {
      organisationId,
      delegatorUserId,
      delegateUserId,
      actions,
      validTo,
    } = input;
    const validFrom = input.validFrom ?? new Date();

    // Validate users are in the same org
    const [delegatorMembership, delegateMembership] = await Promise.all([
      this.prisma.orgMembership.findFirst({
        where: { organisationId, userId: delegatorUserId },
      }),
      this.prisma.orgMembership.findFirst({
        where: { organisationId, userId: delegateUserId },
      }),
    ]);

    if (!delegatorMembership) {
      throw new NotFoundException(
        "Delegator is not a member of this organisation",
      );
    }
    if (!delegateMembership) {
      throw new NotFoundException(
        "Delegate is not a member of this organisation",
      );
    }

    // Only OWNER can create delegations
    if (delegatorMembership.orgRole !== "OWNER") {
      throw new ForbiddenException(
        "Only organisation OWNERs can create delegations",
      );
    }

    // Cannot delegate to yourself
    if (delegatorUserId === delegateUserId) {
      throw new BadRequestException("Cannot delegate to yourself");
    }

    // Enforce max duration
    const durationMs = validTo.getTime() - validFrom.getTime();
    const maxDurationMs = MAX_DELEGATION_DAYS * 24 * 60 * 60 * 1000;
    if (durationMs > maxDurationMs) {
      throw new BadRequestException(
        `Delegation duration cannot exceed ${MAX_DELEGATION_DAYS} days`,
      );
    }
    if (durationMs <= 0) {
      throw new BadRequestException("validTo must be after validFrom");
    }

    // Validate actions are non-empty
    if (!actions.length) {
      throw new BadRequestException("At least one action must be delegated");
    }

    const delegation = await this.prisma.orgDelegation.create({
      data: {
        organisationId,
        delegatorUserId,
        delegateUserId,
        actions,
        validFrom,
        validTo,
        active: true,
      },
      include: {
        delegator: { select: { id: true, name: true, email: true } },
        delegate: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit trail
    this.ledger
      .logEvent({
        entityType: "ORG_DELEGATION",
        entityId: delegation.id,
        eventType: "DELEGATION_CREATED",
        actorId: delegatorUserId,
        actorRole: "OWNER",
        payload: {
          organisationId,
          delegateUserId,
          actions,
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
        },
      })
      .catch((err) =>
        this.logger.warn(`Failed to log delegation creation: ${err.message}`),
      );

    return delegation;
  }

  /**
   * Revoke a delegation. Only the delegator or an OWNER can revoke.
   */
  async revoke(delegationId: string, revokerUserId: string) {
    const delegation = await this.prisma.orgDelegation.findUnique({
      where: { id: delegationId },
    });
    if (!delegation) {
      throw new NotFoundException("Delegation not found");
    }

    // Only delegator or org OWNER can revoke
    if (delegation.delegatorUserId !== revokerUserId) {
      const revokerMembership = await this.prisma.orgMembership.findFirst({
        where: {
          organisationId: delegation.organisationId,
          userId: revokerUserId,
          orgRole: "OWNER",
        },
      });
      if (!revokerMembership) {
        throw new ForbiddenException(
          "Only the delegator or an org OWNER can revoke a delegation",
        );
      }
    }

    const revoked = await this.prisma.orgDelegation.update({
      where: { id: delegationId },
      data: { active: false },
    });

    this.ledger
      .logEvent({
        entityType: "ORG_DELEGATION",
        entityId: delegationId,
        eventType: "DELEGATION_REVOKED",
        actorId: revokerUserId,
        actorRole: "OWNER",
        payload: {
          organisationId: delegation.organisationId,
          delegateUserId: delegation.delegateUserId,
        },
      })
      .catch((err) =>
        this.logger.warn(`Failed to log delegation revocation: ${err.message}`),
      );

    return revoked;
  }

  /**
   * Get active delegations received by a user.
   */
  async getActiveDelegationsForUser(userId: string) {
    return this.prisma.orgDelegation.findMany({
      where: {
        delegateUserId: userId,
        active: true,
        validFrom: { lte: new Date() },
        validTo: { gte: new Date() },
      },
      include: {
        delegator: { select: { id: true, name: true, email: true } },
        organisation: { select: { id: true, name: true } },
      },
      orderBy: { validTo: "asc" },
    });
  }

  /**
   * Get all delegations for an organisation.
   */
  async getOrgDelegations(organisationId: string) {
    return this.prisma.orgDelegation.findMany({
      where: { organisationId, active: true },
      include: {
        delegator: { select: { id: true, name: true, email: true } },
        delegate: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Check if a user has an active delegation for a specific action.
   */
  async canActAs(
    userId: string,
    organisationId: string,
    action: string,
  ): Promise<boolean> {
    const delegation = await this.prisma.orgDelegation.findFirst({
      where: {
        delegateUserId: userId,
        organisationId,
        active: true,
        actions: { has: action },
        validFrom: { lte: new Date() },
        validTo: { gte: new Date() },
      },
    });
    return !!delegation;
  }
}
