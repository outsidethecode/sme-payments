import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  MinLength,
} from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { OrganisationsService } from "./organisations.service";
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

@ApiTags("Organisations")
@Controller("organisations")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class OrganisationsController {
  constructor(private readonly orgsService: OrganisationsService) {}

  @Get("me")
  @ApiOperation({ summary: "Get current user's organisation" })
  async getMyOrg(@Request() req: any) {
    return this.orgsService.getOrgByUserId(req.user.id);
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
}
