import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsEnum,
  ValidateNested,
  IsNumber,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import {
  OnboardingGuard,
  RequireOnboarding,
} from "../common/guards/onboarding.guard";
import { PasskeyGuard, RequirePasskey } from "../common/guards/passkey.guard";
import { Roles } from "../auth/roles.decorator";
import { Idempotent } from "../idempotency/idempotent.decorator";
import { PurchaseOrdersService } from "./purchase-orders.service";

class LineItemDto {
  @IsString()
  description!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @Min(1)
  unitPricePennies!: number;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  unitOfMeasure?: string;
}

class CreatePODto {
  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems!: LineItemDto[];

  @IsOptional()
  @IsString()
  externalPoNumber?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  deliveryTerms?: string;

  @IsOptional()
  @IsString()
  deliveryTermsNote?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  disputeWindowHours?: number;

  @IsOptional()
  @IsBoolean()
  partialAcceptanceAllowed?: boolean;

  @IsOptional()
  @IsString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  buyerContactName?: string;

  @IsOptional()
  @IsString()
  buyerContactEmail?: string;
}

class CounterProposeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems!: LineItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  deliveryTerms?: string;

  @IsOptional()
  signatureData?: any;
}

@ApiTags("Purchase Orders")
@Controller("purchase-orders")
@UseGuards(JwtAuthGuard, RolesGuard, OnboardingGuard, PasskeyGuard)
@RequireOnboarding()
@RequirePasskey()
@ApiBearerAuth()
export class PurchaseOrdersController {
  constructor(private readonly poService: PurchaseOrdersService) {}

  @Post()
  @Roles("BUYER")
  @ApiOperation({ summary: "Create a new purchase order (Buyer only)" })
  async create(@Body() dto: CreatePODto, @Request() req: any) {
    return this.poService.create({
      buyerId: req.user.id,
      supplierId: dto.supplierId,
      description: dto.description,
      lineItems: dto.lineItems,
      externalPoNumber: dto.externalPoNumber,
      paymentTerms: dto.paymentTerms as any,
      deliveryTerms: dto.deliveryTerms as any,
      deliveryTermsNote: dto.deliveryTermsNote,
      deliveryAddress: dto.deliveryAddress,
      taxRate: dto.taxRate,
      disputeWindowHours: dto.disputeWindowHours,
      partialAcceptanceAllowed: dto.partialAcceptanceAllowed,
      expectedDeliveryDate: dto.expectedDeliveryDate,
      notes: dto.notes,
      buyerContactName: dto.buyerContactName,
      buyerContactEmail: dto.buyerContactEmail,
    });
  }

  @Post("import/csv")
  @Roles("BUYER")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiOperation({ summary: "Import POs from CSV file (Buyer only)" })
  async importCSV(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) {
      return { statusCode: 400, message: "No CSV file provided" };
    }
    return this.poService.importFromCSV(file.buffer, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: "List purchase orders for current user" })
  async findAll(@Request() req: any) {
    return this.poService.findAll(req.user.id, req.user.role);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get purchase order details" })
  async findOne(@Param("id") id: string) {
    return this.poService.findById(id);
  }

  @Patch(":id/send")
  @Roles("BUYER")
  @ApiOperation({ summary: "Send PO to supplier (Buyer only)" })
  async send(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.send(id, req.user.id, body?.signatureData);
  }

  @Patch(":id/accept")
  @Roles("SUPPLIER")
  @ApiOperation({ summary: "Accept a PO (Supplier only)" })
  async accept(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.accept(id, req.user.id, body?.signatureData);
  }

  @Patch(":id/fund")
  @Roles("BUYER")
  @Idempotent()
  @ApiOperation({ summary: "Fund escrow for an accepted PO (Buyer only)" })
  async fundEscrow(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.fundEscrow(id, req.user.id, body?.signatureData);
  }

  @Patch(":id/confirm-escrow")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "Manually confirm escrow funding (Admin / bank callback)",
  })
  async confirmEscrow(@Param("id") id: string) {
    await this.poService.confirmEscrowFunding(id);
    return { ok: true };
  }

  @Patch(":id/reject")
  @Roles("SUPPLIER")
  @ApiOperation({ summary: "Reject a PO (Supplier only)" })
  async reject(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.reject(id, req.user.id, body?.signatureData);
  }

  @Patch(":id/counter")
  @ApiOperation({
    summary:
      "Counter-propose modified terms (Supplier from SENT, or either party from NEGOTIATION)",
  })
  async counterPropose(
    @Param("id") id: string,
    @Request() req: any,
    @Body() dto: CounterProposeDto,
  ) {
    return this.poService.counterPropose(
      id,
      req.user.id,
      {
        lineItems: dto.lineItems,
        notes: dto.notes,
        expectedDeliveryDate: dto.expectedDeliveryDate,
        paymentTerms: dto.paymentTerms as any,
        deliveryTerms: dto.deliveryTerms as any,
      },
      dto.signatureData,
    );
  }

  @Patch(":id/accept-counter")
  @ApiOperation({
    summary: "Accept the latest counter-proposal (the other party)",
  })
  async acceptCounter(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.acceptCounter(id, req.user.id, body?.signatureData);
  }

  @Patch(":id/reject-counter")
  @ApiOperation({ summary: "Reject the latest counter-proposal (cancels PO)" })
  async rejectCounter(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.rejectCounter(id, req.user.id, body?.signatureData);
  }

  @Patch(":id/ship")
  @Roles("SUPPLIER")
  @ApiOperation({ summary: "Mark PO as shipped (Supplier only)" })
  async ship(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.markShipped(id, req.user.id, body?.signatureData);
  }

  @Patch(":id/deliver")
  @Roles("SUPPLIER")
  @ApiOperation({ summary: "Mark PO as delivered (Supplier only)" })
  async deliver(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.markDelivered(id, req.user.id, body?.signatureData);
  }

  @Patch(":id/verify")
  @Roles("BUYER")
  @ApiOperation({ summary: "Verify delivery (Buyer only)" })
  async verify(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.verifyDelivery(id, req.user.id, body?.signatureData);
  }

  @Patch(":id/acknowledge")
  @Roles("BUYER")
  @Idempotent()
  @ApiOperation({
    summary: "Acknowledge obligation & trigger settlement (Buyer only)",
  })
  async acknowledge(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.acknowledgeObligation(
      id,
      req.user.id,
      body?.signatureData,
    );
  }

  @Patch(":id/dispute")
  @Roles("BUYER")
  @ApiOperation({ summary: "Dispute delivery (Buyer only)" })
  async dispute(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body?: { signatureData?: any },
  ) {
    return this.poService.dispute(id, req.user.id, body?.signatureData);
  }
}
