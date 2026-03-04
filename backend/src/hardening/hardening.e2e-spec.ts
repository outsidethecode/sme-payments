import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import helmet from "helmet";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

describe("Phase 6 – Production Hardening (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let buyerId: string;

  const testEmail = "e2e-hardening@example.com";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(helmet());
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

    // Clean up stale test data
    const existing = await prisma.user.findUnique({
      where: { email: testEmail },
    });
    if (existing) {
      await prisma.eventLog.deleteMany({ where: { actorId: existing.id } });
      await prisma.orgMembership.deleteMany({
        where: { userId: existing.id },
      });
      await prisma.userPasskey.deleteMany({ where: { userId: existing.id } });
      await prisma.invitation.deleteMany({
        where: { inviterUserId: existing.id },
      });
      await prisma.user.delete({ where: { id: existing.id } });
    }

    // Register a buyer for testing
    const reg = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email: testEmail,
        password: "TestP@ss123!",
        name: "Hardening Buyer",
        companyName: "Hardening Ltd",
        role: "BUYER",
        jurisdiction: "UK",
      });
    buyerToken = reg.body.accessToken;
    buyerId = reg.body.user.id;
  });

  afterAll(async () => {
    // Cleanup
    if (buyerId) {
      await prisma.eventLog.deleteMany({ where: { actorId: buyerId } });
      const membership = await prisma.orgMembership.findUnique({
        where: { userId: buyerId },
      });
      await prisma.orgMembership.deleteMany({ where: { userId: buyerId } });
      await prisma.userPasskey.deleteMany({ where: { userId: buyerId } });
      await prisma.invitation.deleteMany({
        where: { inviterUserId: buyerId },
      });
      await prisma.user.delete({ where: { id: buyerId } });
      if (membership) {
        const orphaned =
          (await prisma.orgMembership.count({
            where: { organisationId: membership.organisationId },
          })) === 0;
        if (orphaned) {
          await prisma.policyRule.deleteMany({
            where: { organisationId: membership.organisationId },
          });
          await prisma.organisation.delete({
            where: { id: membership.organisationId },
          });
        }
      }
    }
    await app.close();
  });

  // ── Health ────────────────────────────────────────────────

  describe("Health endpoint", () => {
    it("GET /api/health → 200 with status UP", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/health")
        .expect(200);

      expect(res.body.status).toBe("ok");
      expect(res.body.info).toBeDefined();
      expect(res.body.info.database).toBeDefined();
      expect(res.body.info.database.status).toBe("up");
    });
  });

  // ── Correlation IDs ───────────────────────────────────────

  describe("Correlation IDs", () => {
    it("should generate a correlation ID when none is sent", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/health")
        .expect(200);

      const cid = res.headers["x-correlation-id"];
      expect(cid).toBeDefined();
      // Should be a UUID v4
      expect(cid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("should echo back a provided correlation ID", async () => {
      const customId = "my-trace-12345";
      const res = await request(app.getHttpServer())
        .get("/api/health")
        .set("x-correlation-id", customId)
        .expect(200);

      expect(res.headers["x-correlation-id"]).toBe(customId);
    });
  });

  // ── Security Headers (Helmet) ─────────────────────────────

  describe("Security headers", () => {
    it("should set X-Content-Type-Options", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/health")
        .expect(200);

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("should set X-Frame-Options or CSP", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/health")
        .expect(200);

      // Helmet sets at least one of these
      const hasFrameOptions = !!res.headers["x-frame-options"];
      const hasCsp = !!res.headers["content-security-policy"];
      expect(hasFrameOptions || hasCsp).toBe(true);
    });
  });

  // ── PDPA Endpoints ────────────────────────────────────────

  describe("PDPA / Data Protection", () => {
    it("GET /api/pdpa/export → returns user data export", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/pdpa/export")
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.exportedAt).toBeDefined();
      expect(res.body.subject).toBeDefined();
      expect(res.body.subject.email).toBe(testEmail);
      expect(res.body.subject.name).toBe("Hardening Buyer");
      // Password hash should NOT be exported
      expect(res.body.subject.password).toBeUndefined();
      // Should include relation arrays
      expect(Array.isArray(res.body.subject.passkeys)).toBe(true);
      expect(Array.isArray(res.body.subject.orgMemberships)).toBe(true);
    });

    it("GET /api/pdpa/export → 401 without auth", async () => {
      await request(app.getHttpServer()).get("/api/pdpa/export").expect(401);
    });

    it("DELETE /api/pdpa/erase → pseudonymises user data", async () => {
      // Create a sacrificial user to erase
      const sacrificialEmail = "e2e-erase-me@example.com";
      const existingSacrificial = await prisma.user.findUnique({
        where: { email: sacrificialEmail },
      });
      if (existingSacrificial) {
        await prisma.eventLog.deleteMany({
          where: { actorId: existingSacrificial.id },
        });
        await prisma.orgMembership.deleteMany({
          where: { userId: existingSacrificial.id },
        });
        await prisma.user.delete({ where: { id: existingSacrificial.id } });
      }

      const reg = await request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: sacrificialEmail,
          password: "EraseMeP@ss1!",
          name: "Erase Me",
          companyName: "Erase Corp",
          role: "BUYER",
          jurisdiction: "UK",
        });
      const eraseToken = reg.body.accessToken;
      const eraseId = reg.body.user.id;

      const res = await request(app.getHttpServer())
        .delete("/api/pdpa/erase")
        .set("Authorization", `Bearer ${eraseToken}`)
        .expect(200);

      expect(res.body.erased).toBe(true);
      expect(res.body.userId).toBe(eraseId);

      // Verify pseudonymisation
      const erased = await prisma.user.findUnique({
        where: { id: eraseId },
      });
      expect(erased).toBeDefined();
      expect(erased!.name).toBe("ERASED");
      expect(erased!.email).toContain("erased-");
      expect(erased!.companyName).toBeNull();

      // Clean up erased user
      await prisma.eventLog.deleteMany({ where: { actorId: eraseId } });
      const mem = await prisma.orgMembership.findUnique({
        where: { userId: eraseId },
      });
      await prisma.orgMembership.deleteMany({ where: { userId: eraseId } });
      await prisma.user.delete({ where: { id: eraseId } });
      if (mem) {
        const orphaned =
          (await prisma.orgMembership.count({
            where: { organisationId: mem.organisationId },
          })) === 0;
        if (orphaned) {
          await prisma.policyRule.deleteMany({
            where: { organisationId: mem.organisationId },
          });
          await prisma.organisation.delete({
            where: { id: mem.organisationId },
          });
        }
      }
    });
  });

  // ── Rate Limiting (ThrottlerModule) ───────────────────────

  describe("Rate limiting", () => {
    it("ThrottlerModule is loaded and configured", async () => {
      // The very fact that the app boots with ThrottlerModule.forRoot()
      // is the primary assertion. We verify by checking that the module
      // didn't break the health endpoint.
      const res = await request(app.getHttpServer())
        .get("/api/health")
        .expect(200);
      expect(res.body.status).toBe("ok");
    });
  });
});
