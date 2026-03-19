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
import {
  OnboardingGuard,
  RequireOnboarding,
} from "../common/guards/onboarding.guard";
import { PasskeyGuard, RequirePasskey } from "../common/guards/passkey.guard";
import { ApprovalsService } from "./approvals.service";
import { ApprovalCallbackRegistry } from "./approval-callback.registry";
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
@UseGuards(JwtAuthGuard, OnboardingGuard, PasskeyGuard)
@RequireOnboarding()
@RequirePasskey()
@ApiBearerAuth()
export class ApprovalsController {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly callbackRegistry: ApprovalCallbackRegistry,
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

    // Post-approval callback: delegate to registry (backward-compat: PO fallback)
    if (result.finalStatus === "APPROVED") {
      const entityType = result.approvalRequest.entityType;
      const entityId = result.approvalRequest.entityId;

      // Try the registry first
      const registeredTypes = this.callbackRegistry.getRegisteredTypes();
      if (registeredTypes.includes(entityType)) {
        await this.callbackRegistry.onApproved(
          entityType,
          entityId,
          req.user.id,
        );
      } else if (entityType === "PURCHASE_ORDER") {
        // Backward-compat: direct PO callback
        await this.poService.onApprovalComplete(entityId, req.user.id);
      }
    }

    // Post-rejection callback
    if (result.finalStatus === "REJECTED") {
      const entityType = result.approvalRequest.entityType;
      const entityId = result.approvalRequest.entityId;
      await this.callbackRegistry.onRejected(entityType, entityId, req.user.id);
    }

    return result;
  }
}
