import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { InvitationsService } from "./invitations.service";
import { CreateInvitationDto } from "./dto/invitations.dto";

@ApiTags("Invitations")
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER", "ADMIN")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create an invitation (buyer→supplier, admin→LP)" })
  async create(@Body() dto: CreateInvitationDto, @Request() req: any) {
    return this.invitationsService.create({
      inviterOrgId: req.user.organisationId,
      inviterUserId: req.user.id,
      inviteeEmail: dto.inviteeEmail,
      inviteeRole: dto.inviteeRole,
      metadata: dto.metadata,
    });
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List invitations for the current org" })
  async list(@Request() req: any) {
    return this.invitationsService.findByOrg(req.user.organisationId);
  }

  @Get(":token")
  @ApiOperation({
    summary: "Get invitation details by token (public, for accept flow)",
  })
  async getByToken(@Param("token") token: string) {
    return this.invitationsService.findByToken(token);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Cancel a pending invitation" })
  async cancel(@Param("id") id: string, @Request() req: any) {
    return this.invitationsService.cancel(id, req.user.organisationId);
  }
}
