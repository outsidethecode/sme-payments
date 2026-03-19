import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "./auth.service";
import { UsersService } from "../users/users.service";
import { OrganisationsService } from "../organisations/organisations.service";
import { InvitationsService } from "../invitations/invitations.service";
import { PolicyTemplateService } from "../policies/policy-template.service";
import { JwtService } from "@nestjs/jwt";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcrypt";

jest.mock("bcrypt");

describe("AuthService", () => {
  let service: AuthService;
  let usersService: Record<string, jest.Mock>;
  let orgsService: Record<string, jest.Mock>;
  let invitationsService: Record<string, jest.Mock>;
  let jwtService: Record<string, jest.Mock>;
  let policyTemplateService: Record<string, jest.Mock>;

  const mockUser = {
    id: "user-1",
    email: "buyer@test.com",
    password: "$2b$12$hashedpassword",
    name: "Test Buyer",
    role: "BUYER",
    companyName: "Test Corp",
    companyNumber: "12345",
    balance: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockOrg = {
    id: "org-1",
    name: "Test Corp",
    type: "BUYER",
    jurisdiction: "UK",
    currency: "GBP",
    shariaCompliant: false,
    status: "ACTIVE",
  };

  const mockMembership = {
    id: "mem-1",
    userId: "user-1",
    organisationId: "org-1",
    orgRole: "OWNER",
  };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };

    orgsService = {
      createWithOwner: jest.fn(),
      getOrgByUserId: jest.fn(),
    };

    invitationsService = {
      findByToken: jest.fn(),
      accept: jest.fn(),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue("mock-jwt-token"),
    };

    policyTemplateService = {
      seedDefaultPolicies: jest
        .fn()
        .mockResolvedValue({ created: 0, skipped: 0, rules: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: OrganisationsService, useValue: orgsService },
        { provide: InvitationsService, useValue: invitationsService },
        { provide: JwtService, useValue: jwtService },
        { provide: PolicyTemplateService, useValue: policyTemplateService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe("register", () => {
    it("should register a buyer with organisation", async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser);
      orgsService.createWithOwner.mockResolvedValue({
        organisation: mockOrg,
        membership: mockMembership,
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2b$12$hashedpassword");

      const result = await service.register({
        email: "buyer@test.com",
        password: "password123",
        name: "Test Buyer",
        companyName: "Test Corp",
        companyNumber: "12345",
        role: "BUYER",
      });

      expect(result.user.email).toBe("buyer@test.com");
      expect(result.user.organisationId).toBe("org-1");
      expect(result.accessToken).toBe("mock-jwt-token");
      expect(orgsService.createWithOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Test Corp",
          type: "BUYER",
          registrationNo: "12345",
        }),
        "user-1",
      );
    });

    it("should register a KSA supplier with SAR", async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({ ...mockUser, role: "SUPPLIER" });
      orgsService.createWithOwner.mockResolvedValue({
        organisation: {
          ...mockOrg,
          jurisdiction: "KSA",
          currency: "SAR",
          shariaCompliant: true,
        },
        membership: mockMembership,
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2b$12$hashedpassword");

      const result = await service.register({
        email: "supplier@test.sa",
        password: "password123",
        name: "Test Supplier",
        companyName: "KSA Supply Co",
        role: "SUPPLIER",
        jurisdiction: "KSA",
      });

      expect(result.user.jurisdiction).toBe("KSA");
      expect(result.user.currency).toBe("SAR");
      expect(orgsService.createWithOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SUPPLIER",
          jurisdiction: "KSA",
        }),
        expect.any(String),
      );
    });

    it("should throw ConflictException if email exists", async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.register({
          email: "buyer@test.com",
          password: "password123",
          name: "Test",
          companyName: "Corp",
          role: "BUYER",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("should include organisationId in JWT", async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser);
      orgsService.createWithOwner.mockResolvedValue({
        organisation: mockOrg,
        membership: mockMembership,
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2b$12$hashedpassword");

      await service.register({
        email: "buyer@test.com",
        password: "password123",
        name: "Test",
        companyName: "Corp",
        role: "BUYER",
      });

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: "user-1",
          organisationId: "org-1",
        }),
      );
    });
  });

  describe("login", () => {
    it("should login and return org info", async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);
      orgsService.getOrgByUserId.mockResolvedValue({
        ...mockOrg,
        orgRole: "OWNER",
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login("buyer@test.com", "password123");

      expect(result.user.organisationId).toBe("org-1");
      expect(result.user.orgRole).toBe("OWNER");
      expect(result.user.jurisdiction).toBe("UK");
      expect(result.user.currency).toBe("GBP");
      expect(result.accessToken).toBe("mock-jwt-token");
    });

    it("should login user without org (admin)", async () => {
      const adminUser = { ...mockUser, role: "ADMIN" };
      usersService.findByEmail.mockResolvedValue(adminUser);
      orgsService.getOrgByUserId.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login("admin@platform.co.uk", "password123");

      expect(result.user.organisationId).toBeUndefined();
    });

    it("should throw on invalid email", async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login("bad@email.com", "password123"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should throw on wrong password", async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login("buyer@test.com", "wrongpassword"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
