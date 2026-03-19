import { Test, TestingModule } from "@nestjs/testing";
import { OnboardingService } from "./onboarding.service";
import { PrismaService } from "../prisma/prisma.service";
import { KybService } from "../kyb/kyb.service";
import { IdentityService } from "../identity/identity.service";
import { PasskeysService } from "../passkeys/passkeys.service";
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";

describe("OnboardingService", () => {
  let service: OnboardingService;
  let prisma: Record<string, any>;
  let kybService: Record<string, jest.Mock>;
  let identityService: Record<string, jest.Mock>;
  let passkeysService: Record<string, jest.Mock>;

  const mockBuyerOrg = {
    id: "org-buyer-1",
    name: "Test Buyer Corp",
    type: "BUYER",
    registrationNo: null,
    jurisdiction: "KSA",
    currency: "SAR",
    onboardingStatus: "NOT_STARTED",
    authorizedSignatory: null,
    bankIban: null,
    termsAcceptedAt: null,
    kybProvider: null,
    kybVerifiedAt: null,
    kybData: null,
    uboDisclosure: null,
    sanctionsCheckedAt: null,
    supplierTier: null,
    fundingLimitTotal: null,
    fundingAccountRef: null,
    participationAgreementAcceptedAt: null,
  };

  const mockSupplierOrg = {
    ...mockBuyerOrg,
    id: "org-sup-1",
    name: "Test Supplier Ltd",
    type: "SUPPLIER",
  };

  const mockLpOrg = {
    ...mockBuyerOrg,
    id: "org-lp-1",
    name: "Test LP Fund",
    type: "LIQUIDITY_PARTNER",
  };

  beforeEach(async () => {
    prisma = {
      organisation: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    kybService = {
      verify: jest.fn(),
      checkSanctions: jest.fn(),
    };

    identityService = {
      initiate: jest.fn(),
      checkStatus: jest.fn(),
      getVerificationStatus: jest.fn(),
    };

    passkeysService = {
      hasPasskey: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: PrismaService, useValue: prisma },
        { provide: KybService, useValue: kybService },
        { provide: IdentityService, useValue: identityService },
        { provide: PasskeysService, useValue: passkeysService },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
  });

  describe("getStatus", () => {
    it("should return onboarding status for a buyer", async () => {
      prisma.organisation.findUnique.mockResolvedValue(mockBuyerOrg);

      const result = await service.getStatus("org-buyer-1");

      expect(result.type).toBe("BUYER");
      expect((result.steps as any).kyb).toBeDefined();
      expect((result.steps as any).paymentMethod).toBeDefined();
      expect((result.steps as any).identity).toBeDefined();
    });

    it("should throw NotFoundException for unknown org", async () => {
      prisma.organisation.findUnique.mockResolvedValue(null);

      await expect(service.getStatus("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("buyerKyb", () => {
    it("should complete KYB verification when provider approves", async () => {
      prisma.organisation.findUnique.mockResolvedValue(mockBuyerOrg);
      kybService.verify.mockResolvedValue({
        verified: true,
        provider: "MOCK",
        registrationNo: "1010123456",
        verifiedAt: new Date(),
      });
      prisma.organisation.update.mockResolvedValue({
        ...mockBuyerOrg,
        onboardingStatus: "KYB_VERIFIED",
        kybProvider: "MOCK",
      });

      const result = await service.buyerKyb("org-buyer-1", {
        registrationNo: "1010123456",
        authorizedSignatory: "Ahmed",
      });

      expect(result.verified).toBe(true);
      expect(result.onboardingStatus).toBe("KYB_VERIFIED");
      expect(kybService.verify).toHaveBeenCalledWith(
        "1010123456",
        "KSA",
        expect.objectContaining({ authorizedSignatory: "Ahmed" }),
      );
    });

    it("should handle KYB failure", async () => {
      prisma.organisation.findUnique.mockResolvedValue(mockBuyerOrg);
      kybService.verify.mockResolvedValue({
        verified: false,
        provider: "MOCK",
        registrationNo: "FAIL999",
        verifiedAt: new Date(),
        errorMessage: "Verification failed",
      });
      prisma.organisation.update.mockResolvedValue({
        ...mockBuyerOrg,
        onboardingStatus: "KYB_FAILED",
      });

      const result = await service.buyerKyb("org-buyer-1", {
        registrationNo: "FAIL999",
        authorizedSignatory: "Bad Actor",
      });

      expect(result.verified).toBe(false);
      expect(result.onboardingStatus).toBe("KYB_FAILED");
    });

    it("should reject non-buyer org", async () => {
      prisma.organisation.findUnique.mockResolvedValue(mockSupplierOrg);

      await expect(
        service.buyerKyb("org-sup-1", {
          registrationNo: "123",
          authorizedSignatory: "Test",
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("supplierTier1", () => {
    it("should complete Tier 1 onboarding", async () => {
      prisma.organisation.findUnique.mockResolvedValue(mockSupplierOrg);
      prisma.organisation.update.mockResolvedValue({
        ...mockSupplierOrg,
        supplierTier: "BASIC",
        onboardingStatus: "COMPLETED",
      });

      const result = await service.supplierTier1("org-sup-1", {
        registrationNo: "1010654321",
        bankIban: "SA0380000000608010167520",
        termsAccepted: true,
      });

      expect(result.supplierTier).toBe("BASIC");
      expect(result.onboardingStatus).toBe("COMPLETED");
    });

    it("should reject without terms acceptance", async () => {
      prisma.organisation.findUnique.mockResolvedValue(mockSupplierOrg);

      await expect(
        service.supplierTier1("org-sup-1", {
          registrationNo: "123",
          bankIban: "SA123",
          termsAccepted: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("supplierTier2", () => {
    it("should upgrade to Tier 2 when KYB + sanctions pass", async () => {
      const tier1Supplier = {
        ...mockSupplierOrg,
        supplierTier: "BASIC",
        registrationNo: "1010654321",
      };
      prisma.organisation.findUnique.mockResolvedValue(tier1Supplier);
      kybService.verify.mockResolvedValue({
        verified: true,
        provider: "MOCK",
        registrationNo: "1010654321",
        verifiedAt: new Date(),
      });
      kybService.checkSanctions.mockResolvedValue({ clean: true });
      prisma.organisation.update.mockResolvedValue({
        ...tier1Supplier,
        supplierTier: "LIQUIDITY_ELIGIBLE",
        onboardingStatus: "COMPLETED",
      });

      const result = await service.supplierTier2("org-sup-1", {
        uboDisclosure: { fullName: "Ahmed", ownershipPct: 51 },
      });

      expect(result.supplierTier).toBe("LIQUIDITY_ELIGIBLE");
      expect(result.kybVerified).toBe(true);
      expect(result.sanctionsClean).toBe(true);
    });

    it("should reject if Tier 1 not completed", async () => {
      prisma.organisation.findUnique.mockResolvedValue(mockSupplierOrg); // no supplierTier

      await expect(service.supplierTier2("org-sup-1", {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("lpOnboarding", () => {
    it("should complete LP onboarding", async () => {
      prisma.organisation.findUnique.mockResolvedValue(mockLpOrg);
      prisma.organisation.update.mockResolvedValue({
        ...mockLpOrg,
        fundingAccountRef: "SA038000000060801",
        fundingLimitTotal: 5000000_00,
        onboardingStatus: "COMPLETED",
      });

      const result = await service.lpOnboarding("org-lp-1", {
        fundingAccountRef: "SA038000000060801",
        fundingLimitTotal: 5000000_00,
        participationAgreementAccepted: true,
      });

      expect(result.fundingAccountRef).toBe("SA038000000060801");
      expect(result.onboardingStatus).toBe("COMPLETED");
    });

    it("should reject without participation agreement", async () => {
      prisma.organisation.findUnique.mockResolvedValue(mockLpOrg);

      await expect(
        service.lpOnboarding("org-lp-1", {
          fundingAccountRef: "SA123",
          fundingLimitTotal: 1000000,
          participationAgreementAccepted: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
