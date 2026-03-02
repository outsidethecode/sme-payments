import { Test, TestingModule } from "@nestjs/testing";
import { OrganisationsService } from "./organisations.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import {
  OrgType,
  OrgRole,
  Jurisdiction,
  Currency,
  OrgStatus,
} from "@prisma/client";

describe("OrganisationsService", () => {
  let service: OrganisationsService;
  let prisma: Record<string, any>;

  const mockOrg = {
    id: "org-1",
    name: "Test Corp",
    type: OrgType.BUYER,
    registrationNo: "12345",
    jurisdiction: Jurisdiction.UK,
    currency: Currency.GBP,
    shariaCompliant: false,
    status: OrgStatus.ACTIVE,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMembership = {
    id: "mem-1",
    userId: "user-1",
    organisationId: "org-1",
    orgRole: OrgRole.OWNER,
    isDefault: true,
    joinedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      organisation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      orgMembership: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((fn) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganisationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<OrganisationsService>(OrganisationsService);
  });

  describe("create", () => {
    it("should create a UK org with GBP by default", async () => {
      prisma.organisation.create.mockResolvedValue(mockOrg);

      const result = await service.create({
        name: "Test Corp",
        type: OrgType.BUYER,
        registrationNo: "12345",
      });

      expect(prisma.organisation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Test Corp",
          type: OrgType.BUYER,
          jurisdiction: Jurisdiction.UK,
          currency: Currency.GBP,
          shariaCompliant: false,
        }),
      });
      expect(result).toEqual(mockOrg);
    });

    it("should create a KSA org with SAR and sharia-compliant defaults", async () => {
      const ksaOrg = {
        ...mockOrg,
        jurisdiction: Jurisdiction.KSA,
        currency: Currency.SAR,
        shariaCompliant: true,
      };
      prisma.organisation.create.mockResolvedValue(ksaOrg);

      await service.create({
        name: "KSA Corp",
        type: OrgType.BUYER,
        jurisdiction: Jurisdiction.KSA,
      });

      expect(prisma.organisation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jurisdiction: Jurisdiction.KSA,
          currency: Currency.SAR,
          shariaCompliant: true,
        }),
      });
    });

    it("should allow explicit currency override", async () => {
      prisma.organisation.create.mockResolvedValue(mockOrg);

      await service.create({
        name: "GBP in KSA",
        type: OrgType.BUYER,
        jurisdiction: Jurisdiction.KSA,
        currency: Currency.GBP,
      });

      expect(prisma.organisation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jurisdiction: Jurisdiction.KSA,
          currency: Currency.GBP,
        }),
      });
    });
  });

  describe("findById", () => {
    it("should return org with members", async () => {
      prisma.organisation.findUnique.mockResolvedValue({
        ...mockOrg,
        members: [],
      });

      const result = await service.findById("org-1");
      expect(result.id).toBe("org-1");
    });

    it("should throw NotFoundException if not found", async () => {
      prisma.organisation.findUnique.mockResolvedValue(null);

      await expect(service.findById("no-such-org")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("addMember", () => {
    it("should add a member to an org", async () => {
      prisma.orgMembership.findUnique.mockResolvedValue(null);
      prisma.orgMembership.create.mockResolvedValue({
        ...mockMembership,
        user: {
          id: "user-1",
          email: "test@test.com",
          name: "Test",
          role: "BUYER",
        },
        organisation: { id: "org-1", name: "Test Corp", type: "BUYER" },
      });

      const result = await service.addMember("org-1", {
        userId: "user-1",
        orgRole: OrgRole.MEMBER,
      });
      expect(result.userId).toBe("user-1");
    });

    it("should throw ConflictException if user already in an org", async () => {
      prisma.orgMembership.findUnique.mockResolvedValue(mockMembership);

      await expect(
        service.addMember("org-2", { userId: "user-1" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("removeMember", () => {
    it("should remove a non-owner member", async () => {
      const memberMembership = { ...mockMembership, orgRole: OrgRole.MEMBER };
      prisma.orgMembership.findFirst.mockResolvedValue(memberMembership);
      prisma.orgMembership.delete.mockResolvedValue(memberMembership);

      await service.removeMember("org-1", "user-1");
      expect(prisma.orgMembership.delete).toHaveBeenCalledWith({
        where: { id: "mem-1" },
      });
    });

    it("should throw NotFoundException if membership not found", async () => {
      prisma.orgMembership.findFirst.mockResolvedValue(null);

      await expect(service.removeMember("org-1", "user-99")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when removing last owner", async () => {
      prisma.orgMembership.findFirst.mockResolvedValue(mockMembership); // OWNER
      prisma.orgMembership.count.mockResolvedValue(1); // only 1 owner

      await expect(service.removeMember("org-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should allow removing an owner if another owner exists", async () => {
      prisma.orgMembership.findFirst.mockResolvedValue(mockMembership);
      prisma.orgMembership.count.mockResolvedValue(2);
      prisma.orgMembership.delete.mockResolvedValue(mockMembership);

      await service.removeMember("org-1", "user-1");
      expect(prisma.orgMembership.delete).toHaveBeenCalled();
    });
  });

  describe("getOrgByUserId", () => {
    it("should return org with orgRole for user", async () => {
      prisma.orgMembership.findUnique.mockResolvedValue({
        ...mockMembership,
        organisation: mockOrg,
      });

      const result = await service.getOrgByUserId("user-1");
      expect(result).toMatchObject({
        id: "org-1",
        name: "Test Corp",
        orgRole: OrgRole.OWNER,
      });
    });

    it("should return null if user has no org", async () => {
      prisma.orgMembership.findUnique.mockResolvedValue(null);

      const result = await service.getOrgByUserId("user-99");
      expect(result).toBeNull();
    });
  });

  describe("createWithOwner", () => {
    it("should create org and membership in a transaction", async () => {
      prisma.organisation.create.mockResolvedValue(mockOrg);
      prisma.orgMembership.create.mockResolvedValue(mockMembership);

      const result = await service.createWithOwner(
        { name: "Test Corp", type: OrgType.BUYER },
        "user-1",
      );

      expect(result).toHaveProperty("organisation");
      expect(result).toHaveProperty("membership");
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
