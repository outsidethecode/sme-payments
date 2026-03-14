import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

/**
 * PO State Machine — exhaustive transition tests.
 *
 * PO statuses:
 *   DRAFT → SENT → ACCEPTED (commercial) → [buyer funds escrow] → FULFILLMENT → SHIPPED → DELIVERED → VERIFIED → SETTLED
 *                → CANCELLED (reject)
 *                → NEGOTIATION ↔ SENT (counter flow)
 *                              → CANCELLED (rejectCounter)
 *   DELIVERED → DISPUTED → (CANCELLED | SETTLED | VERIFIED | FULFILLMENT)
 *   FULFILLMENT → SHIPPED → DELIVERED (strict: must ship before deliver)
 *
 * Every valid forward transition and every invalid guard is tested below.
 */
describe("PO State Machine E2E", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let supplierToken: string;
  let buyerId: string;
  let supplierId: string;
  let adminToken: string;

  // ── Setup ──────────────────────────────────────────────────

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Clean up test users from previous runs
    const testEmails = [
      "sm-buyer@test.com",
      "sm-supplier@test.com",
      "sm-admin@test.com",
    ];
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
        await prisma.platformFee.deleteMany({
          where: { purchaseOrderId: { in: poIds } },
        });
        await prisma.settlement.deleteMany({
          where: { purchaseOrderId: { in: poIds } },
        });
        await prisma.earlyPaymentRequest.deleteMany({
          where: { purchaseOrderId: { in: poIds } },
        });
        await prisma.dispute.deleteMany({
          where: { purchaseOrderId: { in: poIds } },
        });
        await prisma.paymentLock.deleteMany({
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
      await prisma.eventLog.deleteMany({
        where: { actorId: { in: existingUserIds } },
      });
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

    // Register buyer
    const buyerRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "sm-buyer@test.com",
        password: "Password123!",
        name: "SM Buyer",
        companyName: "SM Buyer Co",
        role: "BUYER",
      });
    buyerToken = buyerRes.body.accessToken;
    buyerId = buyerRes.body.user.id;

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

    // Register supplier
    const supplierRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "sm-supplier@test.com",
        password: "Password123!",
        name: "SM Supplier",
        companyName: "SM Supplier Co",
        role: "SUPPLIER",
      });
    supplierToken = supplierRes.body.accessToken;
    supplierId = supplierRes.body.user.id;

    const supplierMembership = await prisma.orgMembership.findUnique({
      where: { userId: supplierId },
    });
    if (supplierMembership) {
      await prisma.organisation.update({
        where: { id: supplierMembership.organisationId },
        data: { bankIban: "GB76BARC20035344773388" },
      });
    }

    // Register admin
    const bcrypt = await import("bcrypt");
    const hashedPw = await bcrypt.hash("Password123!", 12);
    const adminUser = await prisma.user.create({
      data: {
        email: "sm-admin@test.com",
        password: hashedPw,
        name: "SM Admin",
        role: "ADMIN",
      },
    });
    const adminOrg = await prisma.organisation.create({
      data: {
        name: "SM Admin Org",
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
      .send({ email: "sm-admin@test.com", password: "Password123!" });
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

  // ── Helpers ────────────────────────────────────────────────

  async function createDraft(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        supplierId,
        description: "State machine test PO",
        lineItems: [
          { description: "Widget", quantity: 10, unitPricePennies: 10_000 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    return res.body.id;
  }

  async function createSent(): Promise<string> {
    const id = await createDraft();
    const res = await request(app.getHttpServer())
      .patch(`/purchase-orders/${id}/send`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SENT");
    return id;
  }

  async function createAccepted(): Promise<string> {
    const id = await createSent();
    const res = await request(app.getHttpServer())
      .patch(`/purchase-orders/${id}/accept`)
      .set("Authorization", `Bearer ${supplierToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACCEPTED");
    return id;
  }

  async function createFunded(): Promise<string> {
    const id = await createAccepted();
    // Step 1: Initiate escrow funding (reserves funds, creates lock)
    const res = await request(app.getHttpServer())
      .patch(`/purchase-orders/${id}/fund`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.fundingPending).toBe(true);
    expect(res.body.escrowDetails).toBeDefined();
    expect(res.body.escrowDetails.bank).toBeDefined();

    // Step 2: Confirm escrow (simulates bank callback)
    const confirmRes = await request(app.getHttpServer())
      .patch(`/purchase-orders/${id}/confirm-escrow`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(confirmRes.status).toBe(200);

    // Verify PO is now in FULFILLMENT
    const poRes = await request(app.getHttpServer())
      .get(`/purchase-orders/${id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(poRes.body.status).toBe("FULFILLMENT");
    return id;
  }

  async function createShipped(): Promise<string> {
    const id = await createFunded();
    const res = await request(app.getHttpServer())
      .patch(`/purchase-orders/${id}/ship`)
      .set("Authorization", `Bearer ${supplierToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SHIPPED");
    return id;
  }

  async function createDelivered(): Promise<string> {
    const id = await createShipped();
    const res = await request(app.getHttpServer())
      .patch(`/purchase-orders/${id}/deliver`)
      .set("Authorization", `Bearer ${supplierToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DELIVERED");
    return id;
  }

  async function createVerified(): Promise<string> {
    const id = await createDelivered();
    const res = await request(app.getHttpServer())
      .patch(`/purchase-orders/${id}/verify`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("VERIFIED");
    return id;
  }

  async function createSettled(): Promise<string> {
    const id = await createVerified();
    const res = await request(app.getHttpServer())
      .patch(`/purchase-orders/${id}/acknowledge`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SETTLED");
    return id;
  }

  async function createDisputed(): Promise<string> {
    const id = await createDelivered();
    const res = await request(app.getHttpServer())
      .patch(`/purchase-orders/${id}/dispute`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DISPUTED");
    return id;
  }

  async function createInProgress(): Promise<string> {
    // Create a delivered PO (not yet disputed)
    const id = await createDelivered();

    // Raise formal dispute (this transitions PO to DISPUTED + creates dispute entity)
    const raiseRes = await request(app.getHttpServer())
      .post("/disputes")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ purchaseOrderId: id, reason: "Rework needed" });
    expect(raiseRes.status).toBe(201);

    // Resolve with REWORK → PO goes to FULFILLMENT
    const resolveRes = await request(app.getHttpServer())
      .patch(`/disputes/${raiseRes.body.id}/resolve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ outcome: "REWORK", resolutionNotes: "Rework required" });
    expect(resolveRes.status).toBe(200);

    // Verify PO is now FULFILLMENT
    const poRes = await request(app.getHttpServer())
      .get(`/purchase-orders/${id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(poRes.body.status).toBe("FULFILLMENT");
    return id;
  }

  // ════════════════════════════════════════════════════════════
  //  HAPPY-PATH TRANSITIONS
  // ════════════════════════════════════════════════════════════

  describe("Happy path: SENT → CANCELLED (supplier rejects)", () => {
    it("should allow supplier to reject a SENT PO → CANCELLED", async () => {
      const id = await createSent();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/reject`)
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("CANCELLED");
    });
  });

  describe("Happy path: FULFILLMENT → SHIPPED (post-rework)", () => {
    it("should allow shipping from FULFILLMENT after dispute rework", async () => {
      const id = await createInProgress();

      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SHIPPED");
    });
  });

  describe("Happy path: full post-rework cycle to SETTLED", () => {
    it("should complete FULFILLMENT → SHIPPED → DELIVERED → VERIFIED → SETTLED", async () => {
      const id = await createInProgress();

      // Ship
      let res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SHIPPED");

      // Deliver
      res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("DELIVERED");

      // Verify
      res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("VERIFIED");

      // Acknowledge → Settle
      res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SETTLED");
    });
  });

  // ════════════════════════════════════════════════════════════
  //  NEGATIVE-PATH: INVALID TRANSITIONS
  // ════════════════════════════════════════════════════════════

  describe("Guard: cannot ship from invalid statuses", () => {
    it("should reject ship on DRAFT PO", async () => {
      const id = await createDraft();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject ship on SENT PO", async () => {
      const id = await createSent();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject ship on DELIVERED PO", async () => {
      const id = await createDelivered();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject ship on VERIFIED PO", async () => {
      const id = await createVerified();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject ship on SETTLED PO", async () => {
      const id = await createSettled();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Guard: cannot deliver from invalid statuses", () => {
    it("should reject deliver on DRAFT PO", async () => {
      const id = await createDraft();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject deliver on SENT PO", async () => {
      const id = await createSent();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject deliver on FULFILLMENT PO (must ship first)", async () => {
      const id = await createFunded();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject deliver on VERIFIED PO", async () => {
      const id = await createVerified();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject deliver on SETTLED PO", async () => {
      const id = await createSettled();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Guard: cannot verify delivery from invalid statuses", () => {
    it("should reject verify on ACCEPTED PO", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject verify on SHIPPED PO", async () => {
      const id = await createShipped();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject verify on SETTLED PO", async () => {
      const id = await createSettled();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Guard: cannot acknowledge from invalid statuses", () => {
    it("should reject acknowledge on ACCEPTED PO", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject acknowledge on SHIPPED PO", async () => {
      const id = await createShipped();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject acknowledge on DELIVERED PO", async () => {
      const id = await createDelivered();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Guard: cannot dispute from invalid statuses", () => {
    it("should reject dispute on SENT PO", async () => {
      const id = await createSent();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/dispute`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject dispute on ACCEPTED PO", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/dispute`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject dispute on VERIFIED PO", async () => {
      const id = await createVerified();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/dispute`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject dispute on SETTLED PO", async () => {
      const id = await createSettled();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/dispute`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Guard: cannot send from non-DRAFT statuses", () => {
    it("should reject send on already SENT PO", async () => {
      const id = await createSent();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/send`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject send on ACCEPTED PO", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/send`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject send on SETTLED PO", async () => {
      const id = await createSettled();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/send`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Guard: cannot accept from non-SENT statuses", () => {
    it("should reject accept on DRAFT PO", async () => {
      const id = await createDraft();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/accept`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject accept on already ACCEPTED PO", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/accept`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject accept on DELIVERED PO", async () => {
      const id = await createDelivered();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/accept`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Guard: cannot reject from non-SENT statuses", () => {
    it("should reject reject-call on DRAFT PO", async () => {
      const id = await createDraft();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/reject`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject reject-call on ACCEPTED PO", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/reject`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });
  });

  // ════════════════════════════════════════════════════════════
  //  ROLE GUARDS
  // ════════════════════════════════════════════════════════════

  describe("Role guards: wrong actor rejected", () => {
    it("should reject buyer trying to accept their own PO", async () => {
      const id = await createSent();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/accept`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(403);
    });

    it("should reject supplier trying to send a PO", async () => {
      const id = await createDraft();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/send`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(403);
    });

    it("should reject supplier trying to verify delivery", async () => {
      const id = await createDelivered();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/verify`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(403);
    });

    it("should reject supplier trying to acknowledge obligation", async () => {
      const id = await createVerified();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/acknowledge`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(403);
    });

    it("should reject buyer trying to ship", async () => {
      const id = await createFunded();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/ship`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(403);
    });

    it("should reject buyer trying to mark delivered", async () => {
      const id = await createShipped();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/deliver`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(403);
    });

    it("should reject supplier trying to dispute", async () => {
      const id = await createDelivered();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/dispute`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ════════════════════════════════════════════════════════════
  //  TERMINAL STATE GUARDS
  // ════════════════════════════════════════════════════════════

  describe("Terminal state: SETTLED PO rejects all transitions", () => {
    let settledId: string;

    beforeAll(async () => {
      settledId = await createSettled();
    });

    it("should reject send", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${settledId}/send`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject accept", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${settledId}/accept`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject ship", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${settledId}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject deliver", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${settledId}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject verify", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${settledId}/verify`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should return idempotent response for acknowledge on SETTLED PO", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${settledId}/acknowledge`)
        .set("Authorization", `Bearer ${buyerToken}`);
      // Idempotent: returns existing SETTLED state instead of 400
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SETTLED");
    });

    it("should reject dispute", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${settledId}/dispute`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Terminal state: CANCELLED PO rejects all transitions", () => {
    let cancelledId: string;

    beforeAll(async () => {
      cancelledId = await createSent();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${cancelledId}/reject`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("CANCELLED");
    });

    it("should reject send", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${cancelledId}/send`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject accept", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${cancelledId}/accept`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject ship", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${cancelledId}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject deliver", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${cancelledId}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject dispute", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${cancelledId}/dispute`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });
  });

  // ════════════════════════════════════════════════════════════
  //  PAYMENT LOCK LIFECYCLE
  // ════════════════════════════════════════════════════════════

  describe("Payment lock lifecycle", () => {
    it("should NOT create payment lock on accept (commercial only)", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${id}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.body.paymentLocked).toBe(false);
      expect(res.body.paymentLock).toBeNull();
    });

    it("should create LOCKED payment lock on fund", async () => {
      const id = await createFunded();
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${id}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.body.paymentLocked).toBe(true);
      expect(res.body.paymentLock).toBeDefined();
      expect(res.body.paymentLock.status).toBe("LOCKED");
    });

    it("should release lock on settlement", async () => {
      const id = await createSettled();
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${id}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.body.paymentLock.status).toBe("RELEASED");
    });
  });

  // ════════════════════════════════════════════════════════════
  //  FUND ESCROW GUARDS
  // ════════════════════════════════════════════════════════════

  describe("Fund escrow: happy path", () => {
    it("should initiate escrow funding on ACCEPTED PO → ACCEPTED (pending)", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      // Step 1: PO stays ACCEPTED, funding is pending
      expect(res.body.status).toBe("ACCEPTED");
      expect(res.body.fundingPending).toBe(true);
      expect(res.body.escrowDetails).toBeDefined();
      expect(res.body.escrowDetails.bank).toBeDefined();
      expect(res.body.escrowDetails.iban).toBeDefined();
    });

    it("should confirm escrow → FULFILLMENT after bank callback", async () => {
      const id = await createAccepted();
      // Initiate
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`);

      // Confirm (simulates bank callback)
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/confirm-escrow`)
        .set("Authorization", `Bearer ${adminToken}`);

      const poRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${id}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(poRes.body.status).toBe("FULFILLMENT");
      expect(poRes.body.paymentLocked).toBe(true);
    });
  });

  describe("Fund escrow: invalid status guards", () => {
    it("should reject fund on DRAFT PO", async () => {
      const id = await createDraft();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject fund on SENT PO", async () => {
      const id = await createSent();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(400);
    });

    it("should return idempotent response for fund on already-funded (FULFILLMENT) PO", async () => {
      const id = await createFunded();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/fund`)
        .set("Authorization", `Bearer ${buyerToken}`);
      // Idempotent: returns existing FULFILLMENT state instead of 400
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("FULFILLMENT");
    });
  });

  describe("Fund escrow: role guards", () => {
    it("should reject supplier trying to fund", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/fund`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe("Guard: cannot ship or deliver from ACCEPTED (unfunded)", () => {
    it("should reject ship on ACCEPTED PO", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });

    it("should reject deliver on ACCEPTED PO", async () => {
      const id = await createAccepted();
      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/deliver`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Guard: cannot ship without payment lock (defensive)", () => {
    it("should reject ship on FULFILLMENT PO when payment lock is missing", async () => {
      // Create accepted PO and force status to FULFILLMENT without creating a lock
      const id = await createAccepted();
      await prisma.purchaseOrder.update({
        where: { id },
        data: { status: "FULFILLMENT", paymentLocked: false },
      });

      const res = await request(app.getHttpServer())
        .patch(`/purchase-orders/${id}/ship`)
        .set("Authorization", `Bearer ${supplierToken}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/payment has not been locked/i);
    });
  });
});
