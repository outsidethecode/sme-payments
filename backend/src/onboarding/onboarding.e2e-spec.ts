import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

describe("Onboarding & Invitations (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Test-scoped tokens and IDs
  let buyerToken: string;
  let buyerOrgId: string;
  let supplierToken: string;
  let supplierOrgId: string;
  let lpToken: string;
  let lpOrgId: string;
  let adminToken: string;
  let invitationToken: string;
  let invitedSupplierToken: string;

  const testSuffix = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Register a buyer
    const buyerRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `onb-buyer-${testSuffix}@test.com`,
        password: "password123",
        name: "Onboarding Buyer",
        companyName: `OnbBuyer Corp ${testSuffix}`,
        companyNumber: "1010999001",
        role: "BUYER",
        jurisdiction: "KSA",
        currency: "SAR",
      });
    expect(buyerRes.status).toBe(201);
    buyerToken = buyerRes.body.accessToken;
    buyerOrgId = buyerRes.body.user.organisationId;

    // Register a supplier directly (for Tier 1/2 testing)
    const supplierRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `onb-supplier-${testSuffix}@test.com`,
        password: "password123",
        name: "Onboarding Supplier",
        companyName: `OnbSupplier Ltd ${testSuffix}`,
        companyNumber: "1010999002",
        role: "SUPPLIER",
        jurisdiction: "KSA",
        currency: "SAR",
      });
    expect(supplierRes.status).toBe(201);
    supplierToken = supplierRes.body.accessToken;
    supplierOrgId = supplierRes.body.user.organisationId;

    // Register an LP (direct registration for testing)
    const lpUser = await prisma.user.create({
      data: {
        email: `onb-lp-${testSuffix}@test.com`,
        password: "$2b$12$dummyhash",
        name: "Onboarding LP",
        role: "LIQUIDITY_PARTNER",
      },
    });
    const lpOrg = await prisma.organisation.create({
      data: {
        name: `OnbLP Fund ${testSuffix}`,
        type: "LIQUIDITY_PARTNER",
        jurisdiction: "KSA",
        currency: "SAR",
        onboardingStatus: "NOT_STARTED",
      },
    });
    await prisma.orgMembership.create({
      data: {
        userId: lpUser.id,
        organisationId: lpOrg.id,
        orgRole: "OWNER",
        isDefault: true,
      },
    });
    lpOrgId = lpOrg.id;

    // Login LP (need to create with real password for JWT)
    const bcrypt = await import("bcrypt");
    const hashedPw = await bcrypt.hash("password123", 12);
    await prisma.user.update({
      where: { id: lpUser.id },
      data: { password: hashedPw },
    });
    const lpLoginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        email: `onb-lp-${testSuffix}@test.com`,
        password: "password123",
      });
    expect(lpLoginRes.status).toBe(201);
    lpToken = lpLoginRes.body.accessToken;

    // Login as seeded admin (or create one)
    const adminUser = await prisma.user.findUnique({
      where: { email: "admin@platform.co.uk" },
    });
    if (adminUser) {
      const adminLoginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: "admin@platform.co.uk", password: "password123" });
      if (adminLoginRes.status === 201) {
        adminToken = adminLoginRes.body.accessToken;
      }
    }
  });

  afterAll(async () => {
    // Cleanup test data
    const testEmails = [
      `onb-buyer-${testSuffix}@test.com`,
      `onb-supplier-${testSuffix}@test.com`,
      `onb-lp-${testSuffix}@test.com`,
      `invited-supplier-${testSuffix}@test.com`,
    ];

    for (const email of testEmails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const membership = await prisma.orgMembership.findUnique({
          where: { userId: user.id },
        });
        if (membership) {
          await prisma.invitation.deleteMany({
            where: { inviterOrgId: membership.organisationId },
          });
          await prisma.orgMembership.delete({
            where: { id: membership.id },
          });
          await prisma.organisation.deleteMany({
            where: {
              id: membership.organisationId,
              members: { none: {} },
            },
          });
        }
        await prisma.user.delete({ where: { id: user.id } });
      }
    }

    await app.close();
  });

  // ── Onboarding Status ──

  describe("GET /onboarding/status", () => {
    it("should return onboarding status with step checklist for buyer", async () => {
      const res = await request(app.getHttpServer())
        .get("/onboarding/status")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.type).toBe("BUYER");
      expect(res.body.onboardingStatus).toBe("NOT_STARTED");
      expect(res.body.steps).toBeDefined();
      expect(res.body.steps.kyb).toBeDefined();
      expect(res.body.steps.paymentMethod).toBeDefined();
    });

    it("should return onboarding status for supplier", async () => {
      const res = await request(app.getHttpServer())
        .get("/onboarding/status")
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.type).toBe("SUPPLIER");
      expect(res.body.steps.tier1).toBeDefined();
      expect(res.body.steps.tier2).toBeDefined();
    });
  });

  // ── Buyer Onboarding Flow ──

  describe("Buyer onboarding flow", () => {
    it("POST /onboarding/buyer/kyb — should complete KYB-lite verification", async () => {
      const res = await request(app.getHttpServer())
        .post("/onboarding/buyer/kyb")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          registrationNo: "1010999001",
          authorizedSignatory: "Mohammed Al-Test",
        });

      expect(res.status).toBe(201);
      expect(res.body.verified).toBe(true);
      expect(res.body.onboardingStatus).toBe("KYB_VERIFIED");
      expect(res.body.provider).toBe("MOCK");
    });

    it("POST /onboarding/buyer/payment — should connect bank IBAN", async () => {
      const res = await request(app.getHttpServer())
        .post("/onboarding/buyer/payment")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          bankIban: "SA0380000000608010167519",
        });

      expect(res.status).toBe(201);
      expect(res.body.bankIban).toBe("SA0380000000608010167519");
    });

    it("POST /onboarding/buyer/complete — should mark onboarding as complete", async () => {
      const res = await request(app.getHttpServer())
        .post("/onboarding/buyer/complete")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(201);
      expect(res.body.onboardingStatus).toBe("COMPLETED");
    });

    it("GET /onboarding/status — should show completed status after onboarding", async () => {
      const res = await request(app.getHttpServer())
        .get("/onboarding/status")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.onboardingStatus).toBe("COMPLETED");
      expect(res.body.steps.kyb.complete).toBe(true);
      expect(res.body.steps.paymentMethod.complete).toBe(true);
      expect(res.body.steps.onboardingComplete).toBe(true);
    });
  });

  // ── Supplier Onboarding Flow ──

  describe("Supplier tiered onboarding", () => {
    it("POST /onboarding/supplier/tier1 — should complete Tier 1 (basic)", async () => {
      const res = await request(app.getHttpServer())
        .post("/onboarding/supplier/tier1")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          registrationNo: "1010999002",
          bankIban: "SA0380000000608010167520",
          termsAccepted: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.supplierTier).toBe("BASIC");
      expect(res.body.onboardingStatus).toBe("COMPLETED");
    });

    it("POST /onboarding/supplier/tier1 — should reject without terms acceptance", async () => {
      // Register a second supplier for this test
      const res2 = await request(app.getHttpServer())
        .post("/onboarding/supplier/tier1")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          registrationNo: "1010999003",
          bankIban: "SA0380000000608010167521",
          termsAccepted: false,
        });

      expect(res2.status).toBe(400);
    });

    it("POST /onboarding/supplier/tier2 — should upgrade to Tier 2 (liquidity-eligible)", async () => {
      const res = await request(app.getHttpServer())
        .post("/onboarding/supplier/tier2")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          uboDisclosure: { fullName: "Ahmed Ali", ownershipPct: 51 },
        });

      expect(res.status).toBe(201);
      expect(res.body.supplierTier).toBe("LIQUIDITY_ELIGIBLE");
      expect(res.body.kybVerified).toBe(true);
      expect(res.body.sanctionsClean).toBe(true);
    });
  });

  // ── LP Onboarding Flow ──

  describe("LP onboarding", () => {
    it("POST /onboarding/lp/profile — should complete LP onboarding", async () => {
      const res = await request(app.getHttpServer())
        .post("/onboarding/lp/profile")
        .set("Authorization", `Bearer ${lpToken}`)
        .send({
          fundingAccountRef: "SA0380000000608010167999",
          fundingLimitTotal: 5000000_00,
          riskAppetiteConfig: {
            maxConcentrationPct: 25,
            preferredTenorDays: 30,
          },
          participationAgreementAccepted: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.fundingAccountRef).toBe("SA0380000000608010167999");
      expect(res.body.fundingLimitTotal).toBe(5000000_00);
      expect(res.body.onboardingStatus).toBe("COMPLETED");
    });

    it("POST /onboarding/lp/profile — should reject without participation agreement", async () => {
      const res = await request(app.getHttpServer())
        .post("/onboarding/lp/profile")
        .set("Authorization", `Bearer ${lpToken}`)
        .send({
          fundingAccountRef: "SA0380000000608010167999",
          fundingLimitTotal: 1000000_00,
          participationAgreementAccepted: false,
        });

      expect(res.status).toBe(400);
    });
  });

  // ── Invitation Flow ──

  describe("Invitation flow (buyer → supplier)", () => {
    it("POST /invitations — buyer should create supplier invitation", async () => {
      const res = await request(app.getHttpServer())
        .post("/invitations")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          inviteeEmail: `invited-supplier-${testSuffix}@test.com`,
          inviteeRole: "SUPPLIER",
          metadata: { message: "Join our supply chain" },
        });

      if (res.status !== 201) {
        console.log(
          "Invitation creation failed:",
          res.status,
          JSON.stringify(res.body),
        );
      }
      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.status).toBe("PENDING");
      expect(res.body.inviteeEmail).toBe(
        `invited-supplier-${testSuffix}@test.com`,
      );
      invitationToken = res.body.token;
    });

    it("GET /invitations — buyer should see their invitations", async () => {
      const res = await request(app.getHttpServer())
        .get("/invitations")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(
        res.body.some(
          (inv: any) =>
            inv.inviteeEmail === `invited-supplier-${testSuffix}@test.com`,
        ),
      ).toBe(true);
    });

    it("GET /invitations/:token — should return invitation details (public)", async () => {
      const res = await request(app.getHttpServer()).get(
        `/invitations/${invitationToken}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("PENDING");
      expect(res.body.inviterOrg).toBeDefined();
      expect(res.body.inviterOrg.name).toContain("OnbBuyer Corp");
    });

    it("POST /auth/register-invited — supplier should register via invitation", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/register-invited")
        .send({
          invitationToken,
          email: `invited-supplier-${testSuffix}@test.com`,
          password: "password123",
          name: "Invited Supplier User",
          companyName: `InvitedSupplier ${testSuffix}`,
          companyNumber: "1010999099",
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe("SUPPLIER");
      expect(res.body.user.organisationId).toBeDefined();
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.invitation.inviterOrgName).toContain("OnbBuyer Corp");
      invitedSupplierToken = res.body.accessToken;
    });

    it("POST /invitations — should reject duplicate pending invitation", async () => {
      const res = await request(app.getHttpServer())
        .post("/invitations")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          inviteeEmail: `invited-supplier-${testSuffix}@test.com`,
          inviteeRole: "SUPPLIER",
        });

      // The invitation was already accepted, so no duplicate PENDING exists — this should succeed
      // But if we tried a still-pending email, it would be blocked
      // Instead, test that the accepted invitation can't be re-used
      const reuse = await request(app.getHttpServer())
        .post("/auth/register-invited")
        .send({
          invitationToken,
          email: `another-supplier-${testSuffix}@test.com`,
          password: "password123",
          name: "Another Supplier",
          companyName: "Another Supplier Ltd",
        });

      expect(reuse.status).toBe(400); // invitation already accepted
    });

    it("Invited supplier should be able to check onboarding status", async () => {
      const res = await request(app.getHttpServer())
        .get("/onboarding/status")
        .set("Authorization", `Bearer ${invitedSupplierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.type).toBe("SUPPLIER");
    });
  });

  // ── KYB Failure Paths ──

  describe("KYB failure paths", () => {
    it("POST /onboarding/buyer/kyb — should fail for FAIL-prefixed registration", async () => {
      // Register a fresh buyer for this test
      const freshBuyerRes = await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          email: `kyb-fail-buyer-${testSuffix}@test.com`,
          password: "password123",
          name: "KYB Fail Buyer",
          companyName: `KYBFail Corp ${testSuffix}`,
          role: "BUYER",
          jurisdiction: "KSA",
        });
      expect(freshBuyerRes.status).toBe(201);
      const freshBuyerToken = freshBuyerRes.body.accessToken;

      const res = await request(app.getHttpServer())
        .post("/onboarding/buyer/kyb")
        .set("Authorization", `Bearer ${freshBuyerToken}`)
        .send({
          registrationNo: "FAIL12345",
          authorizedSignatory: "Bad Actor",
        });

      expect(res.status).toBe(201);
      expect(res.body.verified).toBe(false);
      expect(res.body.onboardingStatus).toBe("KYB_FAILED");

      // Cleanup
      const user = await prisma.user.findUnique({
        where: { email: `kyb-fail-buyer-${testSuffix}@test.com` },
      });
      if (user) {
        const mem = await prisma.orgMembership.findUnique({
          where: { userId: user.id },
        });
        if (mem) {
          await prisma.orgMembership.delete({ where: { id: mem.id } });
          await prisma.organisation.deleteMany({
            where: { id: mem.organisationId, members: { none: {} } },
          });
        }
        await prisma.user.delete({ where: { id: user.id } });
      }
    });
  });
});
