import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

describe("PO Negotiation / Counter-Proposal E2E", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let supplierToken: string;
  let buyerId: string;
  let supplierId: string;

  const TEST_EMAILS = ["nego-buyer@test.com", "nego-supplier@test.com"];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // ── Clean up ──────────────────────────────────────────
    const existingUsers = await prisma.user.findMany({
      where: { email: { in: TEST_EMAILS } },
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
        await prisma.pORevision.deleteMany({
          where: { purchaseOrderId: { in: poIds } },
        });
        await prisma.dispute.deleteMany({
          where: { purchaseOrderId: { in: poIds } },
        });
        await prisma.evidenceAttachment.deleteMany({
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
      await prisma.eventLog.deleteMany({
        where: { actorId: { in: existingUserIds } },
      });
      await prisma.orgMembership.deleteMany({
        where: { userId: { in: existingUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: existingUserIds } },
      });
    }

    // ── Register buyer & supplier ─────────────────────────
    const buyerRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "nego-buyer@test.com",
        password: "TestPass123!",
        name: "Nego Buyer",
        role: "BUYER",
        companyName: "Nego Buyer Co",
      });
    buyerToken = buyerRes.body.accessToken;
    buyerId = buyerRes.body.user.id;

    const supplierRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "nego-supplier@test.com",
        password: "TestPass123!",
        name: "Nego Supplier",
        role: "SUPPLIER",
        companyName: "Nego Supplier Co",
      });
    supplierToken = supplierRes.body.accessToken;
    supplierId = supplierRes.body.user.id;

    // Fund buyer account
    await prisma.user.update({
      where: { id: buyerId },
      data: { balance: 50_000_000 },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Utility: create a SENT PO ready for negotiation.
   */
  async function createSentPO(
    lineItems = [
      { description: "Part A", quantity: 10, unitPricePennies: 10000 },
    ],
    extra: Record<string, unknown> = {},
  ): Promise<{ poId: string; body: any }> {
    const createRes = await request(app.getHttpServer())
      .post("/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        supplierId,
        description: "Negotiation test PO",
        lineItems,
        ...extra,
      });
    expect(createRes.status).toBe(201);
    const poId = createRes.body.id;

    const sendRes = await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/send`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(sendRes.status).toBe(200);

    return { poId, body: createRes.body };
  }

  // ═════════════════════════════════════════════════════════
  //  New PO Fields (SKU, UOM, delivery date, notes, contact)
  // ═════════════════════════════════════════════════════════

  describe("Extended PO Fields", () => {
    it("should create PO with SKU, UOM, delivery date, notes, buyer contact", async () => {
      const res = await request(app.getHttpServer())
        .post("/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          supplierId,
          description: "Extended fields PO",
          lineItems: [
            {
              description: "Hydraulic Valve",
              quantity: 5,
              unitPricePennies: 50000,
              sku: "HV-2025-001",
              unitOfMeasure: "EACH",
            },
            {
              description: "Rubber Gasket",
              quantity: 100,
              unitPricePennies: 500,
              sku: "RG-100",
              unitOfMeasure: "BOX",
            },
          ],
          expectedDeliveryDate: "2025-07-01T00:00:00.000Z",
          notes: "Deliver before Eid holiday. Call before arrival.",
          buyerContactName: "Fahad Al-Rashid",
          buyerContactEmail: "fahad@negobuyer.sa",
        });

      expect(res.status).toBe(201);
      expect(res.body.lineItems[0].sku).toBe("HV-2025-001");
      expect(res.body.lineItems[0].unitOfMeasure).toBe("EACH");
      expect(res.body.lineItems[1].sku).toBe("RG-100");
      expect(res.body.lineItems[1].unitOfMeasure).toBe("BOX");
      expect(res.body.expectedDeliveryDate).toBeDefined();
      expect(res.body.notes).toBe(
        "Deliver before Eid holiday. Call before arrival.",
      );
      expect(res.body.buyerContactName).toBe("Fahad Al-Rashid");
      expect(res.body.buyerContactEmail).toBe("fahad@negobuyer.sa");
      expect(res.body.currentRevision).toBe(0);
    });
  });

  // ═════════════════════════════════════════════════════════
  //  Scenario 1: Supplier counter-proposes → Buyer accepts
  // ═════════════════════════════════════════════════════════

  describe("Supplier counter → Buyer accepts", () => {
    let poId: string;

    it("should allow supplier to counter-propose a SENT PO", async () => {
      const created = await createSentPO([
        { description: "Steel Beam", quantity: 100, unitPricePennies: 5000 },
      ]);
      poId = created.poId;

      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/counter`)
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          lineItems: [
            {
              description: "Steel Beam (grade A)",
              quantity: 100,
              unitPricePennies: 5500,
            },
          ],
          notes: "Price increase due to material cost rise",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("NEGOTIATION");
      expect(res.body.currentRevision).toBe(1);
      expect(res.body.revisions).toBeDefined();
      expect(res.body.revisions.length).toBe(1);
      expect(res.body.revisions[0].proposedByRole).toBe("SUPPLIER");
      expect(res.body.revisions[0].status).toBe("PENDING");
      expect(res.body.revisions[0].amount).toBe(550000);
    });

    it("should prevent supplier from countering own proposal (no double-counter)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/counter`)
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          lineItems: [
            {
              description: "Steel Beam",
              quantity: 100,
              unitPricePennies: 5200,
            },
          ],
        });

      // Should fail — it's supplier's turn to wait
      expect(res.status).toBe(400);
    });

    it("should allow buyer to accept the counter-proposal", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/accept-counter`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      // After accepting counter, PO goes to SENT (ready for normal accept flow)
      expect(res.body.status).toBe("SENT");
      // Line items should be updated to the counter-proposal's terms
      expect(res.body.lineItems[0].description).toBe("Steel Beam (grade A)");
      expect(res.body.lineItems[0].unitPricePennies).toBe(5500);
      expect(res.body.totalAmountPennies).toBe(550000);
    });

    it("should allow supplier to accept the updated PO (normal flow)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/accept`)
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ACCEPTED");
    });

    it("should have ledger events for the full negotiation flow", async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger?entityId=${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      const types = res.body.map((e: any) => e.eventType);
      expect(types).toContain("PO_CREATED");
      expect(types).toContain("PO_SENT");
      expect(types).toContain("PO_COUNTER_PROPOSED");
      expect(types).toContain("PO_COUNTER_ACCEPTED");
      expect(types).toContain("PO_ACCEPTED");
    });
  });

  // ═════════════════════════════════════════════════════════
  //  Scenario 2: Multi-round negotiation (back-and-forth)
  // ═════════════════════════════════════════════════════════

  describe("Multi-round negotiation", () => {
    let poId: string;

    it("should support alternating counter-proposals", async () => {
      const created = await createSentPO([
        { description: "Sensor Module", quantity: 50, unitPricePennies: 20000 },
      ]);
      poId = created.poId;

      // Round 1: Supplier counters
      const r1 = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/counter`)
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          lineItems: [
            {
              description: "Sensor Module v2",
              quantity: 50,
              unitPricePennies: 22000,
            },
          ],
          notes: "v2 has better accuracy",
        });
      expect(r1.status).toBe(200);
      expect(r1.body.status).toBe("NEGOTIATION");
      expect(r1.body.currentRevision).toBe(1);

      // Round 2: Buyer counters back
      const r2 = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/counter`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          lineItems: [
            {
              description: "Sensor Module v2",
              quantity: 50,
              unitPricePennies: 21000,
            },
          ],
          notes: "Meet in the middle",
        });
      expect(r2.status).toBe(200);
      expect(r2.body.currentRevision).toBe(2);

      // Round 3: Supplier accepts the buyer's counter
      const r3 = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/accept-counter`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(r3.status).toBe(200);
      expect(r3.body.status).toBe("SENT");
      expect(r3.body.totalAmountPennies).toBe(1050000); // 50 * 21000
    });

    it("should have correct revision history", async () => {
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.revisions).toBeDefined();
      expect(res.body.revisions.length).toBe(2);

      // Revisions are ordered desc by revision number
      const rev2 = res.body.revisions.find((r: any) => r.revision === 2);
      const rev1 = res.body.revisions.find((r: any) => r.revision === 1);

      expect(rev2.proposedByRole).toBe("BUYER");
      expect(rev2.status).toBe("ACCEPTED");
      expect(rev2.amount).toBe(1050000);

      expect(rev1.proposedByRole).toBe("SUPPLIER");
      expect(rev1.status).toBe("SUPERSEDED");
    });
  });

  // ═════════════════════════════════════════════════════════
  //  Scenario 3: Supplier counter → Buyer rejects (cancels)
  // ═════════════════════════════════════════════════════════

  describe("Counter-proposal rejection (cancels PO)", () => {
    it("should cancel PO when counter-proposal is rejected", async () => {
      const { poId } = await createSentPO([
        {
          description: "Custom Bracket",
          quantity: 200,
          unitPricePennies: 1500,
        },
      ]);

      // Supplier counters
      const counterRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/counter`)
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          lineItems: [
            {
              description: "Custom Bracket (heavy duty)",
              quantity: 200,
              unitPricePennies: 3000,
            },
          ],
          notes: "Minimum viable price for this spec",
        });
      expect(counterRes.status).toBe(200);
      expect(counterRes.body.status).toBe("NEGOTIATION");

      // Buyer rejects
      const rejectRes = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/reject-counter`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe("CANCELLED");

      // Verify ledger
      const ledgerRes = await request(app.getHttpServer())
        .get(`/ledger?entityId=${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);
      const types = ledgerRes.body.map((e: any) => e.eventType);
      expect(types).toContain("PO_COUNTER_PROPOSED");
      expect(types).toContain("PO_COUNTER_REJECTED");
    });
  });

  // ═════════════════════════════════════════════════════════
  //  Guard Rails
  // ═════════════════════════════════════════════════════════

  describe("Guard rails", () => {
    it("should prevent counter-propose on DRAFT PO", async () => {
      const createRes = await request(app.getHttpServer())
        .post("/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          supplierId,
          description: "Draft PO",
          lineItems: [
            { description: "Item", quantity: 10, unitPricePennies: 10000 },
          ],
        });
      expect(createRes.status).toBe(201);
      const poId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/counter`)
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          lineItems: [
            { description: "Item", quantity: 10, unitPricePennies: 12000 },
          ],
        });
      // Supplier can't see DRAFT PO or status doesn't allow counter
      expect([400, 404]).toContain(res.status);
    });

    it("should prevent buyer from counter-proposing own SENT PO", async () => {
      const { poId } = await createSentPO([
        { description: "Item", quantity: 10, unitPricePennies: 10000 },
      ]);

      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/counter`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          lineItems: [
            { description: "Item", quantity: 10, unitPricePennies: 9000 },
          ],
        });
      // Buyer can't counter their own SENT PO — only supplier can
      expect([400, 403]).toContain(res.status);
    });

    it("should prevent accept-counter when there is no pending revision", async () => {
      const { poId } = await createSentPO([
        { description: "Item", quantity: 10, unitPricePennies: 10000 },
      ]);

      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/accept-counter`)
        .set("Authorization", `Bearer ${supplierToken}`);
      // Not in NEGOTIATION, or no PENDING revision
      expect(res.status).toBe(400);
    });

    it("should prevent reject-counter when not in NEGOTIATION", async () => {
      const { poId } = await createSentPO([
        { description: "Item", quantity: 10, unitPricePennies: 10000 },
      ]);

      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/reject-counter`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should prevent proposer from accepting own counter", async () => {
      const { poId } = await createSentPO([
        { description: "Item", quantity: 10, unitPricePennies: 10000 },
      ]);

      // Supplier counters
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/counter`)
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          lineItems: [
            { description: "Item", quantity: 10, unitPricePennies: 15000 },
          ],
        });

      // Supplier tries to accept own counter — should fail
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${poId}/accept-counter`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });
  });
});
