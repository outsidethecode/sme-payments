import {
  IsEmail,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
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
