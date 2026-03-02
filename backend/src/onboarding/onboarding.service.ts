import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KybService } from "../kyb/kyb.service";
import { OnboardingStatus, OrgType, SupplierTier } from "@prisma/client";

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kybService: KybService,
  ) {}

  /**
   * Get onboarding status for an organisation.
   */
  async getStatus(orgId: string) {
    const org = await this.prisma.organisation.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        type: true,
        registrationNo: true,
        jurisdiction: true,
        onboardingStatus: true,
        authorizedSignatory: true,
        bankIban: true,
        termsAcceptedAt: true,
        kybProvider: true,
        kybVerifiedAt: true,
        supplierTier: true,
        fundingLimitTotal: true,
        fundingAccountRef: true,
        participationAgreementAcceptedAt: true,
      },
    });

    if (!org) {
      throw new NotFoundException("Organisation not found");
    }

    // Build step checklist based on org type
    const steps = this.buildSteps(org);

    return { ...org, steps };
  }

  /**
   * Buyer KYB-lite: submit CR number + authorized signatory → run KYB verification.
   */
  async buyerKyb(
    orgId: string,
    data: { registrationNo: string; authorizedSignatory: string },
  ) {
    const org = await this.getOrg(orgId, OrgType.BUYER);

    // Run KYB verification
    const kybResult = await this.kybService.verify(
      data.registrationNo,
      org.jurisdiction,
      {
        companyName: org.name,
        authorizedSignatory: data.authorizedSignatory,
      },
    );

    const newStatus = kybResult.verified
      ? OnboardingStatus.KYB_VERIFIED
      : OnboardingStatus.KYB_FAILED;

    const updated = await this.prisma.organisation.update({
      where: { id: orgId },
      data: {
        registrationNo: data.registrationNo,
        authorizedSignatory: data.authorizedSignatory,
        kybProvider: kybResult.provider,
        kybVerifiedAt: kybResult.verified ? kybResult.verifiedAt : null,
        kybData: kybResult as any,
        onboardingStatus: newStatus,
      },
    });

    this.logger.log(
      `Buyer KYB ${kybResult.verified ? "verified" : "failed"}: ${orgId}`,
    );

    return {
      verified: kybResult.verified,
      onboardingStatus: updated.onboardingStatus,
      provider: kybResult.provider,
      errorMessage: kybResult.errorMessage,
    };
  }

  /**
   * Buyer / Supplier: connect payment method (bank IBAN).
   */
  async connectPayment(orgId: string, data: { bankIban: string }) {
    const org = await this.prisma.organisation.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException("Organisation not found");

    const updated = await this.prisma.organisation.update({
      where: { id: orgId },
      data: { bankIban: data.bankIban },
    });

    this.logger.log(`Payment method connected for org ${orgId}`);

    return { bankIban: updated.bankIban };
  }

  /**
   * Supplier Tier 1 onboarding: CR + IBAN + terms acceptance → can receive POs.
   */
  async supplierTier1(
    orgId: string,
    data: {
      registrationNo: string;
      bankIban: string;
      termsAccepted: boolean;
    },
  ) {
    const org = await this.getOrg(orgId, OrgType.SUPPLIER);

    if (!data.termsAccepted) {
      throw new BadRequestException("Platform terms must be accepted");
    }

    const updated = await this.prisma.organisation.update({
      where: { id: orgId },
      data: {
        registrationNo: data.registrationNo,
        bankIban: data.bankIban,
        termsAcceptedAt: new Date(),
        supplierTier: SupplierTier.BASIC,
        onboardingStatus: OnboardingStatus.COMPLETED,
      },
    });

    this.logger.log(`Supplier Tier 1 onboarding completed: ${orgId}`);

    return {
      supplierTier: updated.supplierTier,
      onboardingStatus: updated.onboardingStatus,
    };
  }

  /**
   * Supplier Tier 2 upgrade: KYB + sanctions + UBO → can request early payment.
   */
  async supplierTier2(
    orgId: string,
    data: { uboDisclosure?: Record<string, any> },
  ) {
    const org = await this.getOrg(orgId, OrgType.SUPPLIER);

    if (org.supplierTier !== SupplierTier.BASIC) {
      throw new BadRequestException(
        "Must complete Tier 1 onboarding before upgrading to Tier 2",
      );
    }

    if (!org.registrationNo) {
      throw new BadRequestException(
        "Registration number required for Tier 2 verification",
      );
    }

    // Run KYB verification
    const kybResult = await this.kybService.verify(
      org.registrationNo,
      org.jurisdiction,
      { companyName: org.name },
    );

    if (!kybResult.verified) {
      await this.prisma.organisation.update({
        where: { id: orgId },
        data: {
          kybData: kybResult as any,
          onboardingStatus: OnboardingStatus.KYB_FAILED,
        },
      });
      throw new BadRequestException(
        `KYB verification failed: ${kybResult.errorMessage}`,
      );
    }

    // Run sanctions check
    const sanctionsResult = await this.kybService.checkSanctions(
      org.name,
      org.jurisdiction,
    );

    if (!sanctionsResult.clean) {
      throw new BadRequestException(
        `Sanctions check failed: ${sanctionsResult.details}`,
      );
    }

    const updated = await this.prisma.organisation.update({
      where: { id: orgId },
      data: {
        kybProvider: kybResult.provider,
        kybVerifiedAt: kybResult.verifiedAt,
        kybData: kybResult as any,
        sanctionsCheckedAt: new Date(),
        uboDisclosure: data.uboDisclosure ?? undefined,
        supplierTier: SupplierTier.LIQUIDITY_ELIGIBLE,
        onboardingStatus: OnboardingStatus.COMPLETED,
      },
    });

    this.logger.log(`Supplier Tier 2 upgrade completed: ${orgId}`);

    return {
      supplierTier: updated.supplierTier,
      kybVerified: true,
      sanctionsClean: true,
    };
  }

  /**
   * LP onboarding: profile + funding limits + risk config + participation agreement.
   */
  async lpOnboarding(
    orgId: string,
    data: {
      fundingAccountRef: string;
      fundingLimitTotal: number;
      riskAppetiteConfig?: Record<string, any>;
      participationAgreementAccepted: boolean;
    },
  ) {
    const org = await this.getOrg(orgId, OrgType.LIQUIDITY_PARTNER);

    if (!data.participationAgreementAccepted) {
      throw new BadRequestException("Participation agreement must be accepted");
    }

    const updated = await this.prisma.organisation.update({
      where: { id: orgId },
      data: {
        fundingAccountRef: data.fundingAccountRef,
        fundingLimitTotal: data.fundingLimitTotal,
        riskAppetiteConfig: data.riskAppetiteConfig ?? undefined,
        participationAgreementAcceptedAt: new Date(),
        onboardingStatus: OnboardingStatus.COMPLETED,
      },
    });

    this.logger.log(`LP onboarding completed: ${orgId}`);

    return {
      fundingAccountRef: updated.fundingAccountRef,
      fundingLimitTotal: updated.fundingLimitTotal,
      onboardingStatus: updated.onboardingStatus,
    };
  }

  /**
   * Complete buyer onboarding — marks as COMPLETED after all steps done.
   */
  async completeBuyerOnboarding(orgId: string) {
    const org = await this.getOrg(orgId, OrgType.BUYER);

    // Verify all required steps are complete
    if (!org.registrationNo || !org.kybVerifiedAt) {
      throw new BadRequestException("KYB verification must be completed first");
    }
    if (!org.bankIban) {
      throw new BadRequestException("Payment method must be connected first");
    }

    const updated = await this.prisma.organisation.update({
      where: { id: orgId },
      data: { onboardingStatus: OnboardingStatus.COMPLETED },
    });

    this.logger.log(`Buyer onboarding completed: ${orgId}`);

    return { onboardingStatus: updated.onboardingStatus };
  }

  // ── Helpers ──

  private async getOrg(orgId: string, expectedType: OrgType) {
    const org = await this.prisma.organisation.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException("Organisation not found");
    }

    if (org.type !== expectedType) {
      throw new ForbiddenException(
        `This endpoint is for ${expectedType} organisations`,
      );
    }

    return org;
  }

  private buildSteps(org: any) {
    switch (org.type) {
      case OrgType.BUYER:
        return {
          kyb: {
            complete: !!org.kybVerifiedAt,
            registrationNo: org.registrationNo,
            authorizedSignatory: org.authorizedSignatory,
          },
          paymentMethod: {
            complete: !!org.bankIban,
            bankIban: org.bankIban,
          },
          onboardingComplete:
            org.onboardingStatus === OnboardingStatus.COMPLETED,
        };

      case OrgType.SUPPLIER:
        return {
          tier1: {
            complete: !!org.supplierTier,
            registrationNo: org.registrationNo,
            bankIban: org.bankIban,
            termsAccepted: !!org.termsAcceptedAt,
          },
          tier2: {
            complete: org.supplierTier === SupplierTier.LIQUIDITY_ELIGIBLE,
            kybVerified: !!org.kybVerifiedAt,
          },
          onboardingComplete:
            org.onboardingStatus === OnboardingStatus.COMPLETED,
        };

      case OrgType.LIQUIDITY_PARTNER:
        return {
          profile: {
            complete: !!org.fundingAccountRef && !!org.fundingLimitTotal,
            fundingAccountRef: org.fundingAccountRef,
            fundingLimitTotal: org.fundingLimitTotal,
          },
          participationAgreement: {
            complete: !!org.participationAgreementAcceptedAt,
          },
          onboardingComplete:
            org.onboardingStatus === OnboardingStatus.COMPLETED,
        };

      default:
        return {};
    }
  }
}
