import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { SettlementService } from "./settlement.service";
import { ReconciliationService } from "./reconciliation.service";

@Controller("settlements")
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettlementsController {
  constructor(
    private readonly service: SettlementService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  /** GET /settlements — list settlements visible to current user */
  @Get()
  async findAll(@Request() req: any) {
    const settlements = await this.service.findAll(req.user.id, req.user.role);
    return settlements.map((s) => this.format(s));
  }

  /** GET /settlements/adapter — which settlement rail is active */
  @Get("adapter")
  getAdapter() {
    return { adapter: this.service.getAdapterName() };
  }

  /** GET /settlements/pending — admin: list pending settlements for reconciliation */
  @Get("pending")
  @Roles("ADMIN")
  async findPending() {
    return this.service.findPendingSettlements();
  }

  /** GET /settlements/po/:poId — settlements for a specific PO */
  @Get("po/:poId")
  async findByPO(@Param("poId") poId: string) {
    const settlements = await this.service.findByPO(poId);
    return settlements.map((s) => this.format(s));
  }

  /** POST /settlements/:id/reconcile — admin: trigger reconciliation */
  @Post(":id/reconcile")
  @Roles("ADMIN")
  async reconcile(
    @Param("id") id: string,
    @Body() body: { externalRef: string },
  ) {
    return this.service.reconcile({
      settlementId: id,
      externalRef: body.externalRef,
    });
  }

  // ── Reconciliation Engine Endpoints ─────────────────────────

  /** GET /settlements/reconciliation/reports — paginated reconciliation history */
  @Get("reconciliation/reports")
  @Roles("ADMIN")
  async getReconciliationReports(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.reconciliation.getReports(
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  /** GET /settlements/reconciliation/latest — most recent reconciliation report */
  @Get("reconciliation/latest")
  @Roles("ADMIN")
  async getLatestReconciliation() {
    return this.reconciliation.getLatest();
  }

  /** POST /settlements/reconciliation/run — manually trigger reconciliation */
  @Post("reconciliation/run")
  @Roles("ADMIN")
  async runReconciliation() {
    return this.reconciliation.runReconciliation();
  }

  private format(s: any) {
    return {
      id: s.id,
      purchaseOrderId: s.purchaseOrderId,
      fromUserId: s.fromUserId,
      toUserId: s.toUserId,
      amount: s.amount,
      currency: s.currency || "GBP",
      type: s.type,
      status: s.status,
      settlementRail: s.settlementRail,
      externalRef: s.externalRef,
      completedAt: s.completedAt,
      reconciledAt: s.reconciledAt,
      createdAt: s.createdAt,
      purchaseOrder: s.purchaseOrder || undefined,
      fromUser: s.fromUser || undefined,
      toUser: s.toUser || undefined,
    };
  }
}
