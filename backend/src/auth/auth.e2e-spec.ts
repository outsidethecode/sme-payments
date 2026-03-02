import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // Clean up any stale test data from previous runs
    const testEmails = ["e2e-test-uk@example.co.uk", "e2e-test-ksa@example.sa"];
    for (const email of testEmails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        // Track the specific org IDs this user belongs to before deleting
        const membership = await prisma.orgMembership.findUnique({
          where: { userId: user.id },
        });
        await prisma.orgMembership.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        // Only delete the specific org this test user was linked to (if now orphaned)
        if (membership) {
          const orgStillHasMembers = await prisma.orgMembership.count({
            where: { organisationId: membership.organisationId },
          });
          if (orgStillHasMembers === 0) {
            await prisma.policyRule.deleteMany({
              where: { organisationId: membership.organisationId },
            });
            await prisma.approvalRequest.deleteMany({
              where: { organisationId: membership.organisationId },
            });
            await prisma.organisation.delete({
              where: { id: membership.organisationId },
            });
          }
        }
      }
    }
  });

  afterAll(async () => {
    // Clean up test users created during registration tests
    const testEmails = ["e2e-test-uk@example.co.uk", "e2e-test-ksa@example.sa"];
    for (const email of testEmails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const membership = await prisma.orgMembership.findUnique({
          where: { userId: user.id },
        });
        await prisma.orgMembership.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        // Only delete the specific org this test user was linked to (if now orphaned)
        if (membership) {
          const orgStillHasMembers = await prisma.orgMembership.count({
            where: { organisationId: membership.organisationId },
          });
          if (orgStillHasMembers === 0) {
            await prisma.policyRule.deleteMany({
              where: { organisationId: membership.organisationId },
            });
            await prisma.approvalRequest.deleteMany({
              where: { organisationId: membership.organisationId },
            });
            await prisma.organisation.delete({
              where: { id: membership.organisationId },
            });
          }
        }
      }
    }
    await app.close();
  });

  describe("POST /api/auth/login", () => {
    it("should login UK buyer and return org info", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "buyer@acme.co.uk", password: "password123" })
        .expect(201);

      expect(res.body).toHaveProperty("accessToken");
      expect(res.body.user).toMatchObject({
        email: "buyer@acme.co.uk",
        role: "BUYER",
        jurisdiction: "UK",
        currency: "GBP",
      });
      expect(res.body.user.organisationId).toBeDefined();
    });

    it("should login KSA supplier and return KSA/SAR info", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "supplier@noorsupply.sa", password: "password123" })
        .expect(201);

      expect(res.body.user).toMatchObject({
        email: "supplier@noorsupply.sa",
        role: "SUPPLIER",
        jurisdiction: "KSA",
        currency: "SAR",
      });
    });

    it("should login admin without org info", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "admin@platform.co.uk", password: "password123" })
        .expect(201);

      expect(res.body.user.role).toBe("ADMIN");
      // Admin has no organisation
      expect(res.body.user.organisationId).toBeUndefined();
    });

    it("should reject invalid credentials", async () => {
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "buyer@acme.co.uk", password: "wrongpassword" })
        .expect(401);
    });
  });

  describe("POST /api/auth/register", () => {
    it("should register a UK buyer with organisation", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: "e2e-test-uk@example.co.uk",
          password: "securepassword123",
          name: "E2E Test UK",
          companyName: "E2E Test Corp Ltd",
          role: "BUYER",
          jurisdiction: "UK",
          currency: "GBP",
        })
        .expect(201);

      expect(res.body).toHaveProperty("accessToken");
      expect(res.body.user).toMatchObject({
        email: "e2e-test-uk@example.co.uk",
        role: "BUYER",
        jurisdiction: "UK",
        currency: "GBP",
      });
      expect(res.body.user.organisationId).toBeDefined();
    });

    it("should register a KSA supplier with SAR", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: "e2e-test-ksa@example.sa",
          password: "securepassword123",
          name: "E2E Test KSA",
          companyName: "E2E Test KSA Co",
          role: "SUPPLIER",
          jurisdiction: "KSA",
          currency: "SAR",
        })
        .expect(201);

      expect(res.body.user).toMatchObject({
        email: "e2e-test-ksa@example.sa",
        role: "SUPPLIER",
        jurisdiction: "KSA",
        currency: "SAR",
      });
    });

    it("should reject duplicate email", async () => {
      await request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: "buyer@acme.co.uk",
          password: "password123",
          name: "Dup User",
          companyName: "Dup Corp",
          role: "BUYER",
        })
        .expect(409);
    });
  });

  describe("GET /api/auth/me", () => {
    it("should return current user with org info", async () => {
      // Login first
      const loginRes = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "buyer@acme.co.uk", password: "password123" })
        .expect(201);

      const token = loginRes.body.accessToken;

      const meRes = await request(app.getHttpServer())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(meRes.body).toMatchObject({
        email: "buyer@acme.co.uk",
        role: "BUYER",
        jurisdiction: "UK",
        currency: "GBP",
      });
      expect(meRes.body.organisationId).toBeDefined();
    });

    it("should return 401 without token", async () => {
      await request(app.getHttpServer()).get("/api/auth/me").expect(401);
    });
  });
});
