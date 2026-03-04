import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { DisputesService } from "./disputes.service";

@Controller("disputes")
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /**
   * POST /disputes — Raise a dispute (buyer only)
   */
  @Post()
  async raise(
    @Req() req: any,
    @Body()
    body: {
      purchaseOrderId: string;
      reason: string;
      evidenceIds?: string[];
    },
  ) {
    return this.disputes.raise({
      purchaseOrderId: body.purchaseOrderId,
      buyerId: req.user.id,
      reason: body.reason,
      evidenceIds: body.evidenceIds,
    });
  }

  /**
   * POST /disputes/:id/evidence — Submit evidence for a dispute
   */
  @Post(":id/evidence")
  async submitEvidence(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { evidenceIds: string[] },
  ) {
    return this.disputes.submitEvidence({
      disputeId: id,
      userId: req.user.id,
      role: req.user.role === "SUPPLIER" ? "SUPPLIER" : "BUYER",
      evidenceIds: body.evidenceIds,
    });
  }

  /**
   * PATCH /disputes/:id/review — Mark dispute as under review (admin only)
   */
  @Patch(":id/review")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  async markUnderReview(@Req() req: any, @Param("id") id: string) {
    return this.disputes.markUnderReview(id, req.user.id);
  }

  /**
   * PATCH /disputes/:id/resolve — Resolve a dispute (admin only)
   */
  @Patch(":id/resolve")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  async resolve(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      outcome:
        | "FULL_REFUND"
        | "PARTIAL_REFUND"
        | "RELEASE_TO_SUPPLIER"
        | "REWORK";
      refundAmount?: number;
      resolutionNotes?: string;
    },
  ) {
    return this.disputes.resolve({
      disputeId: id,
      adminId: req.user.id,
      outcome: body.outcome,
      refundAmount: body.refundAmount,
      resolutionNotes: body.resolutionNotes,
    });
  }

  /**
   * GET /disputes — List disputes (filtered by query params)
   */
  @Get()
  async findAll(
    @Req() req: any,
    @Query("purchaseOrderId") purchaseOrderId?: string,
    @Query("status") status?: string,
  ) {
    return this.disputes.findAll({
      purchaseOrderId,
      status,
      userId: req.user.id,
      role: req.user.role,
    });
  }

  /**
   * GET /disputes/:id — Get dispute by ID
   */
  @Get(":id")
  async findById(@Param("id") id: string) {
    return this.disputes.findById(id);
  }
}
