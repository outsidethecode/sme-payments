import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { AdminService } from "./admin.service";

@ApiTags("Admin")
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("stats")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Get platform statistics" })
  async getStats() {
    return this.adminService.getStats();
  }

  // ── Escrow Account endpoints ────────────────────────────────

  @Get("escrow-accounts")
  @Roles("ADMIN")
  @ApiOperation({ summary: "List all escrow accounts" })
  async listEscrowAccounts() {
    return this.adminService.listEscrowAccounts();
  }

  @Get("escrow-accounts/:id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Get escrow account details" })
  async getEscrowAccount(@Param("id") id: string) {
    return this.adminService.getEscrowAccount(id);
  }

  @Post("escrow-accounts")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Create a new escrow account" })
  async createEscrowAccount(
    @Body()
    body: {
      label: string;
      bank: string;
      country: string;
      currency: string;
    },
  ) {
    return this.adminService.createEscrowAccount(body);
  }

  @Patch("escrow-accounts/:id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Update an escrow account" })
  async updateEscrowAccount(
    @Param("id") id: string,
    @Body() body: { label?: string; active?: boolean },
  ) {
    return this.adminService.updateEscrowAccount(id, body);
  }
}
