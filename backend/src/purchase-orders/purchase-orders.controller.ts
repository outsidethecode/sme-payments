import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
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
}

@ApiTags("Purchase Orders")
@Controller("purchase-orders")
@UseGuards(JwtAuthGuard, RolesGuard)
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
    });
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
  async send(@Param("id") id: string, @Request() req: any) {
    return this.poService.send(id, req.user.id);
  }

  @Patch(":id/accept")
  @Roles("SUPPLIER")
  @ApiOperation({ summary: "Accept a PO (Supplier only)" })
  async accept(@Param("id") id: string, @Request() req: any) {
    return this.poService.accept(id, req.user.id);
  }

  @Patch(":id/reject")
  @Roles("SUPPLIER")
  @ApiOperation({ summary: "Reject a PO (Supplier only)" })
  async reject(@Param("id") id: string, @Request() req: any) {
    return this.poService.reject(id, req.user.id);
  }

  @Patch(":id/deliver")
  @Roles("SUPPLIER")
  @ApiOperation({ summary: "Mark PO as delivered (Supplier only)" })
  async deliver(@Param("id") id: string, @Request() req: any) {
    return this.poService.markDelivered(id, req.user.id);
  }

  @Patch(":id/verify")
  @Roles("BUYER")
  @ApiOperation({ summary: "Verify delivery (Buyer only)" })
  async verify(@Param("id") id: string, @Request() req: any) {
    return this.poService.verifyDelivery(id, req.user.id);
  }

  @Patch(":id/dispute")
  @Roles("BUYER")
  @ApiOperation({ summary: "Dispute delivery (Buyer only)" })
  async dispute(@Param("id") id: string, @Request() req: any) {
    return this.poService.dispute(id, req.user.id);
  }
}
