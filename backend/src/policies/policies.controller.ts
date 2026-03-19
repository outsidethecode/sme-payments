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
import { OrganisationsService } from "../organisations/organisations.service";
import { PolicyTemplateService } from "./policy-template.service";

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

class SimulatePolicyDto {
  @IsNumber()
  amount!: number;

  @IsString()
  ruleType!: string;
}

@ApiTags("Policies")
@Controller("policies")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class PoliciesController {
  constructor(
    private readonly policiesService: PoliciesService,
    private readonly orgsService: OrganisationsService,
    private readonly policyTemplateService: PolicyTemplateService,
  ) {}

  @Post()
  @Roles("ADMIN")
  @ApiOperation({ summary: "Create a policy rule (Admin only)" })
  async create(@Body() dto: CreatePolicyRuleDto) {
    return this.policiesService.create(dto);
  }

  @Post("create-my-rule")
  @ApiOperation({ summary: "Create a policy rule for current user's org" })
  async createMyRule(@Request() req: any, @Body() dto: CreatePolicyRuleDto) {
    const orgId = req.user.organisationId;
    if (!orgId) return { error: "No organisation" };
    // Force the rule to belong to the user's own org
    return this.policiesService.create({ ...dto, organisationId: orgId });
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

  @Get("po-limits")
  @ApiOperation({
    summary: "Get PO order limits for current user's org (min/max amounts)",
  })
  async getPOLimits(@Request() req: any) {
    const orgId = req.user.organisationId;
    if (!orgId) {
      return {
        minAmount: 500_00,
        maxAmount: 250_000_00,
        source: "platform-default",
      };
    }
    const org = await this.orgsService.findById(orgId);
    const currency = org?.currency || "GBP";
    return this.policiesService.getPOLimits(orgId, currency);
  }

  @Get("exposure/:orgId")
  @ApiOperation({ summary: "Get LP exposure for an organisation" })
  async getLPExposure(@Param("orgId") orgId: string) {
    return this.policiesService.calculateLPExposure(orgId);
  }

  // ── Template + Readiness Endpoints ──────────────────────────

  @Get("templates/:orgType/:jurisdiction")
  @ApiOperation({
    summary: "Preview policy templates for org type + jurisdiction",
  })
  async getTemplates(
    @Param("orgType") orgType: string,
    @Param("jurisdiction") jurisdiction: string,
  ) {
    const templates = this.policyTemplateService.getTemplates(
      orgType,
      jurisdiction,
    );
    return { orgType, jurisdiction, count: templates.length, templates };
  }

  @Get("readiness/:orgId")
  @ApiOperation({
    summary: "Get pilot readiness checklist for an organisation",
  })
  async getPilotReadiness(@Param("orgId") orgId: string) {
    const readiness = await this.policyTemplateService.getPilotReadiness(orgId);
    if (!readiness) {
      return { error: "Organisation not found" };
    }
    return readiness;
  }

  @Post("seed-my-defaults")
  @ApiOperation({
    summary: "Seed default policy templates for current user's org",
  })
  async seedMyDefaults(@Request() req: any) {
    const orgId = req.user.organisationId;
    if (!orgId)
      return { created: 0, skipped: 0, rules: [], message: "No organisation" };
    const org = await this.orgsService.findById(orgId);
    return this.policyTemplateService.seedDefaultPolicies(
      orgId,
      org.type,
      org.jurisdiction,
    );
  }

  @Post("reset-my-defaults")
  @ApiOperation({
    summary: "Reset policies to defaults for current user's org",
  })
  async resetMyDefaults(@Request() req: any) {
    const orgId = req.user.organisationId;
    if (!orgId)
      return { created: 0, skipped: 0, rules: [], message: "No organisation" };
    const org = await this.orgsService.findById(orgId);
    return this.policyTemplateService.resetToDefaults(
      orgId,
      org.type,
      org.jurisdiction,
    );
  }

  @Post("org/:orgId/seed-defaults")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "Seed default policy templates for an org (Admin only)",
  })
  async seedDefaults(@Param("orgId") orgId: string) {
    const org = await this.orgsService.findById(orgId);
    return this.policyTemplateService.seedDefaultPolicies(
      orgId,
      org.type,
      org.jurisdiction,
    );
  }

  @Post("org/:orgId/reset-defaults")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "Reset policies to defaults for an org (Admin only)",
  })
  async resetDefaults(@Param("orgId") orgId: string) {
    const org = await this.orgsService.findById(orgId);
    return this.policyTemplateService.resetToDefaults(
      orgId,
      org.type,
      org.jurisdiction,
    );
  }

  @Post("simulate")
  @ApiOperation({
    summary:
      "Simulate which policy rule would match for a given amount + rule type",
  })
  async simulate(@Request() req: any, @Body() body: SimulatePolicyDto) {
    const orgId = req.user.organisationId;
    if (!orgId) {
      return { matched: false, rule: null, message: "No organisation" };
    }
    const rules = await this.policiesService.findByOrg(
      orgId,
      body.ruleType as PolicyRuleType,
    );
    const activeRules = (rules as any[])
      .filter((r: any) => r.active)
      .sort((a: any, b: any) => a.priority - b.priority);

    for (const rule of activeRules) {
      const cond = rule.conditions as Record<string, unknown>;
      const min = (cond.minAmount as number) ?? 0;
      const max = (cond.maxAmount as number) ?? Infinity;
      if (body.amount >= min && body.amount <= max) {
        return {
          matched: true,
          rule: {
            id: rule.id,
            name: rule.name,
            ruleType: rule.ruleType,
            requiredApprovals: rule.requiredApprovals,
            requiredRoles: rule.requiredRoles,
            autoApprove: rule.autoApprove,
          },
        };
      }
    }
    return { matched: false, rule: null, message: "No matching rule found" };
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
