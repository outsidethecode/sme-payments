import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  IsDateString,
  MinLength,
  ArrayMinSize,
} from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import {
  OnboardingGuard,
  RequireOnboarding,
} from "../common/guards/onboarding.guard";
import { PasskeyGuard, RequirePasskey } from "../common/guards/passkey.guard";
import { Roles } from "../auth/roles.decorator";
import { OrganisationsService } from "./organisations.service";
import { DelegationService } from "./delegation.service";
import { PrismaService } from "../prisma/prisma.service";
import { OrgRole } from "@prisma/client";

class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  registrationNo?: string;

  @IsOptional()
  @IsBoolean()
  shariaCompliant?: boolean;
}

class AddMemberDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsEnum(OrgRole)
  orgRole?: OrgRole;
}

class InviteTeamMemberDto {
  @IsString()
  email: string;

  @IsString()
  name: string;

  @IsString()
  password: string;

  @IsEnum(OrgRole)
  orgRole: OrgRole;
}

class SetPermissionDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  allowedRoles: string[];
}

class CreateDelegationDto {
  @IsString()
  delegateUserId: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  actions: string[];

  @IsDateString()
  validTo: string;

  @IsOptional()
  @IsDateString()
  validFrom?: string;
}

@ApiTags("Organisations")
@Controller("organisations")
@UseGuards(JwtAuthGuard, RolesGuard, OnboardingGuard, PasskeyGuard)
@RequireOnboarding()
@RequirePasskey()
@ApiBearerAuth()
export class OrganisationsController {
  constructor(
    private readonly orgsService: OrganisationsService,
    private readonly delegationService: DelegationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("me")
  @ApiOperation({ summary: "Get current user's organisation" })
  async getMyOrg(@Request() req: any) {
    return this.orgsService.getOrgByUserId(req.user.id);
  }

  @Get("delegations/mine")
  @ApiOperation({ summary: "Get delegations received by current user" })
  async getMyDelegations(@Request() req: any) {
    return this.delegationService.getActiveDelegationsForUser(req.user.id);
  }

  @Get()
  @Roles("ADMIN")
  @ApiOperation({ summary: "List all organisations (admin only)" })
  async findAll() {
    return this.orgsService.findAll();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get organisation by ID" })
  async findById(@Param("id") id: string, @Request() req: any) {
    const org = await this.orgsService.findById(id);
    // Non-admins can only view their own org
    if (req.user.role !== "ADMIN" && req.user.organisationId !== id) {
      throw new ForbiddenException("You can only view your own organisation");
    }
    return org;
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update organisation settings" })
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateOrgDto,
    @Request() req: any,
  ) {
    // Must be admin or OWNER of this org
    if (req.user.role !== "ADMIN") {
      if (req.user.organisationId !== id || req.user.orgRole !== "OWNER") {
        throw new ForbiddenException(
          "Only org owners or platform admins can update organisation settings",
        );
      }
    }
    return this.orgsService.update(id, dto);
  }

  @Get(":id/members")
  @ApiOperation({ summary: "List organisation members" })
  async getMembers(@Param("id") id: string, @Request() req: any) {
    if (req.user.role !== "ADMIN" && req.user.organisationId !== id) {
      throw new ForbiddenException(
        "You can only view your own organisation's members",
      );
    }
    return this.orgsService.getMembers(id);
  }

  @Post(":id/members")
  @ApiOperation({ summary: "Add a member to the organisation" })
  async addMember(
    @Param("id") id: string,
    @Body() dto: AddMemberDto,
    @Request() req: any,
  ) {
    // Must be admin or OWNER of this org
    if (req.user.role !== "ADMIN") {
      if (req.user.organisationId !== id || req.user.orgRole !== "OWNER") {
        throw new ForbiddenException(
          "Only org owners or platform admins can add members",
        );
      }
    }
    return this.orgsService.addMember(id, dto);
  }

  @Post(":id/invite-member")
  @ApiOperation({
    summary:
      "Invite a new user to the organisation (creates account + membership)",
  })
  async inviteTeamMember(
    @Param("id") id: string,
    @Body() dto: InviteTeamMemberDto,
    @Request() req: any,
  ) {
    // Must be admin or OWNER of this org
    if (req.user.role !== "ADMIN") {
      if (req.user.organisationId !== id || req.user.orgRole !== "OWNER") {
        throw new ForbiddenException(
          "Only org owners or platform admins can invite members",
        );
      }
    }

    // Check email uniqueness
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException("A user with this email already exists");
    }

    // Look up org to determine UserRole
    const org = await this.prisma.organisation.findUniqueOrThrow({
      where: { id },
    });
    const roleMap: Record<string, string> = {
      BUYER: "BUYER",
      SUPPLIER: "SUPPLIER",
      LIQUIDITY_PARTNER: "LIQUIDITY_PARTNER",
    };
    const userRole = roleMap[org.type] || "BUYER";

    // Hash password and create user
    const hashedPw = await bcrypt.hash(dto.password, 10);
    const newUser = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPw,
        name: dto.name,
        role: userRole as any,
        companyName: org.name,
        balance: 0,
      },
    });

    // Add as org member
    const membership = await this.orgsService.addMember(id, {
      userId: newUser.id,
      orgRole: dto.orgRole,
    });

    return {
      user: { id: newUser.id, email: newUser.email, name: newUser.name },
      membership,
    };
  }

  @Delete(":id/members/:userId")
  @ApiOperation({ summary: "Remove a member from the organisation" })
  async removeMember(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Request() req: any,
  ) {
    if (req.user.role !== "ADMIN") {
      if (req.user.organisationId !== id || req.user.orgRole !== "OWNER") {
        throw new ForbiddenException(
          "Only org owners or platform admins can remove members",
        );
      }
    }
    return this.orgsService.removeMember(id, userId);
  }

  // ── Permission Override Endpoints ──────────────────────────

  @Get(":id/permissions")
  @ApiOperation({ summary: "List per-org permission overrides" })
  async getPermissions(@Param("id") id: string, @Request() req: any) {
    if (req.user.role !== "ADMIN" && req.user.organisationId !== id) {
      throw new ForbiddenException(
        "You can only view your own organisation's permissions",
      );
    }
    return this.prisma.orgPermission.findMany({
      where: { organisationId: id },
      orderBy: { action: "asc" },
    });
  }

  @Put(":id/permissions/:action")
  @ApiOperation({
    summary: "Set allowed roles for an action (OWNER/ADMIN only)",
  })
  async setPermission(
    @Param("id") id: string,
    @Param("action") action: string,
    @Body() dto: SetPermissionDto,
    @Request() req: any,
  ) {
    if (req.user.role !== "ADMIN") {
      if (req.user.organisationId !== id || req.user.orgRole !== "OWNER") {
        throw new ForbiddenException(
          "Only org owners or platform admins can modify permissions",
        );
      }
    }
    return this.prisma.orgPermission.upsert({
      where: { organisationId_action: { organisationId: id, action } },
      update: { allowedRoles: dto.allowedRoles },
      create: { organisationId: id, action, allowedRoles: dto.allowedRoles },
    });
  }

  @Delete(":id/permissions/:action")
  @ApiOperation({ summary: "Reset action to platform default roles" })
  async deletePermission(
    @Param("id") id: string,
    @Param("action") action: string,
    @Request() req: any,
  ) {
    if (req.user.role !== "ADMIN") {
      if (req.user.organisationId !== id || req.user.orgRole !== "OWNER") {
        throw new ForbiddenException(
          "Only org owners or platform admins can modify permissions",
        );
      }
    }
    await this.prisma.orgPermission.deleteMany({
      where: { organisationId: id, action },
    });
    return {
      message: `Permission override for ${action} removed, platform defaults apply`,
    };
  }

  // ── Delegation Endpoints ───────────────────────────────────

  @Post(":id/delegations")
  @ApiOperation({ summary: "Create a delegation" })
  async createDelegation(
    @Param("id") id: string,
    @Body() dto: CreateDelegationDto,
    @Request() req: any,
  ) {
    if (req.user.role !== "ADMIN" && req.user.organisationId !== id) {
      throw new ForbiddenException(
        "You can only manage delegations in your own organisation",
      );
    }
    return this.delegationService.delegate({
      organisationId: id,
      delegatorUserId: req.user.id,
      delegateUserId: dto.delegateUserId,
      actions: dto.actions,
      validTo: new Date(dto.validTo),
      validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
    });
  }

  @Get(":id/delegations")
  @ApiOperation({ summary: "List org delegations" })
  async getOrgDelegations(@Param("id") id: string, @Request() req: any) {
    if (req.user.role !== "ADMIN" && req.user.organisationId !== id) {
      throw new ForbiddenException(
        "You can only view delegations in your own organisation",
      );
    }
    return this.delegationService.getOrgDelegations(id);
  }

  @Delete(":id/delegations/:delegationId")
  @ApiOperation({ summary: "Revoke a delegation" })
  async revokeDelegation(
    @Param("id") id: string,
    @Param("delegationId") delegationId: string,
    @Request() req: any,
  ) {
    if (req.user.role !== "ADMIN" && req.user.organisationId !== id) {
      throw new ForbiddenException(
        "You can only manage delegations in your own organisation",
      );
    }
    return this.delegationService.revoke(delegationId, req.user.id);
  }
}
