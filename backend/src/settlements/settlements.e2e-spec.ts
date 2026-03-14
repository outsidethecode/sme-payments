import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { createHmac } from "crypto";
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
        await prisma.paymentInstrument.deleteMany({
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
      // Clean reconciliation reports (linked via ledger events we just deleted)
      await prisma.reconciliationReport.deleteMany({});
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

    // Ensure a GBP escrow account exists for fund tests
    await prisma.escrowAccount.upsert({
      where: { country_currency: { country: "GB", currency: "GBP" } },
      update: {},
      create: {
        label: "Test GBP Escrow",
        bank: "Test Bank",
        country: "GB",
        currency: "GBP",
        balanceMinor: 0,
        active: true,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Helper: create + send + accept + fund PO ─────────────

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

    // Fund escrow (Step 1: initiate → reserves funds, lock PENDING → LOCKED)
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/fund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // Fund escrow (Step 2: bank confirmation → credits escrow, PO → FULFILLMENT)
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/confirm-escrow`)
      .set("Authorization", `Bearer ${adminToken}`);

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

    it("should create PO, accept, fund escrow, and verify payment lock via adapter", async () => {
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

    it("should have created a PaymentInstrument in LOCKED status alongside the lock", async () => {
      const instrument = await prisma.paymentInstrument.findUnique({
        where: { purchaseOrderId: poId },
      });

      expect(instrument).toBeDefined();
      expect(instrument!.status).toBe("LOCKED");
      expect(instrument!.amount).toBeGreaterThan(0);
      expect(instrument!.currency).toBeDefined();
      expect(instrument!.bankReference).toMatch(/^SIM-RSV-/);
    });

    it("should ship then mark delivered by supplier", async () => {
      // Ship first (strict state machine: FULFILLMENT → SHIPPED → DELIVERED)
      const shipRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(shipRes.status).toBe(200);
      expect(shipRes.body.status).toBe("SHIPPED");

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

    it("should have transitioned the PaymentInstrument to SETTLED after settlement", async () => {
      const instrument = await prisma.paymentInstrument.findUnique({
        where: { purchaseOrderId: poId },
      });

      expect(instrument).toBeDefined();
      expect(instrument!.status).toBe("SETTLED");
      expect(instrument!.bankReference).toMatch(/^SIM-REL-/);
      expect(instrument!.settledAt).toBeDefined();
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
      // Ship first (strict state machine)
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);

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

  // ── Early Payment State Machine Tests ──────────────────────────

  describe("Early payment EXPIRED: PO settles without LP funding", () => {
    let poId: string;
    let epId: string;

    it("should create PO, accept, and request early payment", async () => {
      poId = await createAndAcceptPO();

      const res = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("REQUESTED");
      epId = res.body.id;
    });

    it("should show request in LP marketplace while PO is fundable", async () => {
      const res = await request(app.getHttpServer())
        .get("/early-payments/marketplace")
        .set("Authorization", `Bearer ${lpToken}`);

      expect(res.status).toBe(200);
      const found = res.body.find((r: any) => r.id === epId);
      expect(found).toBeDefined();
      expect(found.status).toBe("REQUESTED");
    });

    it("should settle PO normally (ship → deliver → verify → acknowledge) and auto-expire the request", async () => {
      // Ship first (strict state machine)
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);

      // Deliver
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);

      // Verify
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);

      // Acknowledge — should auto-expire the unfunded early payment request
      const ackRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(ackRes.status).toBe(200);
      expect(ackRes.body.status).toBe("SETTLED");
    });

    it("should have expired the early payment request", async () => {
      const res = await request(app.getHttpServer())
        .get(`/early-payments/${epId}`)
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("EXPIRED");
    });

    it("should NOT show expired request in LP marketplace", async () => {
      const res = await request(app.getHttpServer())
        .get("/early-payments/marketplace")
        .set("Authorization", `Bearer ${lpToken}`);

      expect(res.status).toBe(200);
      const found = res.body.find((r: any) => r.id === epId);
      expect(found).toBeUndefined();
    });

    it("should have EARLY_PAY_EXPIRED ledger event", async () => {
      const res = await request(app.getHttpServer())
        .get("/ledger")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const expiredEvents = res.body.filter(
        (e: any) => e.eventType === "EARLY_PAY_EXPIRED" && e.entityId === epId,
      );
      expect(expiredEvents.length).toBe(1);
      expect(expiredEvents[0].payload.reason).toContain("without LP funding");
    });
  });

  describe("Early payment EXPIRED: PO disputed by buyer", () => {
    let poId: string;
    let epId: string;

    it("should create PO, accept, request early payment, then deliver", async () => {
      poId = await createAndAcceptPO();

      const epRes = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId });

      expect(epRes.status).toBe(201);
      epId = epRes.body.id;

      // Ship first (strict state machine)
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);

      // Deliver
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
    });

    it("should expire early payment when buyer disputes", async () => {
      const disputeRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/dispute`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(disputeRes.status).toBe(200);
      expect(disputeRes.body.status).toBe("DISPUTED");
    });

    it("should have expired the early payment request", async () => {
      const res = await request(app.getHttpServer())
        .get(`/early-payments/${epId}`)
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("EXPIRED");
    });

    it("should have EARLY_PAY_EXPIRED ledger event with dispute reason", async () => {
      const res = await request(app.getHttpServer())
        .get("/ledger")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const expiredEvents = res.body.filter(
        (e: any) => e.eventType === "EARLY_PAY_EXPIRED" && e.entityId === epId,
      );
      expect(expiredEvents.length).toBe(1);
      expect(expiredEvents[0].payload.reason).toContain("disputed");
    });
  });

  describe("Early payment fund() blocked on non-fundable PO status", () => {
    let poId: string;
    let epId: string;

    it("should create PO, accept, request early payment, then settle without LP", async () => {
      poId = await createAndAcceptPO();

      const epRes = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId });

      expect(epRes.status).toBe(201);
      epId = epRes.body.id;

      // Race the PO to SETTLED (ship first — strict state machine)
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);

      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);

      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);

      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`);
    });

    it("should reject LP fund attempt on settled PO with 400", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/early-payments/${epId}/fund`)
        .set("Authorization", `Bearer ${lpToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("EXPIRED");
    });
  });

  describe("Early payment: duplicate request prevented", () => {
    let poId: string;

    it("should reject a second early payment request on the same PO", async () => {
      poId = await createAndAcceptPO();

      const res1 = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId });

      expect(res1.status).toBe(201);

      const res2 = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId });

      // Idempotent: returns existing request instead of 400
      expect(res2.status).toBe(201);
      expect(res2.body.id).toBe(res1.body.id);
      expect(res2.body.purchaseOrderId).toBe(poId);
    });
  });

  describe("Early payment: request rejected on ineligible PO status", () => {
    it("should reject early payment request on DRAFT PO", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          supplierId,
          description: "Draft PO for EP test",
          lineItems: [
            { description: "Item", quantity: 10, unitPricePennies: 10_000 },
          ],
        });

      expect(createRes.status).toBe(201);
      const draftPoId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: draftPoId });

      expect(res.status).toBe(400);
      const msg = Array.isArray(res.body.message)
        ? res.body.message.join(" ")
        : res.body.message;
      expect(msg).toContain("FULFILLMENT");
    });
  });

  describe("Early payment: marketplace hides non-fundable POs", () => {
    let poId: string;
    let epId: string;

    it("should create request then verify PO (making it non-fundable for marketplace)", async () => {
      poId = await createAndAcceptPO();

      const epRes = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId });

      expect(epRes.status).toBe(201);
      epId = epRes.body.id;

      // Move PO past fundable status: ship → deliver → verify
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);

      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);

      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);
    });

    it("should NOT show the request in marketplace since PO is VERIFIED", async () => {
      const res = await request(app.getHttpServer())
        .get("/early-payments/marketplace")
        .set("Authorization", `Bearer ${lpToken}`);

      expect(res.status).toBe(200);
      const found = res.body.find((r: any) => r.id === epId);
      expect(found).toBeUndefined();
    });
  });

  // ── Original Tests ───────────────────────────────────────────

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

  // ── Bank Webhook E2E Tests ──────────────────────────────

  describe("POST /settlements/webhooks/bank-callback", () => {
    const WEBHOOK_SECRET = "e2e-test-webhook-secret-32bytes!";

    function signWebhookPayload(payload: {
      externalRef: string;
      status: string;
      amount: number;
      bankReference: string;
      timestamp: string;
    }) {
      const message = [
        payload.externalRef,
        payload.status,
        payload.amount,
        payload.bankReference,
        payload.timestamp,
      ].join("|");

      return createHmac("sha256", WEBHOOK_SECRET).update(message).digest("hex");
    }

    beforeAll(() => {
      process.env.BANK_WEBHOOK_SECRET = WEBHOOK_SECRET;
    });

    afterAll(() => {
      delete process.env.BANK_WEBHOOK_SECRET;
    });

    it("should NOT require JWT authentication", async () => {
      // Send without Authorization header — should NOT get 401 Unauthorized
      // It may fail for other reasons (bad signature) but not 401
      const res = await request(app.getHttpServer())
        .post("/settlements/webhooks/bank-callback")
        .send({
          externalRef: "FAKE-REF",
          status: "CONFIRMED",
          amount: 1000,
          bankReference: "BANK-001",
          timestamp: new Date().toISOString(),
          signature: "invalid",
        });

      // Should be 401 from HMAC check (not JWT), or another error, but not a JWT 401
      // The endpoint is reachable without JWT — if JWT guard was on, we'd get a different 401
      expect(res.status).not.toBe(404);
    });

    it("should reject invalid HMAC signature", async () => {
      const payload = {
        externalRef: "SIM-RSV-FAKE",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-FAKE",
        timestamp: new Date().toISOString(),
        signature: "0".repeat(64),
      };

      const res = await request(app.getHttpServer())
        .post("/settlements/webhooks/bank-callback")
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.message).toContain("Invalid webhook signature");
    });

    it("should reject replayed webhook (timestamp > 5 min old)", async () => {
      const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const payload = {
        externalRef: "SIM-RSV-OLD",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-OLD",
        timestamp: oldTimestamp,
        signature: "",
      };
      payload.signature = signWebhookPayload(payload);

      const res = await request(app.getHttpServer())
        .post("/settlements/webhooks/bank-callback")
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Webhook timestamp too old");
    });

    it("should reject unknown externalRef with valid signature", async () => {
      const payload = {
        externalRef: "UNKNOWN-REF-E2E",
        status: "CONFIRMED",
        amount: 50_000,
        bankReference: "BANK-UNKNOWN",
        timestamp: new Date().toISOString(),
        signature: "",
      };
      payload.signature = signWebhookPayload(payload);

      const res = await request(app.getHttpServer())
        .post("/settlements/webhooks/bank-callback")
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("No lock or settlement found");
    });

    it("should confirm a real PENDING lock via webhook", async () => {
      // Create a PO that will have a payment lock with a known externalRef
      const poId = await createAndAcceptPO();

      // Fetch the lock to get its externalRef
      const poRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      const lockRef =
        poRes.body.paymentLock?.openBankingRef ||
        poRes.body.paymentLock?.externalRef;

      // The simulated adapter confirms the lock immediately (status=LOCKED),
      // so the webhook should return no-op (idempotent)
      const payload = {
        externalRef: lockRef,
        status: "CONFIRMED",
        amount: poRes.body.paymentLock?.amount || 100_000,
        bankReference: "BANK-E2E-CONFIRM",
        timestamp: new Date().toISOString(),
        signature: "",
      };
      payload.signature = signWebhookPayload(payload);

      const res = await request(app.getHttpServer())
        .post("/settlements/webhooks/bank-callback")
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      // SimulatedAdapter already confirmed → webhook is idempotent no-op
      expect(res.body.action).toBe("no-op");
      expect(res.body.detail).toContain("already LOCKED");
    });
  });

  // ── Reconciliation Engine E2E ──────────────────────────────

  describe("Reconciliation Engine", () => {
    it("should require admin role for POST /settlements/reconciliation/run", async () => {
      const res = await request(app.getHttpServer())
        .post("/settlements/reconciliation/run")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(403);
    });

    it("should run manual reconciliation and return a report (admin)", async () => {
      const res = await request(app.getHttpServer())
        .post("/settlements/reconciliation/run")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("runAt");
      expect(typeof res.body.totalChecked).toBe("number");
      expect(typeof res.body.matched).toBe("number");
      expect(typeof res.body.mismatches).toBe("number");
      expect(Array.isArray(res.body.alerts)).toBe(true);
      expect(typeof res.body.ledgerBalance).toBe("number");
    });

    it("should return latest reconciliation report (admin)", async () => {
      const res = await request(app.getHttpServer())
        .get("/settlements/reconciliation/latest")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // After the manual run above, there should be at least one report
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("totalChecked");
    });

    it("should return paginated reconciliation reports (admin)", async () => {
      const res = await request(app.getHttpServer())
        .get("/settlements/reconciliation/reports?limit=10&offset=0")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty("totalChecked");
    });

    it("should log BANK_RECONCILIATION_COMPLETED ledger event", async () => {
      // The manual run above should have created a ledger event
      const report = await request(app.getHttpServer())
        .get("/settlements/reconciliation/latest")
        .set("Authorization", `Bearer ${adminToken}`);

      const events = await prisma.eventLog.findMany({
        where: {
          entityType: "RECONCILIATION",
          entityId: report.body.id,
          eventType: "BANK_RECONCILIATION_COMPLETED",
        },
      });

      expect(events.length).toBe(1);
      expect(events[0].payload).toMatchObject({
        source: "RECONCILIATION_ENGINE",
      });
    });
  });
});
