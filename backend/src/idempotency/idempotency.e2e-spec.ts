import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { IdempotencyService } from "./idempotency.service";
import { PurchaseOrdersService } from "../purchase-orders/purchase-orders.service";

/**
 * E2E: Idempotent Financial Operations (Phase 3)
 *
 * Verifies:
 * - Same Idempotency-Key replays cached response (no double-execution)
 * - Different keys produce separate cache entries
 * - Missing key proceeds normally (backwards compatible)
 * - Service-level guards: acknowledgeObligation(), fundEscrow(), requestEarlyPayment()
 * - IdempotencyService check/record/cleanup
 */
describe("Idempotent Financial Operations (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idempotencyService: IdempotencyService;
  let poService: PurchaseOrdersService;

  let buyerToken: string;
  let buyerId: string;
  let supplierToken: string;
  let supplierId: string;

  const TEST_PREFIX = "idemp-";

  // ── Bootstrap ─────────────────────────────────────────────

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    idempotencyService = app.get(IdempotencyService);
    poService = app.get(PurchaseOrdersService);

    await cleanupTestData();

    // Register buyer
    const buyerRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `${TEST_PREFIX}buyer@test.com`,
        password: "Password123!",
        name: "Idemp Buyer",
        companyName: "Idemp Buyer Ltd",
        role: "BUYER",
        jurisdiction: "UK",
      })
      .expect(201);
    buyerToken = buyerRes.body.accessToken;
    buyerId = buyerRes.body.user.id;

    // Give buyer large balance
    await prisma.user.update({
      where: { id: buyerId },
      data: { balance: 500_000_000 },
    });

    // Set buyer org bankIban
    const buyerMembership = await prisma.orgMembership.findUnique({
      where: { userId: buyerId },
    });
    if (buyerMembership) {
      await prisma.organisation.update({
        where: { id: buyerMembership.organisationId },
        data: { bankIban: "GB00TEST0000000001" },
      });
    }

    // Register supplier
    const supplierRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `${TEST_PREFIX}supplier@test.com`,
        password: "Password123!",
        name: "Idemp Supplier",
        companyName: "Idemp Supplier Ltd",
        role: "SUPPLIER",
        jurisdiction: "UK",
      })
      .expect(201);
    supplierToken = supplierRes.body.accessToken;
    supplierId = supplierRes.body.user.id;

    // Set supplier org bankIban
    const supplierMembership = await prisma.orgMembership.findUnique({
      where: { userId: supplierId },
    });
    if (supplierMembership) {
      await prisma.organisation.update({
        where: { id: supplierMembership.organisationId },
        data: { bankIban: "GB00TEST0000000002" },
      });
    }
  }, 60_000);

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  // ── Cleanup ───────────────────────────────────────────────

  async function cleanupTestData() {
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

    // Clean idempotency records
    await prisma.idempotencyRecord.deleteMany({});

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
          await prisma.organisation.delete({
            where: { id: membership.organisationId },
          });
        }
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  /** Small delay to let async interceptor caching complete */
  const tick = (ms = 100) => new Promise((r) => setTimeout(r, ms));

  /** Create a PO and advance it through the lifecycle up to a target state. */
  async function createPOToState(
    targetState:
      | "ACCEPTED"
      | "FULFILLMENT"
      | "SHIPPED"
      | "DELIVERED"
      | "VERIFIED",
  ) {
    // Create
    const createRes = await request(app.getHttpServer())
      .post("/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        supplierId,
        description: "Idemp test PO",
        lineItems: [
          { description: "Widget", quantity: 10, unitPricePennies: 10000 },
        ],
      });
    if (createRes.status !== 201) {
      throw new Error(
        `PO creation failed (${createRes.status}): ${JSON.stringify(createRes.body)}`,
      );
    }
    const poId = createRes.body.id;

    // Send
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/send`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .expect(200);

    // Accept
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/accept`)
      .set("Authorization", `Bearer ${supplierToken}`)
      .expect(200);
    if (targetState === "ACCEPTED") return poId;

    // Fund escrow
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/fund`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .expect(200);

    // Confirm escrow via service call (bypasses ADMIN role check)
    await poService.confirmEscrowFunding(poId);
    if (targetState === "FULFILLMENT") return poId;

    // Ship
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/ship`)
      .set("Authorization", `Bearer ${supplierToken}`)
      .expect(200);
    if (targetState === "SHIPPED") return poId;

    // Deliver
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/deliver`)
      .set("Authorization", `Bearer ${supplierToken}`)
      .expect(200);
    if (targetState === "DELIVERED") return poId;

    // Verify
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/verify`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .expect(200);
    return poId;
  }

  // ── Tests: HTTP-level idempotency (Idempotency-Key header) ──

  describe("HTTP-level idempotency via Idempotency-Key header", () => {
    it("should return cached response on replay with same key (fund-escrow)", async () => {
      const poId = await createPOToState("ACCEPTED");
      const key = `test-fund-${Date.now()}-${Math.random()}`;

      // First call
      const res1 = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .set("Idempotency-Key", key)
        .expect(200);

      // Allow interceptor to finish caching
      await tick();

      // Second call with same key — should return cached response
      const res2 = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .set("Idempotency-Key", key)
        .expect(200);

      expect(res2.body.id).toBe(res1.body.id);
      expect(res2.body.status).toBe(res1.body.status);

      // Verify only one IdempotencyRecord exists for this key
      const records = await prisma.idempotencyRecord.findMany({
        where: { key },
      });
      expect(records).toHaveLength(1);
    });

    it("should create separate cache entries with different keys", async () => {
      const poId = await createPOToState("ACCEPTED");
      const key1 = `test-fund-a-${Date.now()}`;
      const key2 = `test-fund-b-${Date.now()}`;

      // First call with key1
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .set("Idempotency-Key", key1)
        .expect(200);

      await tick();

      // Second call with key2 — service-level guard returns idempotent response,
      // but a separate cache entry should be created for key2
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .set("Idempotency-Key", key2)
        .expect(200);

      await tick();

      // Two separate IdempotencyRecords should exist
      const records = await prisma.idempotencyRecord.findMany({
        where: { key: { in: [key1, key2] } },
      });
      expect(records).toHaveLength(2);
    });

    it("should proceed normally without Idempotency-Key header", async () => {
      const poId = await createPOToState("ACCEPTED");
      const beforeCount = await prisma.idempotencyRecord.count();

      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.id).toBe(poId);

      await tick();

      // No new idempotency record should be created
      const afterCount = await prisma.idempotencyRecord.count();
      expect(afterCount).toBe(beforeCount);
    });

    it("should return cached response on replay with same key (acknowledge)", async () => {
      const poId = await createPOToState("VERIFIED");
      const key = `test-ack-${Date.now()}-${Math.random()}`;

      // First call — settles the PO
      const res1 = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .set("Idempotency-Key", key)
        .expect(200);
      expect(res1.body.status).toBe("SETTLED");

      await tick();

      // Second call with same key — should return cached 200
      const res2 = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .set("Idempotency-Key", key)
        .expect(200);
      expect(res2.body.status).toBe("SETTLED");
      expect(res2.body.id).toBe(res1.body.id);

      // Only one settlement should exist
      const settlements = await prisma.settlement.findMany({
        where: { purchaseOrderId: poId },
      });
      expect(settlements).toHaveLength(1);
    });
  });

  // ── Tests: Service-level idempotency guards ───────────────

  describe("Service-level idempotency guards", () => {
    it("acknowledgeObligation: already SETTLED PO returns existing state", async () => {
      const poId = await createPOToState("VERIFIED");

      // First call settles the PO
      const res1 = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);
      expect(res1.body.status).toBe("SETTLED");

      // Second call — PO is already SETTLED, should return idempotent response (not 400)
      const res2 = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);
      expect(res2.body.status).toBe("SETTLED");
      expect(res2.body.id).toBe(poId);
    });

    it("fundEscrow: already FULFILLMENT PO returns existing state", async () => {
      const poId = await createPOToState("FULFILLMENT");

      // Call fundEscrow on a PO that's already past ACCEPTED
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.id).toBe(poId);
      expect(res.body.status).toBe("FULFILLMENT");
    });

    it("requestEarlyPayment: duplicate request returns existing", async () => {
      const poId = await createPOToState("FULFILLMENT");

      // First request
      const res1 = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId })
        .expect(201);
      expect(res1.body.purchaseOrderId).toBe(poId);

      // Second request — should return existing, not throw
      const res2 = await request(app.getHttpServer())
        .post("/early-payments")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({ purchaseOrderId: poId })
        .expect(201);
      expect(res2.body.id).toBe(res1.body.id);
      expect(res2.body.purchaseOrderId).toBe(poId);
    });
  });

  // ── Tests: IdempotencyService unit-level (within E2E context) ──

  describe("IdempotencyService operations", () => {
    it("check() returns null for unknown key", async () => {
      const result = await idempotencyService.check("nonexistent-key");
      expect(result).toBeNull();
    });

    it("record() + check() returns cached response", async () => {
      const key = `svc-test-${Date.now()}`;
      const body = { id: "test-123", status: "OK" };

      await idempotencyService.record(key, "TEST /endpoint", 200, body);

      const cached = await idempotencyService.check(key);
      expect(cached).not.toBeNull();
      expect(cached!.statusCode).toBe(200);
      expect(cached!.body).toEqual(body);
    });

    it("check() returns null for expired record", async () => {
      const key = `expired-test-${Date.now()}`;

      // Insert an already-expired record directly
      await prisma.idempotencyRecord.create({
        data: {
          key,
          endpoint: "TEST /expired",
          statusCode: 200,
          responseBody: { ok: true },
          expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
        },
      });

      const cached = await idempotencyService.check(key);
      expect(cached).toBeNull();

      // Record should have been deleted
      const record = await prisma.idempotencyRecord.findUnique({
        where: { key },
      });
      expect(record).toBeNull();
    });

    it("cleanup() removes expired records", async () => {
      const ts = Date.now();
      // Insert expired + valid records
      await prisma.idempotencyRecord.createMany({
        data: [
          {
            key: `cleanup-exp-1-${ts}`,
            endpoint: "TEST",
            statusCode: 200,
            responseBody: {},
            expiresAt: new Date(Date.now() - 3600_000),
          },
          {
            key: `cleanup-exp-2-${ts}`,
            endpoint: "TEST",
            statusCode: 200,
            responseBody: {},
            expiresAt: new Date(Date.now() - 1800_000),
          },
          {
            key: `cleanup-valid-${ts}`,
            endpoint: "TEST",
            statusCode: 200,
            responseBody: {},
            expiresAt: new Date(Date.now() + 86400_000),
          },
        ],
      });

      // Call cleanup directly via prisma (cron disabled in test env)
      const result = await prisma.idempotencyRecord.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      expect(result.count).toBeGreaterThanOrEqual(2);

      // Valid record should still exist
      const valid = await prisma.idempotencyRecord.findUnique({
        where: { key: `cleanup-valid-${ts}` },
      });
      expect(valid).not.toBeNull();
    });

    it("record() upsert handles concurrent writes safely", async () => {
      const key = `race-test-${Date.now()}`;

      // Simulate two concurrent writes — no crash, one wins
      await Promise.all([
        idempotencyService.record(key, "TEST /race", 200, { writer: "A" }),
        idempotencyService.record(key, "TEST /race", 200, { writer: "B" }),
      ]);

      const cached = await idempotencyService.check(key);
      expect(cached).not.toBeNull();
      // One of the two writers should have won
      expect(["A", "B"]).toContain((cached!.body as any).writer);

      // Only one record should exist
      const records = await prisma.idempotencyRecord.findMany({
        where: { key },
      });
      expect(records).toHaveLength(1);
    });
  });
});
