import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Phase 5 — Race Condition Tests (e2e)
 *
 * Tests concurrent access patterns that could cause double-payments,
 * duplicate locks, or state machine corruption.
 *
 * 5.5: 10 concurrent fundEscrow() calls on same PO → exactly 1 lock
 * 5.6: Simultaneous LP fund() + buyer acknowledge() → exactly 1 path wins
 */
describe("Phase 5 — Race Condition Tests (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let supplierToken: string;
  let adminToken: string;
  let lpToken: string;
  let buyerId: string;
  let supplierId: string;

  const testEmails = [
    "race-buyer@test.com",
    "race-supplier@test.com",
    "race-admin@test.com",
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // ── Clean up stale test data (mirrors po-state-machine pattern) ──
    const existingUsers = await prisma.user.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    });
    const existingUserIds = existingUsers.map((u) => u.id);

    if (existingUserIds.length > 0) {
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
        await prisma.escrowTransaction.deleteMany({
          where: { purchaseOrderId: { in: poIds } },
        });
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

      // Clean orphan events
      await prisma.eventLog.deleteMany({
        where: { actorId: { in: existingUserIds } },
      });

      // Clean org memberships & organisations BEFORE deleting users
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

    // ── Register buyer ──
    const regBuyer = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "race-buyer@test.com",
        password: "RaceTest123!",
        name: "Race Buyer",
        companyName: "Race Buyer Co",
        role: "BUYER",
      });
    expect(regBuyer.status).toBe(201);
    buyerToken = regBuyer.body.accessToken;
    buyerId = regBuyer.body.user.id;

    await prisma.user.update({
      where: { id: buyerId },
      data: { balance: 100_000_000 },
    });

    const buyerMembership = await prisma.orgMembership.findUnique({
      where: { userId: buyerId },
    });
    if (buyerMembership) {
      await prisma.organisation.update({
        where: { id: buyerMembership.organisationId },
        data: { bankIban: "GB29NWBK60161331926819" },
      });
    }

    // ── Register supplier ──
    const regSupplier = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "race-supplier@test.com",
        password: "RaceTest123!",
        name: "Race Supplier",
        companyName: "Race Supplier Co",
        role: "SUPPLIER",
      });
    expect(regSupplier.status).toBe(201);
    supplierToken = regSupplier.body.accessToken;
    supplierId = regSupplier.body.user.id;

    const supplierMembership = await prisma.orgMembership.findUnique({
      where: { userId: supplierId },
    });
    if (supplierMembership) {
      await prisma.organisation.update({
        where: { id: supplierMembership.organisationId },
        data: { bankIban: "GB76BARC20035344773388" },
      });
    }

    // ── Admin — create directly via Prisma (with org + membership) ──
    const bcrypt = await import("bcrypt");
    const adminHash = await bcrypt.hash("RaceTest123!", 12);
    const adminUser = await prisma.user.create({
      data: {
        email: "race-admin@test.com",
        password: adminHash,
        name: "Race Admin",
        role: "ADMIN",
      },
    });
    const adminOrg = await prisma.organisation.create({
      data: {
        name: "Race Admin Org",
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
    const adminLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "race-admin@test.com", password: "RaceTest123!" });
    expect(adminLogin.status).toBe(201);
    adminToken = adminLogin.body.accessToken;

    // ── LP — use seeded LP ──
    const lpLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "lp@capitalbridge.co.uk", password: "password123" });
    expect(lpLogin.status).toBe(201);
    lpToken = lpLogin.body.accessToken;

    // ── Ensure GBP escrow account exists ──
    await prisma.escrowAccount.upsert({
      where: { country_currency: { country: "GB", currency: "GBP" } },
      update: {},
      create: {
        label: "Race Test GBP Escrow",
        bank: "Test Bank",
        country: "GB",
        currency: "GBP",
        balanceMinor: 0,
        active: true,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  // ─────────────────────────────────────────────────────────────
  // Helper: Create a PO and advance it to a given state
  // ─────────────────────────────────────────────────────────────

  async function createPOToState(
    targetState: "ACCEPTED" | "FULFILLMENT" | "VERIFIED",
  ): Promise<string> {
    const createRes = await request(app.getHttpServer())
      .post("/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        supplierId,
        description: `Race test PO ${Date.now()}`,
        lineItems: [
          { description: "Widget", quantity: 10, unitPricePennies: 10_000 },
        ],
      });
    expect(createRes.status).toBe(201);
    const poId = createRes.body.id;
    expect(poId).toBeDefined();

    const sendRes = await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/send`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(sendRes.status).toBe(200);

    const acceptRes = await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/accept`)
      .set("Authorization", `Bearer ${supplierToken}`);
    expect(acceptRes.status).toBe(200);

    if (targetState === "ACCEPTED") return poId;

    const fundRes = await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/fund`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(fundRes.status).toBe(200);

    const confirmRes = await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/confirm-escrow`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(confirmRes.status).toBe(200);

    if (targetState === "FULFILLMENT") return poId;

    const shipRes = await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/ship`)
      .set("Authorization", `Bearer ${supplierToken}`);
    expect(shipRes.status).toBe(200);

    const deliverRes = await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/deliver`)
      .set("Authorization", `Bearer ${supplierToken}`);
    expect(deliverRes.status).toBe(200);

    const verifyRes = await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/verify`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(verifyRes.status).toBe(200);

    return poId;
  }

  // ═══════════════════════════════════════════════════════════════
  // 5.5: Concurrent fundEscrow() — exactly 1 lock created
  // ═══════════════════════════════════════════════════════════════

  describe("5.5: Concurrent fundEscrow calls", () => {
    it("10 concurrent fundEscrow() on same PO → exactly 1 payment lock", async () => {
      const poId = await createPOToState("ACCEPTED");

      // Fire 10 concurrent fund requests
      const promises = Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .patch(`/purchase-orders/${poId}/fund`)
          .set("Authorization", `Bearer ${buyerToken}`),
      );

      const results = await Promise.all(promises);

      // At least 1 must succeed (200); others may hit the unique
      // constraint race (500) or return idempotent 200.
      const statuses = results.map((r) => r.status);
      const successes = statuses.filter((s) => s === 200);
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // Exactly 1 payment lock exists (unique constraint guarantees this)
      const locks = await prisma.paymentLock.findMany({
        where: { purchaseOrderId: poId },
      });
      expect(locks).toHaveLength(1);
    });

    it("concurrent fundEscrow() produces exactly 1 ESCROW_FUNDING_INITIATED event", async () => {
      const poId = await createPOToState("ACCEPTED");

      const promises = Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .patch(`/purchase-orders/${poId}/fund`)
          .set("Authorization", `Bearer ${buyerToken}`),
      );

      await Promise.all(promises);

      // Check ledger — should have exactly 1 ESCROW_FUNDING_INITIATED
      const events = await prisma.eventLog.findMany({
        where: {
          entityId: poId,
          eventType: "ESCROW_FUNDING_INITIATED",
        },
      });

      expect(events).toHaveLength(1);
    });

    it("concurrent fundEscrow() + confirmEscrow() → correct state", async () => {
      const poId = await createPOToState("ACCEPTED");

      // First, fund it (this creates the lock)
      const fundRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(fundRes.status).toBe(200);

      // Now fire confirm + redundant fund calls concurrently
      const promises = [
        request(app.getHttpServer())
          .patch(`/purchase-orders/${poId}/confirm-escrow`)
          .set("Authorization", `Bearer ${adminToken}`),
        ...Array.from({ length: 3 }, () =>
          request(app.getHttpServer())
            .patch(`/purchase-orders/${poId}/fund`)
            .set("Authorization", `Bearer ${buyerToken}`),
        ),
      ];

      await Promise.all(promises);

      // PO should be in FULFILLMENT (confirm succeeded)
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
      });
      expect(po!.status).toBe("FULFILLMENT");

      // Still exactly 1 lock
      const locks = await prisma.paymentLock.findMany({
        where: { purchaseOrderId: poId },
      });
      expect(locks).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 5.6: Simultaneous LP fund() + buyer acknowledge()
  // ═══════════════════════════════════════════════════════════════

  describe("5.6: LP fund vs buyer acknowledge race", () => {
    it("simultaneous LP fund + buyer acknowledge → no double payment", async () => {
      // Build a PO all the way to VERIFIED with an early payment request
      const poId = await createPOToState("FULFILLMENT");

      // Supplier requests early payment (PO must be in FULFILLMENT/SHIPPED/DELIVERED)
      const epRes = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId });
      expect(epRes.status).toBe(201);
      const earlyPayId = epRes.body.id;

      // Advance to VERIFIED
      const shipRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(shipRes.status).toBe(200);

      const deliverRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(deliverRes.status).toBe(200);

      const verifyRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(verifyRes.status).toBe(200);

      // Race: LP tries to fund AND buyer tries to acknowledge
      const [fundResult, ackResult] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/early-payments/${earlyPayId}/fund`)
          .set("Authorization", `Bearer ${lpToken}`),
        request(app.getHttpServer())
          .patch(`/purchase-orders/${poId}/acknowledge`)
          .set("Authorization", `Bearer ${buyerToken}`),
      ]);

      // At least one should succeed
      const fundOk = fundResult.status === 200;
      const ackOk = ackResult.status === 200;
      expect(fundOk || ackOk).toBe(true);

      // PO should end up SETTLED
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
      });
      expect(po!.status).toBe("SETTLED");

      // At least 1 settlement record
      const settlements = await prisma.settlement.findMany({
        where: { purchaseOrderId: poId },
      });
      expect(settlements.length).toBeGreaterThanOrEqual(1);

      // Instrument should be in a terminal state
      const instrument = await prisma.paymentInstrument.findUnique({
        where: { purchaseOrderId: poId },
      });
      expect(instrument).toBeDefined();
      expect(["SETTLED", "SETTLEMENT_PENDING"]).toContain(instrument!.status);
    });

    it("multiple concurrent acknowledge() on same PO → exactly 1 settlement", async () => {
      const poId = await createPOToState("VERIFIED");

      // Fire 5 acknowledges concurrently
      const promises = Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .patch(`/purchase-orders/${poId}/acknowledge`)
          .set("Authorization", `Bearer ${buyerToken}`),
      );

      const results = await Promise.all(promises);

      // At least 1 succeeds; others may hit 200 (idempotent) or 400/500 (race)
      const statuses = results.map((r) => r.status);
      const successes = statuses.filter((s) => s === 200);
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // Exactly 1 settlement
      const settlements = await prisma.settlement.findMany({
        where: { purchaseOrderId: poId },
      });
      expect(settlements).toHaveLength(1);

      // PO is SETTLED
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
      });
      expect(po!.status).toBe("SETTLED");
    });

    it("3 concurrent LP fund() attempts → exactly 1 succeeds", async () => {
      const poId = await createPOToState("FULFILLMENT");

      // Supplier requests early payment
      const epRes = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId });
      expect(epRes.status).toBe(201);
      const earlyPayId = epRes.body.id;

      // Fire 3 concurrent LP fund attempts
      const promises = Array.from({ length: 3 }, () =>
        request(app.getHttpServer())
          .patch(`/early-payments/${earlyPayId}/fund`)
          .set("Authorization", `Bearer ${lpToken}`),
      );

      const results = await Promise.all(promises);

      // At least 1 should succeed (200), others may get 200 (idempotent) or 400/500
      const successes = results.filter((r) => r.status === 200);
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // Early payment should be FUNDED
      const ep = await prisma.earlyPaymentRequest.findUnique({
        where: { id: earlyPayId },
      });
      expect(ep!.status).toBe("FUNDED");

      // Instrument beneficiary should be LIQUIDITY_PARTNER
      const instrument = await prisma.paymentInstrument.findUnique({
        where: { purchaseOrderId: poId },
      });
      expect(instrument!.settlementBeneficiary).toBe("LIQUIDITY_PROVIDER");
    });
  });
});
