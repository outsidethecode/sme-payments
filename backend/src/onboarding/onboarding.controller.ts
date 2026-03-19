import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  Query,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { OnboardingService } from "./onboarding.service";
import {
  BuyerKybDto,
  ConnectPaymentDto,
  SupplierTier1Dto,
  SupplierTier2Dto,
  LpOnboardingDto,
} from "./dto/onboarding.dto";
import { InitiateIdentityDto } from "../identity/dto/identity.dto";

@ApiTags("Onboarding")
@Controller("onboarding")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get("status")
  @ApiOperation({ summary: "Get onboarding status and step checklist" })
  async getStatus(@Request() req: any) {
    return this.onboardingService.getStatus(
      req.user.organisationId,
      req.user.id,
    );
  }

  // ── Identity verification endpoints ──

  @Post("identity/initiate")
  @ApiOperation({ summary: "Initiate identity verification (Nafath / mock)" })
  async initiateIdentity(
    @Body() dto: InitiateIdentityDto,
    @Request() req: any,
  ) {
    return this.onboardingService.initiateIdentityVerification(
      req.user.id,
      dto.nationalId,
    );
  }

  @Get("identity/status")
  @ApiOperation({ summary: "Check identity verification status" })
  async checkIdentityStatus(
    @Query("transactionId") transactionId: string,
    @Query("nationalId") nationalId: string,
    @Request() req: any,
  ) {
    return this.onboardingService.checkIdentityStatus(
      req.user.id,
      transactionId,
      nationalId,
    );
  }

  // ── Buyer endpoints ──

  @Post("buyer/kyb")
  @UseGuards(RolesGuard)
  @Roles("BUYER")
  @ApiOperation({
    summary: "Buyer KYB-lite: submit CR number + authorized signatory",
  })
  async buyerKyb(@Body() dto: BuyerKybDto, @Request() req: any) {
    return this.onboardingService.buyerKyb(req.user.organisationId, {
      registrationNo: dto.registrationNo,
      authorizedSignatory: dto.authorizedSignatory,
    });
  }

  @Post("buyer/payment")
  @UseGuards(RolesGuard)
  @Roles("BUYER")
  @ApiOperation({ summary: "Buyer: connect payment method (bank IBAN)" })
  async buyerPayment(@Body() dto: ConnectPaymentDto, @Request() req: any) {
    return this.onboardingService.connectPayment(req.user.organisationId, {
      bankIban: dto.bankIban,
    });
  }

  @Post("buyer/complete")
  @UseGuards(RolesGuard)
  @Roles("BUYER")
  @ApiOperation({ summary: "Mark buyer onboarding as complete" })
  async buyerComplete(@Request() req: any) {
    return this.onboardingService.completeBuyerOnboarding(
      req.user.organisationId,
    );
  }

  // ── Supplier endpoints ──

  @Post("supplier/tier1")
  @UseGuards(RolesGuard)
  @Roles("SUPPLIER")
  @ApiOperation({
    summary: "Supplier Tier 1: CR + IBAN + terms → can receive POs",
  })
  async supplierTier1(@Body() dto: SupplierTier1Dto, @Request() req: any) {
    return this.onboardingService.supplierTier1(req.user.organisationId, {
      registrationNo: dto.registrationNo,
      bankIban: dto.bankIban,
      termsAccepted: dto.termsAccepted,
    });
  }

  @Post("supplier/tier2")
  @UseGuards(RolesGuard)
  @Roles("SUPPLIER")
  @ApiOperation({
    summary:
      "Supplier Tier 2 upgrade: KYB + sanctions + UBO → early payment eligible",
  })
  async supplierTier2(@Body() dto: SupplierTier2Dto, @Request() req: any) {
    return this.onboardingService.supplierTier2(req.user.organisationId, {
      uboDisclosure: dto.uboDisclosure,
    });
  }

  // ── LP endpoints ──

  @Post("lp/profile")
  @UseGuards(RolesGuard)
  @Roles("LIQUIDITY_PARTNER")
  @ApiOperation({
    summary: "LP onboarding: funding profile + participation agreement",
  })
  async lpProfile(@Body() dto: LpOnboardingDto, @Request() req: any) {
    return this.onboardingService.lpOnboarding(req.user.organisationId, {
      fundingAccountRef: dto.fundingAccountRef,
      fundingLimitTotal: dto.fundingLimitTotal,
      riskAppetiteConfig: dto.riskAppetiteConfig,
      participationAgreementAccepted: dto.participationAgreementAccepted,
    });
  }

  // ── Shared endpoints ──

  @Post("payment")
  @ApiOperation({ summary: "Connect payment method (any org type)" })
  async connectPayment(@Body() dto: ConnectPaymentDto, @Request() req: any) {
    return this.onboardingService.connectPayment(req.user.organisationId, {
      bankIban: dto.bankIban,
    });
  }
}
