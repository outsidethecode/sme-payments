import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InvitationStatus, OrgType } from "@prisma/client";

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an invitation. Buyers invite suppliers; admins invite LPs.
   */
  async create(input: {
    inviterOrgId: string;
    inviterUserId: string;
    inviteeEmail: string;
    inviteeRole: "SUPPLIER" | "LIQUIDITY_PARTNER";
    metadata?: Record<string, any>;
  }) {
    // Validate: check the inviter org exists
    const org = await this.prisma.organisation.findUnique({
      where: { id: input.inviterOrgId },
    });
    if (!org) {
      throw new NotFoundException("Inviter organisation not found");
    }

    // Only BUYER orgs can invite SUPPLIER; only ADMIN users invite LP
    if (input.inviteeRole === "SUPPLIER" && org.type !== OrgType.BUYER) {
      throw new ForbiddenException(
        "Only buyer organisations can invite suppliers",
      );
    }

    // Check for duplicate pending invitation
    const existing = await this.prisma.invitation.findFirst({
      where: {
        inviterOrgId: input.inviterOrgId,
        inviteeEmail: input.inviteeEmail,
        status: InvitationStatus.PENDING,
      },
    });
    if (existing) {
      throw new BadRequestException(
        "A pending invitation already exists for this email",
      );
    }

    // 7-day expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await this.prisma.invitation.create({
      data: {
        inviterOrgId: input.inviterOrgId,
        inviterUserId: input.inviterUserId,
        inviteeEmail: input.inviteeEmail,
        inviteeRole:
          input.inviteeRole === "SUPPLIER"
            ? OrgType.SUPPLIER
            : OrgType.LIQUIDITY_PARTNER,
        expiresAt,
        metadata: input.metadata,
      },
      include: {
        inviterOrg: { select: { name: true, type: true } },
      },
    });

    this.logger.log(
      `Invitation created: ${invitation.id} -> ${input.inviteeEmail} as ${input.inviteeRole}`,
    );

    return invitation;
  }

  /**
   * List invitations for an organisation.
   */
  async findByOrg(orgId: string) {
    return this.prisma.invitation.findMany({
      where: { inviterOrgId: orgId },
      orderBy: { createdAt: "desc" },
      include: {
        inviterOrg: { select: { name: true } },
      },
    });
  }

  /**
   * Get invitation by its unique token (for the accept flow).
   */
  async findByToken(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: {
        inviterOrg: {
          select: {
            name: true,
            type: true,
            jurisdiction: true,
            currency: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException("Invitation not found");
    }

    // Check expiry
    if (
      invitation.status === InvitationStatus.PENDING &&
      invitation.expiresAt < new Date()
    ) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new BadRequestException("Invitation has expired");
    }

    return invitation;
  }

  /**
   * Mark invitation as accepted.
   */
  async accept(token: string) {
    const invitation = await this.findByToken(token);

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `Invitation is ${invitation.status.toLowerCase()}, cannot accept`,
      );
    }

    return this.prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });
  }

  /**
   * Cancel a pending invitation.
   */
  async cancel(id: string, orgId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id },
    });

    if (!invitation) {
      throw new NotFoundException("Invitation not found");
    }

    if (invitation.inviterOrgId !== orgId) {
      throw new ForbiddenException("Not authorized to cancel this invitation");
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `Cannot cancel ${invitation.status.toLowerCase()} invitation`,
      );
    }

    return this.prisma.invitation.update({
      where: { id },
      data: { status: InvitationStatus.CANCELLED },
    });
  }
}
