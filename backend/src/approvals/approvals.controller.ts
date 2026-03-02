import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { IsString, IsOptional, IsEnum } from "class-validator";
import { ApprovalDecision } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApprovalsService } from "./approvals.service";
import { PurchaseOrdersService } from "../purchase-orders/purchase-orders.service";

class SubmitDecisionDto {
  @IsEnum(ApprovalDecision)
  decision!: ApprovalDecision;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  signature?: string;
}

@ApiTags("Approvals")
@Controller("approvals")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ApprovalsController {
  constructor(
    private readonly approvalsService: ApprovalsService,
    @Inject(forwardRef(() => PurchaseOrdersService))
    private readonly poService: PurchaseOrdersService,
  ) {}

  @Get("pending")
  @ApiOperation({ summary: "List pending approvals for current user's org" })
  async findPending(@Request() req: any) {
    const orgId = req.user.organisationId;
    if (!orgId) return [];
    return this.approvalsService.findPendingByOrg(orgId);
  }

  @Get("entity/:entityType/:entityId")
  @ApiOperation({ summary: "Get approval requests for a specific entity" })
  async findByEntity(
    @Param("entityType") entityType: string,
    @Param("entityId") entityId: string,
  ) {
    return this.approvalsService.findByEntity(entityType, entityId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an approval request by ID" })
  async findById(@Param("id") id: string) {
    return this.approvalsService.findById(id);
  }

  @Post(":id/decide")
  @ApiOperation({ summary: "Submit an approval or rejection" })
  async decide(
    @Param("id") id: string,
    @Body() dto: SubmitDecisionDto,
    @Request() req: any,
  ) {
    const result = await this.approvalsService.submitDecision({
      approvalRequestId: id,
      userId: req.user.id,
      orgRole: req.user.orgRole || "MEMBER",
      decision: dto.decision,
      comment: dto.comment,
      signature: dto.signature,
    });

    // Post-approval callback: auto-transition PO from PENDING_APPROVAL → SENT
    if (
      result.finalStatus === "APPROVED" &&
      result.approvalRequest.entityType === "PURCHASE_ORDER"
    ) {
      await this.poService.onApprovalComplete(
        result.approvalRequest.entityId,
        req.user.id,
      );
    }

    return result;
  }
}
