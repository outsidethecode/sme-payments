import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

describe("Organisations (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let adminToken: string;
  let buyerOrgId: string;

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

    // Login as seeded buyer
    const buyerRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "buyer@acme.co.uk", password: "password123" })
      .expect(201);

    buyerToken = buyerRes.body.accessToken;
    buyerOrgId = buyerRes.body.user.organisationId;

    // Login as admin
    const adminRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@platform.co.uk", password: "password123" })
      .expect(201);

    adminToken = adminRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/organisations/me", () => {
    it("should return the current user's organisation", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/organisations/me")
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("id", buyerOrgId);
      expect(res.body).toHaveProperty("name", "Acme Retail Ltd");
      expect(res.body).toHaveProperty("jurisdiction", "UK");
      expect(res.body).toHaveProperty("currency", "GBP");
      expect(res.body).toHaveProperty("type", "BUYER");
    });

    it("should return 401 without a token", async () => {
      await request(app.getHttpServer())
        .get("/api/organisations/me")
        .expect(401);
    });
  });

  describe("GET /api/organisations", () => {
    it("should list all organisations for admin", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/organisations")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // Should have at least the 8 seeded orgs (5 UK + 3 KSA)
      expect(res.body.length).toBeGreaterThanOrEqual(8);
    });

    it("should return 403 for non-admin", async () => {
      await request(app.getHttpServer())
        .get("/api/organisations")
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(403);
    });
  });

  describe("GET /api/organisations/:id", () => {
    it("should return organisation by id", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/organisations/${buyerOrgId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.id).toBe(buyerOrgId);
      expect(res.body.name).toBe("Acme Retail Ltd");
    });
  });

  describe("GET /api/organisations/:id/members", () => {
    it("should list members of own organisation", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/organisations/${buyerOrgId}/members`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty("orgRole", "OWNER");
      expect(res.body[0].user).toHaveProperty("email", "buyer@acme.co.uk");
    });
  });

  describe("KSA organisation", () => {
    let ksaToken: string;
    let ksaOrgId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "buyer@alrajhi.sa", password: "password123" })
        .expect(201);

      ksaToken = res.body.accessToken;
      ksaOrgId = res.body.user.organisationId;
    });

    it("should return KSA jurisdiction and SAR currency", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/organisations/me")
        .set("Authorization", `Bearer ${ksaToken}`)
        .expect(200);

      expect(res.body.id).toBe(ksaOrgId);
      expect(res.body.jurisdiction).toBe("KSA");
      expect(res.body.currency).toBe("SAR");
      expect(res.body.shariaCompliant).toBe(true);
      expect(res.body.name).toBe("Al-Rajhi Trading Co");
    });
  });
});
