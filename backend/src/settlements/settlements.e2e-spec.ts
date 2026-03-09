import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

describe("Settlements E2E", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let supplierToken: string;
  let lpToken: string;
  let adminToken: string;
  let buyerId: string;
  let supplierId: string;
  let lpId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Clean up ONLY test-specific data (avoid wiping seed data used by other suites)
    const testEmails = [
      "settle-buyer@test.com",
      "settle-supplier@test.com",
      "settle-lp@test.com",
      "settle-admin@test.com",
    ];
    const existingUsers = await prisma.user.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    });
    const existingUserIds = existingUsers.map((u) => u.id);
    if (existingUserIds.length > 0) {
      // Clean related data for these users
      const pos = await prisma.purchaseOrder.findMany({
        where: {
          OR: [
            { buyerId: { in: existingUserIds } },
            { supplierId: { in: existingUserIds } },
          ],
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
        await prisma.paymentLock.deleteMany({
          where: { purchaseOrderId: { in: poIds } },
        });
        await prisma.eventLog.deleteMany({
          where: {
            OR: [
              { entityId: { in: poIds } },
              { actorId: { in: existingUserIds } },
            ],
          },
        });
        await prisma.purchaseOrder.deleteMany({
          where: { id: { in: poIds } },
        });
      }
      // Also delete any remaining event logs referencing these users
      await prisma.eventLog.deleteMany({
        where: { actorId: { in: existingUserIds } },
      });
      // Clean memberships + orgs
      const memberships = await prisma.orgMembership.findMany({
        where: { userId: { in: existingUserIds } },
      });
      const orgIds = memberships.map((m) => m.organisationId);
      await prisma.orgMembership.deleteMany({
        where: { userId: { in: existingUserIds } },
      });
      if (orgIds.length > 0) {
        await prisma.policyRule.deleteMany({
          where: { organisationId: { in: orgIds } },
        });
        // Delete orgs that have no remaining members
        for (const orgId of orgIds) {
          const remaining = await prisma.orgMembership.count({
            where: { organisationId: orgId },
          });
          if (remaining === 0) {
            await prisma.organisation
              .delete({ where: { id: orgId } })
              .catch(() => {});
          }
        }
      }
      await prisma.user.deleteMany({
        where: { id: { in: existingUserIds } },
      });
    }

    // Register buyer
    const buyerRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "settle-buyer@test.com",
        password: "Password123!",
        name: "Settle Buyer",
        companyName: "Settle Buyer Co",
        role: "BUYER",
      });
    buyerToken = buyerRes.body.accessToken;
    buyerId = buyerRes.body.user.id;

    // Give buyer sufficient balance
    await prisma.user.update({
      where: { id: buyerId },
      data: { balance: 10_000_000 }, // 100k
    });

    // Set buyer org IBAN
    const buyerMembership = await prisma.orgMembership.findUnique({
      where: { userId: buyerId },
    });
    if (buyerMembership) {
      await prisma.organisation.update({
        where: { id: buyerMembership.organisationId },
        data: { bankIban: "GB29NWBK60161331926819" },
      });
    }

    // Register supplier
    const supplierRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "settle-supplier@test.com",
        password: "Password123!",
        name: "Settle Supplier",
        companyName: "Settle Supplier Co",
        role: "SUPPLIER",
      });
    supplierToken = supplierRes.body.accessToken;
    supplierId = supplierRes.body.user.id;

    // Set supplier org IBAN
    const supplierMembership = await prisma.orgMembership.findUnique({
      where: { userId: supplierId },
    });
    if (supplierMembership) {
      await prisma.organisation.update({
        where: { id: supplierMembership.organisationId },
        data: { bankIban: "GB76BARC20035344773388" },
      });
    }

    // Register LP (direct Prisma — register endpoint only supports BUYER/SUPPLIER)
    const bcrypt = await import("bcrypt");
    const hashedPw = await bcrypt.hash("Password123!", 12);

    const lpUser = await prisma.user.create({
      data: {
        email: "settle-lp@test.com",
        password: hashedPw,
        name: "Settle LP",
        role: "LIQUIDITY_PARTNER",
        balance: 50_000_000,
      },
    });
    lpId = lpUser.id;

    const lpOrg = await prisma.organisation.create({
      data: {
        name: "Settle LP Fund",
        type: "LIQUIDITY_PARTNER",
        jurisdiction: "UK",
        currency: "GBP",
        onboardingStatus: "COMPLETED",
        bankIban: "GB82WEST12345698765432",
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

    const lpLoginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "settle-lp@test.com", password: "Password123!" });
    lpToken = lpLoginRes.body.accessToken;

    // Register admin (same approach)
    const adminUser = await prisma.user.create({
      data: {
        email: "settle-admin@test.com",
        password: hashedPw,
        name: "Settle Admin",
        role: "ADMIN",
      },
    });
    const adminOrg = await prisma.organisation.create({
      data: {
        name: "Platform Admin",
        type: "BUYER",
        onboardingStatus: "COMPLETED",
      },
    });
    await prisma.orgMembership.create({
      data: {
        userId: adminUser.id,
        organisationId: adminOrg.id,
        orgRole: "OWNER",
        isDefault: true,
      },
    });

    const adminLoginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "settle-admin@test.com", password: "Password123!" });
    adminToken = adminLoginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Helper: create + send + accept PO ───────────────────

  async function createAndAcceptPO(): Promise<string> {
    const createRes = await request(app.getHttpServer())
      .post("/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        supplierId,
        description: "Settlement test PO",
        lineItems: [
          { description: "Test item", quantity: 10, unitPricePennies: 10_000 },
        ],
      });
    const poId = createRes.body.id;

    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/send`)
      .set("Authorization", `Bearer ${buyerToken}`);

    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/accept`)
      .set("Authorization", `Bearer ${supplierToken}`);

    return poId;
  }

  // ── Tests ───────────────────────────────────────────────

  describe("GET /settlements/adapter", () => {
    it("should return SIMULATED adapter", async () => {
      const res = await request(app.getHttpServer())
        .get("/settlements/adapter")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.adapter).toBe("SIMULATED");
    });
  });

  describe("Full PO settlement flow via adapter", () => {
    let poId: string;

    it("should create PO, accept (reserve funds), and verify payment lock via adapter", async () => {
      poId = await createAndAcceptPO();

      const po = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(po.body.paymentLocked).toBe(true);
      expect(po.body.paymentLock).toBeDefined();
      expect(po.body.paymentLock.status).toBe("LOCKED");
      // SIM- prefix from simulated adapter
      expect(po.body.paymentLock.externalRef || "").toMatch(/^SIM-RSV-/);
    });

    it("should mark delivered by supplier", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("DELIVERED");
    });

    it("should verify delivery and settle via adapter", async () => {
      // Step 1: Verify delivery (DELIVERED → VERIFIED)
      const verifyRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.status).toBe("VERIFIED");

      // Step 2: Acknowledge obligation & settle (VERIFIED → SETTLED)
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SETTLED");
    });

    it("should have created settlement with rail metadata", async () => {
      const res = await request(app.getHttpServer())
        .get(`/settlements/po/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const settlement = res.body[0];
      expect(settlement.type).toBe("STANDARD");
      expect(settlement.status).toBe("COMPLETED");
      expect(settlement.settlementRail).toBe("SIMULATED");
      expect(settlement.externalRef).toMatch(/^SIM-REL-/);
      expect(settlement.currency).toBe("GBP");
    });

    it("should have settlement in the user list", async () => {
      const res = await request(app.getHttpServer())
        .get("/settlements")
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Early payment settlement flow", () => {
    let poId: string;
    let epId: string;

    it("should create and accept PO for early payment", async () => {
      poId = await createAndAcceptPO();
    });

    it("should request early payment", async () => {
      const res = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId });

      expect(res.status).toBe(201);
      epId = res.body.id;
    });

    it("should fund early payment via LP (uses adapter for transfer)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/early-payments/${epId}/fund`)
        .set("Authorization", `Bearer ${lpToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("FUNDED");
    });

    it("should have created advance settlement with rail metadata", async () => {
      const res = await request(app.getHttpServer())
        .get(`/settlements/po/${poId}`)
        .set("Authorization", `Bearer ${lpToken}`);

      expect(res.status).toBe(200);
      const advanceSettlement = res.body.find(
        (s: any) => s.type === "EARLY_PAY_ADVANCE",
      );
      expect(advanceSettlement).toBeDefined();
      expect(advanceSettlement.settlementRail).toBe("SIMULATED");
      expect(advanceSettlement.externalRef).toMatch(/^SIM-TRF-/);
    });

    it("should settle to LP after delivery verification", async () => {
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);

      // Verify delivery
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);

      // Acknowledge obligation & settle
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SETTLED");
    });

    it("should have both advance and final settlement records", async () => {
      const res = await request(app.getHttpServer())
        .get(`/settlements/po/${poId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);

      const types = res.body.map((s: any) => s.type).sort();
      expect(types).toEqual(["EARLY_PAY_ADVANCE", "EARLY_PAY_SETTLEMENT"]);
    });
  });

  describe("Early payment on SHIPPED PO", () => {
    let poId: string;
    let epId: string;

    it("should create, accept, and ship PO", async () => {
      poId = await createAndAcceptPO();

      const shipRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(shipRes.status).toBe(200);
      expect(shipRes.body.status).toBe("SHIPPED");
    });

    it("should allow supplier to request early payment on SHIPPED PO", async () => {
      const res = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("REQUESTED");
      epId = res.body.id;
    });

    it("should fund early payment on SHIPPED PO", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/early-payments/${epId}/fund`)
        .set("Authorization", `Bearer ${lpToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("FUNDED");
    });

    it("should complete full flow: deliver → verify → acknowledge", async () => {
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);

      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);

      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SETTLED");
    });
  });

  describe("Admin reconciliation", () => {
    it("should return pending settlements (empty initially)", async () => {
      const res = await request(app.getHttpServer())
        .get("/settlements/pending")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("Ledger events contain rail metadata", () => {
    it("should have settlement rail info in ledger events", async () => {
      const res = await request(app.getHttpServer())
        .get("/ledger")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      const settlementEvents = res.body.filter(
        (e: any) => e.eventType === "SETTLEMENT_COMPLETED",
      );
      expect(settlementEvents.length).toBeGreaterThan(0);

      const event = settlementEvents[0];
      expect(event.payload.settlementRail).toBe("SIMULATED");
      expect(event.payload.externalRef).toBeDefined();
    });
  });
});
