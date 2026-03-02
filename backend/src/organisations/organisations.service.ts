import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  OrgType,
  OrgRole,
  Jurisdiction,
  Currency,
  OrgStatus,
} from "@prisma/client";

export interface CreateOrgInput {
  name: string;
  type: OrgType;
  registrationNo?: string;
  jurisdiction?: Jurisdiction;
  currency?: Currency;
  shariaCompliant?: boolean;
  metadata?: any;
}

export interface AddMemberInput {
  userId: string;
  orgRole?: OrgRole;
}

@Injectable()
export class OrganisationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateOrgInput) {
    const jurisdiction = input.jurisdiction || Jurisdiction.UK;
    const currency =
      input.currency ||
      (jurisdiction === Jurisdiction.KSA ? Currency.SAR : Currency.GBP);

    return this.prisma.organisation.create({
      data: {
        name: input.name,
        type: input.type,
        registrationNo: input.registrationNo,
        jurisdiction,
        currency,
        shariaCompliant:
          input.shariaCompliant ?? jurisdiction === Jurisdiction.KSA,
        status: OrgStatus.ACTIVE,
        metadata: input.metadata,
      },
    });
  }

  async findById(id: string) {
    const org = await this.prisma.organisation.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, name: true, role: true } },
          },
        },
      },
    });
    if (!org) throw new NotFoundException("Organisation not found");
    return org;
  }

  async findAll() {
    return this.prisma.organisation.findMany({
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, name: true, role: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(
    id: string,
    data: Partial<
      Pick<
        CreateOrgInput,
        "name" | "registrationNo" | "metadata" | "shariaCompliant"
      >
    >,
  ) {
    await this.findById(id); // throws if not found
    return this.prisma.organisation.update({
      where: { id },
      data,
    });
  }

  async updateStatus(id: string, status: OrgStatus) {
    await this.findById(id);
    return this.prisma.organisation.update({
      where: { id },
      data: { status },
    });
  }

  async addMember(orgId: string, input: AddMemberInput) {
    // Check user isn't already in an org (single org per user v1)
    const existing = await this.prisma.orgMembership.findUnique({
      where: { userId: input.userId },
    });
    if (existing) {
      throw new ConflictException("User already belongs to an organisation");
    }

    return this.prisma.orgMembership.create({
      data: {
        userId: input.userId,
        organisationId: orgId,
        orgRole: input.orgRole || OrgRole.MEMBER,
        isDefault: true,
      },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
        organisation: { select: { id: true, name: true, type: true } },
      },
    });
  }

  async removeMember(orgId: string, userId: string) {
    const membership = await this.prisma.orgMembership.findFirst({
      where: { organisationId: orgId, userId },
    });
    if (!membership) {
      throw new NotFoundException("Membership not found");
    }
    if (membership.orgRole === OrgRole.OWNER) {
      // Check there's another owner before removing
      const ownerCount = await this.prisma.orgMembership.count({
        where: { organisationId: orgId, orgRole: OrgRole.OWNER },
      });
      if (ownerCount <= 1) {
        throw new ForbiddenException(
          "Cannot remove the last owner of an organisation",
        );
      }
    }
    return this.prisma.orgMembership.delete({ where: { id: membership.id } });
  }

  async getMembers(orgId: string) {
    return this.prisma.orgMembership.findMany({
      where: { organisationId: orgId },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
      },
      orderBy: { joinedAt: "asc" },
    });
  }

  async getOrgByUserId(userId: string) {
    const membership = await this.prisma.orgMembership.findUnique({
      where: { userId },
      include: {
        organisation: true,
      },
    });
    if (!membership) return null;
    return {
      ...membership.organisation,
      orgRole: membership.orgRole,
    };
  }

  async getMembershipByUserId(userId: string) {
    return this.prisma.orgMembership.findUnique({
      where: { userId },
      include: { organisation: true },
    });
  }

  /**
   * Creates an organisation and adds a user as OWNER in a single transaction.
   * Used during registration.
   */
  async createWithOwner(input: CreateOrgInput, userId: string) {
    const jurisdiction = input.jurisdiction || Jurisdiction.UK;
    const currency =
      input.currency ||
      (jurisdiction === Jurisdiction.KSA ? Currency.SAR : Currency.GBP);

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organisation.create({
        data: {
          name: input.name,
          type: input.type,
          registrationNo: input.registrationNo,
          jurisdiction,
          currency,
          shariaCompliant:
            input.shariaCompliant ?? jurisdiction === Jurisdiction.KSA,
          status: OrgStatus.ACTIVE,
          onboardingStatus: "NOT_STARTED",
          metadata: input.metadata,
        },
      });

      const membership = await tx.orgMembership.create({
        data: {
          userId,
          organisationId: org.id,
          orgRole: OrgRole.OWNER,
          isDefault: true,
        },
      });

      return { organisation: org, membership };
    });
  }
}
