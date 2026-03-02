import {
  IsString,
  IsOptional,
  MinLength,
  IsObject,
  IsBoolean,
  IsInt,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Buyer submits KYB-lite: CR number + authorized signatory */
export class BuyerKybDto {
  @ApiProperty({
    example: "1010123456",
    description: "Commercial registration number",
  })
  @IsString()
  @MinLength(4)
  registrationNo: string;

  @ApiProperty({
    example: "Mohammed Al-Fahad",
    description: "Name of authorized signatory",
  })
  @IsString()
  @MinLength(2)
  authorizedSignatory: string;
}

/** Buyer connects payment method (bank IBAN) */
export class ConnectPaymentDto {
  @ApiProperty({
    example: "SA0380000000608010167519",
    description: "Bank IBAN",
  })
  @IsString()
  @MinLength(10)
  bankIban: string;
}

/** Supplier Tier 1 onboarding: basic info to receive POs */
export class SupplierTier1Dto {
  @ApiProperty({
    example: "1010654321",
    description: "Commercial registration number",
  })
  @IsString()
  @MinLength(4)
  registrationNo: string;

  @ApiProperty({
    example: "SA0380000000608010167520",
    description: "Bank IBAN for payments",
  })
  @IsString()
  @MinLength(10)
  bankIban: string;

  @ApiProperty({
    example: true,
    description: "Accepted platform terms of service",
  })
  @IsBoolean()
  termsAccepted: boolean;
}

/** Supplier Tier 2 upgrade: KYB + sanctions + UBO for early payment eligibility */
export class SupplierTier2Dto {
  @ApiPropertyOptional({
    example: { fullName: "Ahmed Ali", ownership: 51 },
    description: "Ultimate Beneficial Owner disclosure",
  })
  @IsOptional()
  @IsObject()
  uboDisclosure?: Record<string, any>;
}

/** LP onboarding: profile + limits + risk config */
export class LpOnboardingDto {
  @ApiProperty({
    example: "SA0380000000608010167521",
    description: "Funding account IBAN",
  })
  @IsString()
  @MinLength(10)
  fundingAccountRef: string;

  @ApiProperty({
    example: 50000000,
    description: "Total funding limit in smallest currency unit",
  })
  @IsInt()
  @Min(1)
  fundingLimitTotal: number;

  @ApiPropertyOptional({
    example: { maxConcentrationPct: 25, preferredTenorDays: 30 },
  })
  @IsOptional()
  @IsObject()
  riskAppetiteConfig?: Record<string, any>;

  @ApiProperty({
    example: true,
    description: "Accepted participation agreement",
  })
  @IsBoolean()
  participationAgreementAccepted: boolean;
}
