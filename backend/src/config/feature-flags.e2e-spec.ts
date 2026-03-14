import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { FeatureFlagService, FeatureFlag } from "./feature-flags.service";
import { PurchaseOrdersService } from "../purchase-orders/purchase-orders.service";

/**
 * E2E: Feature Flag & Pilot Gating (Phase 6)
 *
 * Verifies:
 * - Flag evaluation: default fallback, env-var, global DB override, per-org DB override
 * - Admin endpoints: GET /admin/feature-flags, PATCH /admin/feature-flags/:flag
 * - Guard behaviour: EARLY_PAYMENTS flag blocks requestEarlyPayment when disabled
 * - Unknown flag rejection
 */
describe("Feature Flag & Pilot Gating (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let flagService: FeatureFlagService;
  let poService: PurchaseOrdersService;

  let adminToken: string;
  let adminId: string;
  let supplierToken: string;
  let supplierId: string;
  let buyerToken: string;
  let buyerId: string;
  let supplierOrgId: string;
  let buyerOrgId: string;

  const TEST_PREFIX = "ff-";

  // ── Bootstrap ─────────────────────────────────────────────

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    flagService = app.get(FeatureFlagService);
    poService = app.get(PurchaseOrdersService);

    await cleanupTestData();

    // Register admin
    const adminRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `${TEST_PREFIX}admin@test.com`,
        password: "Password123!",
        name: "FF Admin",
        companyName: "FF Admin Ltd",
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

    // Re-login for updated token
    const adminLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        email: `${TEST_PREFIX}admin@test.com`,
        password: "Password123!",
      })
      .expect(201);
    adminToken = adminLogin.body.accessToken;

    // Register buyer
    const buyerRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `${TEST_PREFIX}buyer@test.com`,
        password: "Password123!",
        name: "FF Buyer",
        companyName: "FF Buyer Ltd",
        role: "BUYER",
        jurisdiction: "UK",
      })
      .expect(201);
    buyerToken = buyerRes.body.accessToken;
    buyerId = buyerRes.body.user.id;

    const buyerMembership = await prisma.orgMembership.findUnique({
      where: { userId: buyerId },
    });
    buyerOrgId = buyerMembership!.organisationId;

    // Register supplier
    const supplierRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `${TEST_PREFIX}supplier@test.com`,
        password: "Password123!",
        name: "FF Supplier",
        companyName: "FF Supplier Ltd",
        role: "SUPPLIER",
        jurisdiction: "UK",
      })
      .expect(201);
    supplierToken = supplierRes.body.accessToken;
    supplierId = supplierRes.body.user.id;

    const supplierMembership = await prisma.orgMembership.findUnique({
      where: { userId: supplierId },
    });
    supplierOrgId = supplierMembership!.organisationId;
  }, 60_000);

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  // ── Cleanup ───────────────────────────────────────────────

  async function cleanupTestData() {
    // Delete flag overrides first
    await prisma.featureFlagOverride.deleteMany({});

    const existingUsers = await prisma.user.findMany({
      where: { email: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    const userIds = existingUsers.map((u) => u.id);
    if (userIds.length === 0) return;

    const pos = await prisma.purchaseOrder.findMany({
      where: {
        OR: [{ buyerId: { in: userIds } }, { supplierId: { in: userIds } }],
      },
      select: { id: true },
    });
    const poIds = pos.map((p) => p.id);

    if (poIds.length > 0) {
      await prisma.platformFee.deleteMany({
        where: { purchaseOrderId: { in: poIds } },
      });
      await prisma.settlement.deleteMany({
        where: { purchaseOrderId: { in: poIds } },
      });
      await prisma.earlyPaymentRequest.deleteMany({
        where: { purchaseOrderId: { in: poIds } },
      });
      await prisma.paymentInstrument.deleteMany({
        where: { purchaseOrderId: { in: poIds } },
      });
      await prisma.paymentLock.deleteMany({
        where: { purchaseOrderId: { in: poIds } },
      });
      await prisma.dispute.deleteMany({
        where: { purchaseOrderId: { in: poIds } },
      });
      await prisma.evidenceAttachment.deleteMany({
        where: { purchaseOrderId: { in: poIds } },
      });
      await prisma.pORevision.deleteMany({
        where: { purchaseOrderId: { in: poIds } },
      });
      await prisma.purchaseOrder.deleteMany({
        where: { id: { in: poIds } },
      });
    }

    await prisma.eventLog.deleteMany({ where: { actorId: { in: userIds } } });

    for (const userId of userIds) {
      const membership = await prisma.orgMembership.findUnique({
        where: { userId },
      });
      await prisma.orgMembership.deleteMany({ where: { userId } });
      await prisma.userPasskey.deleteMany({ where: { userId } });
      await prisma.invitation.deleteMany({
        where: { inviterUserId: userId },
      });
      await prisma.user.delete({ where: { id: userId } });
      if (membership) {
        const remaining = await prisma.orgMembership.count({
          where: { organisationId: membership.organisationId },
        });
        if (remaining === 0) {
          await prisma.policyRule.deleteMany({
            where: { organisationId: membership.organisationId },
          });
          await prisma.approvalRequest.deleteMany({
            where: { organisationId: membership.organisationId },
          });
          await prisma.featureFlagOverride.deleteMany({
            where: { organisationId: membership.organisationId },
          });
          await prisma.organisation
            .delete({ where: { id: membership.organisationId } })
            .catch(() => {});
        }
      }
    }
  }

  // ── 6.1: Flag service — default fallback ──────────────────

  describe("6.1: Flag evaluation", () => {
    afterEach(async () => {
      // Clean all overrides between tests
      await prisma.featureFlagOverride.deleteMany({});
    });

    it("returns false for unknown/unset flags by default", async () => {
      const enabled = await flagService.isEnabled(FeatureFlag.LP_MARKETPLACE);
      expect(enabled).toBe(false);
    });

    it("global DB override takes precedence over default", async () => {
      await prisma.featureFlagOverride.create({
        data: {
          flag: FeatureFlag.LP_MARKETPLACE,
          organisationId: null,
          enabled: true,
        },
      });

      const enabled = await flagService.isEnabled(FeatureFlag.LP_MARKETPLACE);
      expect(enabled).toBe(true);
    });

    it("per-org DB override takes precedence over global override", async () => {
      // Global = OFF
      await prisma.featureFlagOverride.create({
        data: {
          flag: FeatureFlag.EARLY_PAYMENTS,
          organisationId: null,
          enabled: false,
        },
      });

      // Org-specific = ON
      await prisma.featureFlagOverride.create({
        data: {
          flag: FeatureFlag.EARLY_PAYMENTS,
          organisationId: supplierOrgId,
          enabled: true,
        },
      });

      // Without org → reads global → false
      const globalResult = await flagService.isEnabled(
        FeatureFlag.EARLY_PAYMENTS,
      );
      expect(globalResult).toBe(false);

      // With org → reads org override → true
      const orgResult = await flagService.isEnabled(
        FeatureFlag.EARLY_PAYMENTS,
        supplierOrgId,
      );
      expect(orgResult).toBe(true);
    });

    it("listFlags returns all known flags with sources", async () => {
      const flags = await flagService.listFlags();
      expect(flags.length).toBe(Object.values(FeatureFlag).length);
      flags.forEach((f) => {
        expect(f).toHaveProperty("flag");
        expect(f).toHaveProperty("enabled");
        expect(f).toHaveProperty("source");
      });
    });
  });

  // ── 6.5: Admin endpoints ──────────────────────────────────

  describe("6.5: Admin endpoints", () => {
    afterEach(async () => {
      await prisma.featureFlagOverride.deleteMany({});
    });

    it("GET /admin/feature-flags lists all flags", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/feature-flags")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("flags");
      expect(Array.isArray(res.body.flags)).toBe(true);
      expect(res.body.flags.length).toBe(Object.values(FeatureFlag).length);

      // Each flag has the expected shape
      res.body.flags.forEach(
        (f: { flag: string; enabled: boolean; source: string }) => {
          expect(typeof f.flag).toBe("string");
          expect(typeof f.enabled).toBe("boolean");
          expect(["env", "db-global", "db-org", "default"]).toContain(f.source);
        },
      );
    });

    it("PATCH /admin/feature-flags/:flag toggles a flag globally", async () => {
      // Enable LP_MARKETPLACE globally
      const res = await request(app.getHttpServer())
        .patch("/admin/feature-flags/LP_MARKETPLACE")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: true })
        .expect(200);

      expect(res.body).toEqual({
        flag: "LP_MARKETPLACE",
        enabled: true,
        organisationId: null,
      });

      // Verify via service
      const enabled = await flagService.isEnabled(FeatureFlag.LP_MARKETPLACE);
      expect(enabled).toBe(true);
    });

    it("PATCH /admin/feature-flags/:flag sets per-org override", async () => {
      const res = await request(app.getHttpServer())
        .patch("/admin/feature-flags/LP_MARKETPLACE")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: true, organisationId: supplierOrgId })
        .expect(200);

      expect(res.body).toEqual({
        flag: "LP_MARKETPLACE",
        enabled: true,
        organisationId: supplierOrgId,
      });

      // Service resolves per-org
      const orgResult = await flagService.isEnabled(
        FeatureFlag.LP_MARKETPLACE,
        supplierOrgId,
      );
      expect(orgResult).toBe(true);

      // Without org → falls through to built-in default (false for LP_MARKETPLACE)
      const globalResult = await flagService.isEnabled(
        FeatureFlag.LP_MARKETPLACE,
      );
      expect(globalResult).toBe(false);
    });

    it("PATCH /admin/feature-flags/:flag rejects unknown flag", async () => {
      const res = await request(app.getHttpServer())
        .patch("/admin/feature-flags/UNKNOWN_FLAG")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: true })
        .expect(400);

      expect(res.body.message).toMatch(/Unknown flag/);
    });

    it("non-admin cannot access feature flags", async () => {
      await request(app.getHttpServer())
        .get("/admin/feature-flags")
        .set("Authorization", `Bearer ${supplierToken}`)
        .expect(403);
    });
  });

  // ── 6.7: Early payments guard ─────────────────────────────

  describe("6.7: EARLY_PAYMENTS flag guard", () => {
    let poId: string;

    beforeAll(async () => {
      // Give buyer balance
      await prisma.user.update({
        where: { id: buyerId },
        data: { balance: 500_000_000 },
      });

      // Set buyer org bankIban
      await prisma.organisation.update({
        where: { id: buyerOrgId },
        data: { bankIban: "GB00FFTEST00000001" },
      });

      // Ensure escrow account exists
      const existing = await prisma.escrowAccount.findFirst({
        where: { currency: "GBP", active: true },
      });
      if (!existing) {
        await prisma.escrowAccount.create({
          data: {
            label: "FF Test Escrow",
            bank: "Test Bank",
            country: "GB",
            currency: "GBP",
            iban: "GB00FFTEST00000099",
            active: true,
          },
        });
      }

      // Ensure EARLY_PAYMENTS is DISABLED globally (override the built-in default of true)
      await prisma.featureFlagOverride.deleteMany({
        where: { flag: FeatureFlag.EARLY_PAYMENTS },
      });
      await prisma.featureFlagOverride.create({
        data: {
          flag: FeatureFlag.EARLY_PAYMENTS,
          organisationId: null,
          enabled: false,
        },
      });

      // Create a PO, get it to FULFILLMENT to test early payment guard
      const createRes = await request(app.getHttpServer())
        .post("/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          supplierId,
          description: "FF Guard Test PO",
          lineItems: [
            {
              description: "Widget",
              quantity: 10,
              unitPricePennies: 10_000,
            },
          ],
        })
        .expect(201);
      poId = createRes.body.id;

      // Send to supplier
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/send`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      // Supplier accepts
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/accept`)
        .set("Authorization", `Bearer ${supplierToken}`)
        .expect(200);

      // Buyer funds escrow
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      // Confirm escrow via service call (bypasses setTimeout)
      await poService.confirmEscrowFunding(poId);

      // Verify PO is in FULFILLMENT
      const poRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);
      expect(poRes.body.status).toBe("FULFILLMENT");
    }, 60_000);

    afterAll(async () => {
      await prisma.featureFlagOverride.deleteMany({
        where: { flag: FeatureFlag.EARLY_PAYMENTS },
      });
    });

    it("blocks early payment when EARLY_PAYMENTS flag is disabled", async () => {
      const res = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId })
        .expect(403);

      expect(res.body.message).toMatch(/not enabled/i);
    });

    it("allows early payment when EARLY_PAYMENTS flag is enabled globally", async () => {
      // Enable the flag globally
      await request(app.getHttpServer())
        .patch("/admin/feature-flags/EARLY_PAYMENTS")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: true })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId })
        .expect(201);

      expect(res.body).toHaveProperty("id");
      expect(res.body.status).toBe("REQUESTED");
    });
  });
});
