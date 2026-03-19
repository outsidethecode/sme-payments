import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

/**
 * E2E: Policy Templates & Pilot Gating (Phase 9)
 *
 * Verifies:
 * - GET /policies/templates/:orgType/:jurisdiction — preview templates
 * - GET /policies/readiness/:orgId — pilot readiness checklist
 * - POST /policies/org/:orgId/seed-defaults — seed (Admin only)
 * - POST /policies/org/:orgId/reset-defaults — reset (Admin only)
 * - POST /policies/simulate — simulate rule matching
 * - Auto-seeding on registration
 */
describe("Policy Templates & Pilot Gating (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminToken: string;
  let adminId: string;
  let buyerToken: string;
  let buyerId: string;
  let buyerOrgId: string;

  const TEST_PREFIX = "pt-";

  // ── Bootstrap ─────────────────────────────────────────────

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    await cleanupTestData();

    // Register buyer (auto seeds policy templates)
    const buyerRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `${TEST_PREFIX}buyer@test.com`,
        password: "Password123!",
        name: "PT Buyer",
        companyName: "PT Buyer Ltd",
        role: "BUYER",
        jurisdiction: "UK",
      })
      .expect(201);
    buyerToken = buyerRes.body.accessToken;
    buyerId = buyerRes.body.user.id;
    buyerOrgId = buyerRes.body.user.organisationId;

    // Register admin
    const adminRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `${TEST_PREFIX}admin@test.com`,
        password: "Password123!",
        name: "PT Admin",
        companyName: "PT Admin Ltd",
        role: "BUYER",
        jurisdiction: "UK",
      })
      .expect(201);
    adminToken = adminRes.body.accessToken;
    adminId = adminRes.body.user.id;

    // Promote to ADMIN
    await prisma.user.update({
      where: { id: adminId },
      data: { role: "ADMIN" },
    });
    const adminLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        email: `${TEST_PREFIX}admin@test.com`,
        password: "Password123!",
      })
      .expect(201);
    adminToken = adminLogin.body.accessToken;

    // Allow async policy seeding to complete
    await new Promise((r) => setTimeout(r, 1500));
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  async function cleanupTestData() {
    const testUsers = await prisma.user.findMany({
      where: { email: { startsWith: TEST_PREFIX } },
    });
    const userIds = testUsers.map((u) => u.id);
    if (userIds.length === 0) return;

    const memberships = await prisma.orgMembership.findMany({
      where: { userId: { in: userIds } },
    });
    const orgIds = memberships.map((m) => m.organisationId);

    if (orgIds.length > 0) {
      await prisma.policyRule.deleteMany({
        where: { organisationId: { in: orgIds } },
      });
      await prisma.featureFlagOverride.deleteMany({
        where: { organisationId: { in: orgIds } },
      });
      await prisma.approvalRequest.deleteMany({
        where: { organisationId: { in: orgIds } },
      });
      await prisma.orgMembership.deleteMany({
        where: { organisationId: { in: orgIds } },
      });
      await prisma.organisation.deleteMany({
        where: { id: { in: orgIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }

  // ── Template Preview ──────────────────────────────────────

  describe("GET /policies/templates/:orgType/:jurisdiction", () => {
    it("should return UK BUYER templates", async () => {
      const res = await request(app.getHttpServer())
        .get("/policies/templates/BUYER/UK")
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.orgType).toBe("BUYER");
      expect(res.body.jurisdiction).toBe("UK");
      expect(res.body.count).toBe(10);
      expect(res.body.templates).toHaveLength(10);
    });

    it("should return KSA SUPPLIER templates", async () => {
      const res = await request(app.getHttpServer())
        .get("/policies/templates/SUPPLIER/KSA")
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.count).toBe(4);
    });

    it("should return empty for unknown combination", async () => {
      const res = await request(app.getHttpServer())
        .get("/policies/templates/UNKNOWN/UK")
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.count).toBe(0);
      expect(res.body.templates).toEqual([]);
    });
  });

  // ── Pilot Readiness ───────────────────────────────────────

  describe("GET /policies/readiness/:orgId", () => {
    it("should return readiness checklist", async () => {
      const res = await request(app.getHttpServer())
        .get(`/policies/readiness/${buyerOrgId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.organisationId).toBe(buyerOrgId);
      expect(res.body.checks).toBeDefined();
      expect(Array.isArray(res.body.checks)).toBe(true);
      expect(typeof res.body.readyPercentage).toBe("number");
      expect(res.body.readyPercentage).toBeGreaterThanOrEqual(0);
      expect(res.body.readyPercentage).toBeLessThanOrEqual(100);
    });

    it("should show policy_rules as complete when rules exist", async () => {
      const res = await request(app.getHttpServer())
        .get(`/policies/readiness/${buyerOrgId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const policyCheck = res.body.checks.find(
        (c: any) => c.key === "policy_rules",
      );
      expect(policyCheck).toBeDefined();
      expect(policyCheck.complete).toBe(true);
    });
  });

  // ── Seed Defaults (Admin only) ────────────────────────────

  describe("POST /policies/org/:orgId/seed-defaults", () => {
    it("should reject non-admin", async () => {
      await request(app.getHttpServer())
        .post(`/policies/org/${buyerOrgId}/seed-defaults`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(403);
    });

    it("should seed (or skip) for admin", async () => {
      const res = await request(app.getHttpServer())
        .post(`/policies/org/${buyerOrgId}/seed-defaults`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      expect(typeof res.body.created).toBe("number");
      expect(typeof res.body.skipped).toBe("number");
      // Since auto-seeding happened at registration, most should be skipped
      expect(res.body.skipped).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Reset Defaults (Admin only) ───────────────────────────

  describe("POST /policies/org/:orgId/reset-defaults", () => {
    it("should reject non-admin", async () => {
      await request(app.getHttpServer())
        .post(`/policies/org/${buyerOrgId}/reset-defaults`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(403);
    });

    it("should reset rules and re-seed", async () => {
      const res = await request(app.getHttpServer())
        .post(`/policies/org/${buyerOrgId}/reset-defaults`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body.created).toBe(10); // 10 UK buyer templates
      expect(res.body.skipped).toBe(0); // all were deactivated first
    });
  });

  // ── Policy Simulator ──────────────────────────────────────

  describe("POST /policies/simulate", () => {
    it("should match auto-approve rule for small amount", async () => {
      const res = await request(app.getHttpServer())
        .post("/policies/simulate")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ amount: 500_000, ruleType: "PO_APPROVAL" })
        .expect(201);

      expect(res.body.matched).toBe(true);
      expect(res.body.rule).toBeDefined();
      expect(res.body.rule.autoApprove).toBe(true);
    });

    it("should match 1-approver rule for medium amount", async () => {
      const res = await request(app.getHttpServer())
        .post("/policies/simulate")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ amount: 25_000_00, ruleType: "PO_APPROVAL" })
        .expect(201);

      expect(res.body.matched).toBe(true);
      expect(res.body.rule.requiredApprovals).toBe(1);
    });

    it("should match 2-approver rule for large amount", async () => {
      const res = await request(app.getHttpServer())
        .post("/policies/simulate")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ amount: 100_000_00, ruleType: "PO_APPROVAL" })
        .expect(201);

      expect(res.body.matched).toBe(true);
      expect(res.body.rule.requiredApprovals).toBe(2);
    });

    it("should return no match for non-existent rule type", async () => {
      const res = await request(app.getHttpServer())
        .post("/policies/simulate")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ amount: 1000, ruleType: "LP_FUNDING" })
        .expect(201);

      // Buyer org does not have LP_FUNDING rules
      expect(res.body.matched).toBe(false);
    });
  });

  // ── Auto-seeded Rules on Registration ─────────────────────

  describe("Auto-seeded policy rules", () => {
    it("should have auto-seeded rules for the buyer org", async () => {
      const res = await request(app.getHttpServer())
        .get(`/policies/org/${buyerOrgId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(10);
      const ruleTypes = [...new Set(res.body.map((r: any) => r.ruleType))];
      expect(ruleTypes).toContain("PO_APPROVAL");
      expect(ruleTypes).toContain("PO_ORDER_LIMITS");
      expect(ruleTypes).toContain("ESCROW_FUNDING");
      expect(ruleTypes).toContain("SETTLEMENT");
      expect(ruleTypes).toContain("DELIVERY_VERIFICATION");
    });

    it("should have correct PO approval tiers", async () => {
      const res = await request(app.getHttpServer())
        .get(`/policies/org/${buyerOrgId}?ruleType=PO_APPROVAL`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const poRules = res.body.filter((r: any) => r.ruleType === "PO_APPROVAL");
      expect(poRules.length).toBe(3);

      const autoApprove = poRules.find((r: any) => r.autoApprove);
      expect(autoApprove).toBeDefined();
      expect(autoApprove.name).toContain("£10,000");
    });
  });
});
