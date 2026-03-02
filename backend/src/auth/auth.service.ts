import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { UsersService } from "../users/users.service";
import { OrganisationsService } from "../organisations/organisations.service";
import { InvitationsService } from "../invitations/invitations.service";
import {
  OrgType,
  Jurisdiction,
  Currency,
  OnboardingStatus,
  UserRole,
} from "@prisma/client";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly orgsService: OrganisationsService,
    private readonly invitationsService: InvitationsService,
    private readonly jwtService: JwtService,
  ) {}

  async register(data: {
    email: string;
    password: string;
    name: string;
    companyName: string;
    companyNumber?: string;
    role: "BUYER" | "SUPPLIER";
    jurisdiction?: "UK" | "KSA";
    currency?: "GBP" | "SAR";
  }) {
    const existing = await this.usersService.findByEmail(data.email);
    if (existing) {
      throw new ConflictException("Email already registered");
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const user = await this.usersService.create({
      ...data,
      password: hashedPassword,
    });

    // Create organisation and add user as OWNER
    const orgType = data.role === "BUYER" ? OrgType.BUYER : OrgType.SUPPLIER;
    const jurisdiction = (data.jurisdiction as Jurisdiction) || Jurisdiction.UK;
    const currency = (data.currency as Currency) || undefined;

    const { organisation } = await this.orgsService.createWithOwner(
      {
        name: data.companyName,
        type: orgType,
        registrationNo: data.companyNumber,
        jurisdiction,
        currency,
      },
      user.id,
    );

    const token = this.generateToken(
      user.id,
      user.email,
      user.role,
      organisation.id,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyName: data.companyName,
        organisationId: organisation.id,
        jurisdiction: organisation.jurisdiction,
        currency: organisation.currency,
      },
      accessToken: token,
    };
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // Look up org membership
    const orgInfo = await this.orgsService.getOrgByUserId(user.id);

    const token = this.generateToken(
      user.id,
      user.email,
      user.role,
      orgInfo?.id,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyName: user.companyName || orgInfo?.name,
        organisationId: orgInfo?.id,
        orgRole: orgInfo?.orgRole,
        jurisdiction: orgInfo?.jurisdiction,
        currency: orgInfo?.currency,
      },
      accessToken: token,
    };
  }

  private generateToken(
    userId: string,
    email: string,
    role: string,
    organisationId?: string,
  ): string {
    return this.jwtService.sign({
      sub: userId,
      email,
      role,
      organisationId,
    });
  }

  /**
   * Register via invitation token.
   * Creates user + org, marks invitation as accepted.
   */
  async registerInvited(data: {
    invitationToken: string;
    email: string;
    password: string;
    name: string;
    companyName: string;
    companyNumber?: string;
  }) {
    // Validate invitation
    const invitation = await this.invitationsService.findByToken(
      data.invitationToken,
    );

    if (invitation.status !== "PENDING") {
      throw new BadRequestException(
        `Invitation is ${invitation.status.toLowerCase()}, cannot register`,
      );
    }

    // Email must match invitation
    if (invitation.inviteeEmail.toLowerCase() !== data.email.toLowerCase()) {
      throw new BadRequestException("Email does not match the invitation");
    }

    // Check for existing user
    const existing = await this.usersService.findByEmail(data.email);
    if (existing) {
      throw new ConflictException("Email already registered");
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    // Map invitation role to user role
    const roleMap: Record<string, UserRole> = {
      SUPPLIER: UserRole.SUPPLIER,
      LIQUIDITY_PARTNER: UserRole.LIQUIDITY_PARTNER,
    };
    const userRole = roleMap[invitation.inviteeRole] || UserRole.SUPPLIER;
    const orgType = invitation.inviteeRole as OrgType;

    // Use inviter org's jurisdiction/currency for the new org
    const jurisdiction =
      (invitation.inviterOrg as any)?.jurisdiction || Jurisdiction.UK;
    const currency = (invitation.inviterOrg as any)?.currency || Currency.GBP;

    const user = await this.usersService.create({
      email: data.email,
      password: hashedPassword,
      name: data.name,
      role: userRole as any,
      companyName: data.companyName,
      companyNumber: data.companyNumber,
    });

    // Create org with NOT_STARTED onboarding (they still need to complete onboarding steps)
    const { organisation } = await this.orgsService.createWithOwner(
      {
        name: data.companyName,
        type: orgType,
        registrationNo: data.companyNumber,
        jurisdiction,
        currency,
        metadata: {
          invitedBy: invitation.inviterOrgId,
          invitationId: invitation.id,
        },
      },
      user.id,
    );

    // Mark invitation as accepted
    await this.invitationsService.accept(data.invitationToken);

    const token = this.generateToken(
      user.id,
      user.email,
      user.role,
      organisation.id,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyName: data.companyName,
        organisationId: organisation.id,
        jurisdiction: organisation.jurisdiction,
        currency: organisation.currency,
      },
      accessToken: token,
      invitation: {
        id: invitation.id,
        inviterOrgName: (invitation.inviterOrg as any)?.name,
      },
    };
  }
}
