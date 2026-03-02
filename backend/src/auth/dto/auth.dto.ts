import {
  IsEmail,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
  IsUUID,
  IsBoolean,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ example: "buyer@acme.co.uk" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "securepassword123" })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: "John Smith" })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: "Acme Retail Ltd" })
  @IsString()
  @MinLength(2)
  companyName: string;

  @ApiPropertyOptional({ example: "12345678" })
  @IsOptional()
  @IsString()
  companyNumber?: string;

  @ApiProperty({ enum: ["BUYER", "SUPPLIER"], example: "BUYER" })
  @IsEnum(["BUYER", "SUPPLIER"])
  role: "BUYER" | "SUPPLIER";

  @ApiPropertyOptional({ enum: ["UK", "KSA"], example: "UK" })
  @IsOptional()
  @IsEnum(["UK", "KSA"])
  jurisdiction?: "UK" | "KSA";

  @ApiPropertyOptional({ enum: ["GBP", "SAR"], example: "GBP" })
  @IsOptional()
  @IsEnum(["GBP", "SAR"])
  currency?: "GBP" | "SAR";
}

/** Register via invitation token — pre-fills role & links to inviter org context */
export class RegisterInvitedDto {
  @ApiProperty({ description: "Invitation token from the invite link" })
  @IsUUID()
  invitationToken: string;

  @ApiProperty({ example: "supplier@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "securepassword123" })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: "Ahmed Ali" })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: "AliFab Supplies" })
  @IsString()
  @MinLength(2)
  companyName: string;

  @ApiPropertyOptional({ example: "1010654321" })
  @IsOptional()
  @IsString()
  companyNumber?: string;
}

export class LoginDto {
  @ApiProperty({ example: "buyer@acme.co.uk" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "securepassword123" })
  @IsString()
  @MinLength(1)
  password: string;
}
