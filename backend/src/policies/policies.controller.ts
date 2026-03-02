import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  IsEnum,
  IsObject,
  Min,
} from "class-validator";
import { PolicyRuleType } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { PoliciesService, PolicyConditions } from "./policies.service";

class CreatePolicyRuleDto {
  @IsString()
  organisationId!: string;

  @IsEnum(PolicyRuleType)
  ruleType!: PolicyRuleType;

  @IsString()
  name!: string;

  @IsObject()
  conditions!: PolicyConditions;

  @IsOptional()
  @IsNumber()
  @Min(0)
  requiredApprovals?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredRoles?: string[];

  @IsOptional()
  @IsBoolean()
  autoApprove?: boolean;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class UpdatePolicyRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  conditions?: PolicyConditions;

  @IsOptional()
  @IsNumber()
  @Min(0)
  requiredApprovals?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredRoles?: string[];

  @IsOptional()
  @IsBoolean()
  autoApprove?: boolean;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

@ApiTags("Policies")
@Controller("policies")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Post()
  @Roles("ADMIN")
  @ApiOperation({ summary: "Create a policy rule (Admin only)" })
  async create(@Body() dto: CreatePolicyRuleDto) {
    return this.policiesService.create(dto);
  }

  @Get("org/:orgId")
  @ApiOperation({ summary: "List policy rules for an organisation" })
  async findByOrg(
    @Param("orgId") orgId: string,
    @Query("ruleType") ruleType?: PolicyRuleType,
  ) {
    return this.policiesService.findByOrg(orgId, ruleType);
  }

  @Get("evaluate/po-approval")
  @ApiOperation({
    summary: "Evaluate PO approval policy for current user's org",
  })
  async evaluatePOApproval(
    @Request() req: any,
    @Query("amount") amount: string,
  ) {
    const orgId = req.user.organisationId;
    if (!orgId)
      return {
        requiresApproval: false,
        autoApprove: true,
        requiredApprovals: 0,
        requiredRoles: [],
        matchedRule: null,
      };
    return this.policiesService.evaluatePOApproval(orgId, parseInt(amount, 10));
  }

  @Get("exposure/:orgId")
  @ApiOperation({ summary: "Get LP exposure for an organisation" })
  async getLPExposure(@Param("orgId") orgId: string) {
    return this.policiesService.calculateLPExposure(orgId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a policy rule by ID" })
  async findById(@Param("id") id: string) {
    return this.policiesService.findById(id);
  }

  @Patch(":id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Update a policy rule (Admin only)" })
  async update(@Param("id") id: string, @Body() dto: UpdatePolicyRuleDto) {
    return this.policiesService.update(id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Deactivate a policy rule (Admin only)" })
  async delete(@Param("id") id: string) {
    return this.policiesService.delete(id);
  }
}
