import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { EarlyPaymentsService } from "./early-payments.service";
import { IsString, IsOptional, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class SignatureDataDto {
  @IsOptional()
  @IsString()
  signature?: string;

  @IsOptional()
  @IsString()
  authenticatorData?: string;

  @IsOptional()
  @IsString()
  publicKey?: string;

  @IsOptional()
  @IsString()
  credentialId?: string;
}

class RequestEarlyPaymentDto {
  @IsString()
  purchaseOrderId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SignatureDataDto)
  signatureData?: SignatureDataDto;
}

@ApiTags("Early Payments")
@Controller("early-payments")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EarlyPaymentsController {
  constructor(private readonly earlyPaymentsService: EarlyPaymentsService) {}

  @Post()
  @Roles("SUPPLIER")
  @ApiOperation({ summary: "Request early payment on a PO" })
  async request(@Body() dto: RequestEarlyPaymentDto, @Request() req: any) {
    return this.earlyPaymentsService.requestEarlyPayment(
      dto.purchaseOrderId,
      req.user.id,
      dto.signatureData as any,
    );
  }

  @Get()
  @ApiOperation({ summary: "List early payment requests (filtered by role)" })
  async findAll(@Request() req: any) {
    return this.earlyPaymentsService.findAll(req.user.id, req.user.role);
  }

  @Get("marketplace")
  @Roles("LIQUIDITY_PARTNER", "ADMIN")
  @ApiOperation({
    summary: "Browse marketplace of available early payment requests",
  })
  async marketplace() {
    return this.earlyPaymentsService.getMarketplace();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single early payment request" })
  async findOne(@Param("id") id: string) {
    return this.earlyPaymentsService.findById(id);
  }

  @Patch(":id/fund")
  @Roles("LIQUIDITY_PARTNER")
  @ApiOperation({ summary: "Fund an early payment request (LP only)" })
  async fund(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.earlyPaymentsService.fund(id, req.user.id, body?.signatureData);
  }
}
