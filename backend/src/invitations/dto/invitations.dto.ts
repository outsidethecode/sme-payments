import { IsEmail, IsEnum, IsOptional, IsObject } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateInvitationDto {
  @ApiProperty({ example: "supplier@example.com" })
  @IsEmail()
  inviteeEmail: string;

  @ApiProperty({ enum: ["SUPPLIER", "LIQUIDITY_PARTNER"], example: "SUPPLIER" })
  @IsEnum(["SUPPLIER", "LIQUIDITY_PARTNER"])
  inviteeRole: "SUPPLIER" | "LIQUIDITY_PARTNER";

  @ApiPropertyOptional({ example: { message: "Join our supply chain" } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
