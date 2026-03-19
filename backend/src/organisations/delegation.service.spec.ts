import { Test, TestingModule } from "@nestjs/testing";
import { DelegationService, CreateDelegationInput } from "./delegation.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";

describe("DelegationService", () => {
  let service: DelegationService;
  let prisma: Record<string, any>;
  let ledger: Record<string, any>;

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const ownerMembership = {
    id: "mem-1",
    userId: "owner-1",
    organisationId: "org-1",
    orgRole: "OWNER",
  };
  const memberMembership = {
    id: "mem-2",
    userId: "member-1",
    organisationId: "org-1",
    orgRole: "MEMBER",
  };

  beforeEach(async () => {
    prisma = {
      orgMembership: {
        findFirst: jest.fn(),
      },
      orgDelegation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    ledger = {
      logEvent: jest.fn().mockResolvedValue({ id: "evt-1" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DelegationService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledger },
      ],
    }).compile();

    service = module.get<DelegationService>(DelegationService);
  });

  describe("delegate", () => {
    const baseInput: CreateDelegationInput = {
      organisationId: "org-1",
      delegatorUserId: "owner-1",
      delegateUserId: "member-1",
      actions: ["PO_APPROVAL", "ESCROW_FUNDING"],
      validTo: in7Days,
    };

    it("should create a delegation for valid OWNER→member", async () => {
      prisma.orgMembership.findFirst
        .mockResolvedValueOnce(ownerMembership) // delegator
        .mockResolvedValueOnce(memberMembership); // delegate

      const created = {
        id: "del-1",
        ...baseInput,
        validFrom: now,
        active: true,
        delegator: { id: "owner-1", name: "Owner", email: "o@test.com" },
        delegate: { id: "member-1", name: "Member", email: "m@test.com" },
      };
      prisma.orgDelegation.create.mockResolvedValue(created);

      const result = await service.delegate(baseInput);

      expect(result.id).toBe("del-1");
      expect(prisma.orgDelegation.create).toHaveBeenCalledTimes(1);
      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "DELEGATION_CREATED" }),
      );
    });

    it("should reject if delegator is not in org", async () => {
      prisma.orgMembership.findFirst
        .mockResolvedValueOnce(null) // delegator not found
        .mockResolvedValueOnce(memberMembership);

      await expect(service.delegate(baseInput)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should reject if delegate is not in org", async () => {
      prisma.orgMembership.findFirst
        .mockResolvedValueOnce(ownerMembership)
        .mockResolvedValueOnce(null); // delegate not found

      await expect(service.delegate(baseInput)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should reject if delegator is not OWNER", async () => {
      prisma.orgMembership.findFirst
        .mockResolvedValueOnce(memberMembership) // non-owner delegator
        .mockResolvedValueOnce(memberMembership);

      await expect(service.delegate(baseInput)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should reject self-delegation", async () => {
      prisma.orgMembership.findFirst
        .mockResolvedValueOnce(ownerMembership)
        .mockResolvedValueOnce(ownerMembership);

      await expect(
        service.delegate({ ...baseInput, delegateUserId: "owner-1" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject if duration exceeds 30 days", async () => {
      prisma.orgMembership.findFirst
        .mockResolvedValueOnce(ownerMembership)
        .mockResolvedValueOnce(memberMembership);

      await expect(
        service.delegate({ ...baseInput, validTo: in60Days }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject if validTo is before validFrom", async () => {
      prisma.orgMembership.findFirst
        .mockResolvedValueOnce(ownerMembership)
        .mockResolvedValueOnce(memberMembership);

      const pastDate = new Date(now.getTime() - 1000);
      await expect(
        service.delegate({ ...baseInput, validTo: pastDate }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject empty actions array", async () => {
      prisma.orgMembership.findFirst
        .mockResolvedValueOnce(ownerMembership)
        .mockResolvedValueOnce(memberMembership);

      await expect(
        service.delegate({ ...baseInput, actions: [] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("revoke", () => {
    const mockDelegation = {
      id: "del-1",
      organisationId: "org-1",
      delegatorUserId: "owner-1",
      delegateUserId: "member-1",
      active: true,
    };

    it("should revoke when called by delegator", async () => {
      prisma.orgDelegation.findUnique.mockResolvedValue(mockDelegation);
      prisma.orgDelegation.update.mockResolvedValue({
        ...mockDelegation,
        active: false,
      });

      const result = await service.revoke("del-1", "owner-1");

      expect(result.active).toBe(false);
      expect(ledger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "DELEGATION_REVOKED" }),
      );
    });

    it("should revoke when called by an OWNER", async () => {
      prisma.orgDelegation.findUnique.mockResolvedValue(mockDelegation);
      prisma.orgMembership.findFirst.mockResolvedValue({
        userId: "other-owner",
        orgRole: "OWNER",
      });
      prisma.orgDelegation.update.mockResolvedValue({
        ...mockDelegation,
        active: false,
      });

      const result = await service.revoke("del-1", "other-owner");

      expect(result.active).toBe(false);
    });

    it("should reject if not delegator and not OWNER", async () => {
      prisma.orgDelegation.findUnique.mockResolvedValue(mockDelegation);
      prisma.orgMembership.findFirst.mockResolvedValue(null); // not an owner

      await expect(service.revoke("del-1", "random-user")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should reject if delegation not found", async () => {
      prisma.orgDelegation.findUnique.mockResolvedValue(null);

      await expect(service.revoke("nonexistent", "owner-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("canActAs", () => {
    it("should return true when active delegation exists", async () => {
      prisma.orgDelegation.findFirst.mockResolvedValue({ id: "del-1" });

      const result = await service.canActAs("member-1", "org-1", "PO_APPROVAL");

      expect(result).toBe(true);
    });

    it("should return false when no delegation exists", async () => {
      prisma.orgDelegation.findFirst.mockResolvedValue(null);

      const result = await service.canActAs("member-1", "org-1", "PO_APPROVAL");

      expect(result).toBe(false);
    });
  });

  describe("getActiveDelegationsForUser", () => {
    it("should return currently-valid delegations", async () => {
      const mockDelegations = [
        {
          id: "del-1",
          actions: ["PO_APPROVAL"],
          delegator: { id: "owner-1", name: "Owner", email: "o@t.com" },
          organisation: { id: "org-1", name: "Corp" },
        },
      ];
      prisma.orgDelegation.findMany.mockResolvedValue(mockDelegations);

      const result = await service.getActiveDelegationsForUser("member-1");

      expect(result).toHaveLength(1);
      expect(prisma.orgDelegation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            delegateUserId: "member-1",
            active: true,
          }),
        }),
      );
    });
  });

  describe("getOrgDelegations", () => {
    it("should return all active delegations for an org", async () => {
      prisma.orgDelegation.findMany.mockResolvedValue([
        { id: "del-1" },
        { id: "del-2" },
      ]);

      const result = await service.getOrgDelegations("org-1");

      expect(result).toHaveLength(2);
      expect(prisma.orgDelegation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organisationId: "org-1", active: true },
        }),
      );
    });
  });
});
