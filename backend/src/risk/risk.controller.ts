import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { FraudControlsService } from "./fraud-controls.service";
import { LpRiskService } from "./lp-risk.service";

@Controller("risk")
@UseGuards(JwtAuthGuard)
export class RiskController {
  constructor(
    private readonly fraud: FraudControlsService,
    private readonly lpRisk: LpRiskService,
  ) {}

  // ── Fraud Controls ────────────────────────────────────────

  /**
   * GET /risk/fraud/config — Get current fraud control configuration (admin only)
   */
  @Get("fraud/config")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  getFraudConfig() {
    return this.fraud.getConfig();
  }

  /**
   * PATCH /risk/fraud/config — Update fraud control configuration (admin only)
   */
  @Patch("fraud/config")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  updateFraudConfig(@Body() body: Record<string, any>) {
    return this.fraud.updateConfig(body);
  }

  /**
   * GET /risk/fraud/flags — Get unacknowledged fraud flags (admin only)
   */
  @Get("fraud/flags")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  getUnacknowledgedFlags() {
    return this.fraud.getUnacknowledgedFlags();
  }

  /**
   * PATCH /risk/fraud/flags/:id/acknowledge — Acknowledge a fraud flag (admin only)
   */
  @Patch("fraud/flags/:id/acknowledge")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  acknowledgeFlag(@Req() req: any, @Param("id") id: string) {
    return this.fraud.acknowledgeFlag(id, req.user.id);
  }

  /**
   * GET /risk/fraud/flags/user/:userId — Get fraud flags for a specific user (admin only)
   */
  @Get("fraud/flags/user/:userId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  getUserFlags(@Param("userId") userId: string) {
    return this.fraud.getFlagsForUser(userId);
  }

  // ── LP Risk & Exposure ────────────────────────────────────

  /**
   * GET /risk/lp/config — Get LP risk configuration (admin only)
   */
  @Get("lp/config")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  getLpRiskConfig() {
    return this.lpRisk.getConfig();
  }

  /**
   * PATCH /risk/lp/config — Update LP risk configuration (admin only)
   */
  @Patch("lp/config")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  updateLpRiskConfig(@Body() body: Record<string, any>) {
    return this.lpRisk.updateConfig(body);
  }

  /**
   * GET /risk/lp/exposure/:lpId — Get real-time exposure for an LP
   */
  @Get("lp/exposure/:lpId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "LIQUIDITY_PARTNER")
  async getLpExposure(@Param("lpId") lpId: string) {
    return this.lpRisk.calculateExposure(lpId);
  }

  /**
   * POST /risk/lp/exposure/:lpId/snapshot — Take an exposure snapshot
   */
  @Post("lp/exposure/:lpId/snapshot")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  async takeSnapshot(@Param("lpId") lpId: string) {
    return this.lpRisk.takeSnapshot(lpId);
  }

  /**
   * GET /risk/lp/exposure/:lpId/history — Get exposure snapshot history
   */
  @Get("lp/exposure/:lpId/history")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "LIQUIDITY_PARTNER")
  async getSnapshotHistory(
    @Param("lpId") lpId: string,
    @Query("limit") limit?: string,
  ) {
    return this.lpRisk.getSnapshotHistory(lpId, limit ? parseInt(limit) : 50);
  }

  /**
   * POST /risk/lp/check-funding — Check if an LP can fund a new request
   */
  @Post("lp/check-funding")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "LIQUIDITY_PARTNER")
  async checkFunding(@Body() body: { lpId: string; amount: number }) {
    return this.lpRisk.checkFundingEligibility(body.lpId, body.amount);
  }
}
