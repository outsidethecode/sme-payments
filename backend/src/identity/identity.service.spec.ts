import { Test, TestingModule } from "@nestjs/testing";
import { IdentityService } from "./identity.service";
import { IDENTITY_PROVIDER } from "./identity-provider.interface";
import { MockIdentityProvider } from "./mock-identity.provider";
import { PrismaService } from "../prisma/prisma.service";
import { BadRequestException, ConflictException } from "@nestjs/common";

describe("IdentityService", () => {
  let service: IdentityService;
  let mockProvider: MockIdentityProvider;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        {
          provide: IDENTITY_PROVIDER,
          useClass: MockIdentityProvider,
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<IdentityService>(IdentityService);
    mockProvider = module.get<MockIdentityProvider>(IDENTITY_PROVIDER);
  });

  describe("initiate", () => {
    it("should initiate verification for unverified user", async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ identityVerifiedAt: null }) // user check
        .mockResolvedValueOnce(null); // duplicate check

      const result = await service.initiate("user-1", "1012345678");

      expect(result.transactionId).toBeDefined();
      expect(result.random).toBeDefined();
      expect(result.provider).toBe("MOCK");
    });

    it("should reject if user already verified", async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        identityVerifiedAt: new Date(),
      });

      await expect(service.initiate("user-1", "1012345678")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should reject duplicate national ID", async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ identityVerifiedAt: null }) // user check
        .mockResolvedValueOnce({ id: "other-user" }); // duplicate exists

      await expect(service.initiate("user-1", "1012345678")).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("checkStatus", () => {
    it("should return WAITING if too early", async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        identityVerifiedAt: null,
      });
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const initResult = await service.initiate("user-1", "1012345678");

      // Immediately check — should not be verified yet (2s delay in mock)
      const status = await service.checkStatus(
        "user-1",
        initResult.transactionId,
        "1012345678",
      );

      expect(status.verified).toBe(false);
      expect(status.errorMessage).toContain("WAITING");
    });

    it("should verify after delay and persist to user", async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        identityVerifiedAt: null,
      });
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValueOnce({});

      const initResult = await service.initiate("user-1", "1012345678");

      // Wait for mock delay
      await new Promise((r) => setTimeout(r, 2100));

      const status = await service.checkStatus(
        "user-1",
        initResult.transactionId,
        "1012345678",
      );

      expect(status.verified).toBe(true);
      expect(status.provider).toBe("MOCK");
      expect(status.nationalIdMasked).toBe("10******78");
      expect(status.fullNameEn).toContain("Verified Person");

      // Should have persisted to DB
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: expect.objectContaining({
          identityProvider: "MOCK",
          identityVerifiedAt: expect.any(Date),
          identityVerifiedName: expect.any(String),
          nationalIdHash: expect.any(String),
        }),
      });
    });

    it("should return failure for FAIL-prefixed national ID", async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        identityVerifiedAt: null,
      });
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const initResult = await service.initiate("user-1", "FAIL123456");

      await new Promise((r) => setTimeout(r, 2100));

      const status = await service.checkStatus(
        "user-1",
        initResult.transactionId,
        "FAIL123456",
      );

      expect(status.verified).toBe(false);
      expect(status.errorMessage).toContain("flagged");
    });
  });

  describe("getVerificationStatus", () => {
    it("should return verified status", async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        identityProvider: "MOCK",
        identityVerifiedAt: new Date("2025-01-15"),
        identityVerifiedName: "Mohammed Al-Rashidi",
      });

      const result = await service.getVerificationStatus("user-1");

      expect(result.verified).toBe(true);
      expect(result.provider).toBe("MOCK");
      expect(result.verifiedName).toBe("Mohammed Al-Rashidi");
    });

    it("should return not-verified status", async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        identityProvider: null,
        identityVerifiedAt: null,
        identityVerifiedName: null,
      });

      const result = await service.getVerificationStatus("user-1");

      expect(result.verified).toBe(false);
      expect(result.provider).toBeNull();
    });
  });
});
