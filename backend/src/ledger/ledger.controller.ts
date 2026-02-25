import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { LedgerService } from "./ledger.service";

@ApiTags("Ledger")
@Controller("ledger")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get()
  @ApiOperation({ summary: "List ledger events" })
  @ApiQuery({ name: "entityId", required: false })
  async list(@Query("entityId") entityId?: string) {
    return this.ledgerService.getEvents(entityId);
  }

  @Get("verify/:entityId")
  @ApiOperation({ summary: "Verify hash chain for an entity" })
  async verify(@Param("entityId") entityId: string) {
    return this.ledgerService.verifyChain(entityId);
  }
}
