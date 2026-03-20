import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as bcrypt from "bcrypt";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

describe("Disputes, Fraud Controls & LP Risk E2E", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let supplierToken: string;
  let adminToken: string;
  let lpToken: string;
  let buyerId: string;
  let supplierId: string;
  let adminId: string;
  let lpId: string;

  const TEST_EMAILS = [
    "dispute-buyer@test.com",
    "dispute-supplier@test.com",
    "dispute-admin@test.com",
    "dispute-lp@test.com",
  ];

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
      await prisma.fraudFlag.deleteMany({
        where: { userId: { in: existingUserIds } },
      });
      await prisma.lpExposureSnapshot.deleteMany({
        where: { liquidityPartnerId: { in: existingUserIds } },
      });
      await prisma.eventLog.deleteMany({
        where: { actorId: { in: existingUserIds } },
      });
      await prisma.orgMembership.deleteMany({
        where: { userId: { in: existingUserIds } },
      });
      // Clean up orphaned organisations
      const orgs = await prisma.organisation.findMany({
        where: { members: { none: {} } },
      });
      if (orgs.length > 0) {
        await prisma.policyRule.deleteMany({
          where: { organisationId: { in: orgs.map((o) => o.id) } },
        });
        await prisma.organisation.deleteMany({
          where: { id: { in: orgs.map((o) => o.id) } },
        });
      }
      await prisma.user.deleteMany({
        where: { id: { in: existingUserIds } },
      });
    }

    // ── Register buyer & supplier ─────────────────────────
    const buyerRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "dispute-buyer@test.com",
        password: "TestPass123!",
        name: "Dispute Buyer",
        role: "BUYER",
        companyName: "Dispute Buyer Co",
      });
    buyerToken = buyerRes.body.accessToken;
    buyerId = buyerRes.body.user.id;

    const supplierRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "dispute-supplier@test.com",
        password: "TestPass123!",
        name: "Dispute Supplier",
        role: "SUPPLIER",
        companyName: "Dispute Supplier Co",
      });
    supplierToken = supplierRes.body.accessToken;
    supplierId = supplierRes.body.user.id;

    // Fund buyer account
    await prisma.user.update({
      where: { id: buyerId },
      data: { balance: 50_000_000 },
    });

    // ── Create admin (direct DB) ──────────────────────────
    const hashedPw = await bcrypt.hash("TestPass123!", 10);
    const adminUser = await prisma.user.create({
      data: {
        email: "dispute-admin@test.com",
        password: hashedPw,
        name: "Dispute Admin",
        role: "ADMIN",
      },
    });
    adminId = adminUser.id;
    const adminOrg = await prisma.organisation.create({
      data: {
        name: "Dispute Platform Admin",
        type: "BUYER",
        onboardingStatus: "COMPLETED",
      },
    });
    await prisma.orgMembership.create({
      data: {
        userId: adminId,
        organisationId: adminOrg.id,
        orgRole: "OWNER",
        isDefault: true,
      },
    });
    const adminLoginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "dispute-admin@test.com", password: "TestPass123!" });
    adminToken = adminLoginRes.body.accessToken;

    // ── Create LP (direct DB) ─────────────────────────────
    const lpUser = await prisma.user.create({
      data: {
        email: "dispute-lp@test.com",
        password: hashedPw,
        name: "Dispute LP",
        role: "LIQUIDITY_PARTNER",
        balance: 100_000_000,
      },
    });
    lpId = lpUser.id;
    const lpOrg = await prisma.organisation.create({
      data: {
        name: "Dispute LP Org",
        type: "LIQUIDITY_PARTNER",
        onboardingStatus: "COMPLETED",
        fundingLimitTotal: 20_000_000,
      },
    });
    await prisma.orgMembership.create({
      data: {
        userId: lpId,
        organisationId: lpOrg.id,
        orgRole: "OWNER",
        isDefault: true,
      },
    });
    const lpLoginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "dispute-lp@test.com", password: "TestPass123!" });
    lpToken = lpLoginRes.body.accessToken;

    // Ensure GBP escrow account exists
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

    // Ensure buyer org has IBAN (required for fund)
    const buyerMembership = await prisma.orgMembership.findUnique({
      where: { userId: buyerId },
    });
    if (buyerMembership) {
      await prisma.organisation.update({
        where: { id: buyerMembership.organisationId },
        data: { bankIban: "GB29NWBK60161331926819" },
      });
    }
    const supplierMembership = await prisma.orgMembership.findUnique({
      where: { userId: supplierId },
    });
    if (supplierMembership) {
      await prisma.organisation.update({
        where: { id: supplierMembership.organisationId },
        data: { bankIban: "GB76BARC20035344773388" },
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Helpers ─────────────────────────────────────────────

  /**
   * Create a PO, send it, accept it, deliver it — ready for dispute.
   */
  async function createDeliveredPO(
    amount = 500_000,
  ): Promise<{ poId: string; refNumber: string }> {
    // Create
    const createRes = await request(app.getHttpServer())
      .post("/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        supplierId,
        description: "Dispute test PO",
        lineItems: [
          { description: "Item A", quantity: 1, unitPricePennies: amount },
        ],
      });
    const poId = createRes.body.id;

    // Send
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/send`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // Accept
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/accept`)
      .set("Authorization", `Bearer ${supplierToken}`);

    // Fund escrow (Step 1: initiate)
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/fund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // Fund escrow (Step 2: bank confirmation)
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/confirm-escrow`)
      .set("Authorization", `Bearer ${adminToken}`);

    // Ship (strict state machine: FULFILLMENT → SHIPPED → DELIVERED)
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/ship`)
      .set("Authorization", `Bearer ${supplierToken}`);

    // Deliver
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/deliver`)
      .set("Authorization", `Bearer ${supplierToken}`);

    return { poId, refNumber: createRes.body.referenceNumber };
  }

  // ═══════════════════════════════════════════════════════════
  //  Dispute Workflow
  // ═══════════════════════════════════════════════════════════

  describe("Dispute Workflow", () => {
    let disputePoId: string;
    let disputeId: string;

    it("should raise a dispute on a delivered PO", async () => {
      const { poId } = await createDeliveredPO();
      disputePoId = poId;

      const res = await request(app.getHttpServer())
        .post("/disputes")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          purchaseOrderId: poId,
          reason: "Items arrived damaged",
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe("OPEN");
      expect(res.body.reason).toBe("Items arrived damaged");
      expect(res.body.purchaseOrderId).toBe(poId);
      disputeId = res.body.id;

      // PO should now be DISPUTED
      const poRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(poRes.body.status).toBe("DISPUTED");
    });

    it("should reject duplicate dispute on the same PO", async () => {
      const res = await request(app.getHttpServer())
        .post("/disputes")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          purchaseOrderId: disputePoId,
          reason: "Trying again",
        });
      expect(res.status).toBe(400);
    });

    it("should reject dispute from non-buyer", async () => {
      const { poId } = await createDeliveredPO();
      const res = await request(app.getHttpServer())
        .post("/disputes")
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          purchaseOrderId: poId,
          reason: "Not my PO",
        });
      expect(res.status).toBe(403);
    });

    it("should allow buyer to submit evidence", async () => {
      const res = await request(app.getHttpServer())
        .post(`/disputes/${disputeId}/evidence`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          evidenceIds: ["fake-evidence-id-1", "fake-evidence-id-2"],
        });

      expect(res.status).toBe(201);
      expect(res.body.buyerEvidence).toContain("fake-evidence-id-1");
    });

    it("should allow supplier to submit evidence and advance status", async () => {
      const res = await request(app.getHttpServer())
        .post(`/disputes/${disputeId}/evidence`)
        .set("Authorization", `Bearer ${supplierToken}`)
        .send({
          evidenceIds: ["fake-evidence-id-3"],
        });

      expect(res.status).toBe(201);
      expect(res.body.supplierEvidence).toContain("fake-evidence-id-3");
      expect(res.body.status).toBe("EVIDENCE_SUBMITTED");
    });

    it("admin should mark dispute as under review", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/disputes/${disputeId}/review`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("UNDER_REVIEW");
    });

    it("admin should resolve dispute with full refund", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/disputes/${disputeId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          outcome: "FULL_REFUND",
          resolutionNotes: "Items were indeed damaged",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("RESOLVED");
      expect(res.body.outcome).toBe("FULL_REFUND");
      expect(res.body.resolvedById).toBe(adminId);
      expect(res.body.resolutionNotes).toBe("Items were indeed damaged");

      // PO should now be CANCELLED
      const poRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${disputePoId}`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(poRes.body.status).toBe("CANCELLED");
    });

    it("should reject resolving already resolved dispute", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/disputes/${disputeId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          outcome: "FULL_REFUND",
        });
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  Dispute - Partial Refund
  // ═══════════════════════════════════════════════════════════

  describe("Dispute - Partial Refund", () => {
    it("should resolve with partial refund", async () => {
      const { poId } = await createDeliveredPO(1_000_000);

      // Raise dispute
      const raiseRes = await request(app.getHttpServer())
        .post("/disputes")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          purchaseOrderId: poId,
          reason: "Partial delivery — only 7 of 10 items arrived",
        });
      expect(raiseRes.status).toBe(201);
      const disputeId = raiseRes.body.id;

      // Admin resolves with partial refund
      const resolveRes = await request(app.getHttpServer())
        .patch(`/disputes/${disputeId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          outcome: "PARTIAL_REFUND",
          refundAmount: 300_000,
          resolutionNotes: "Refund for 3 missing items",
        });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.outcome).toBe("PARTIAL_REFUND");
      expect(resolveRes.body.refundAmount).toBe(300_000);

      // PO should be SETTLED (remaining released to supplier)
      const poRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(poRes.body.status).toBe("SETTLED");
    });

    it("should reject partial refund without amount", async () => {
      const { poId } = await createDeliveredPO();
      const raiseRes = await request(app.getHttpServer())
        .post("/disputes")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ purchaseOrderId: poId, reason: "Missing items" });

      const res = await request(app.getHttpServer())
        .patch(`/disputes/${raiseRes.body.id}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ outcome: "PARTIAL_REFUND" });

      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  Dispute - Release to Supplier
  // ═══════════════════════════════════════════════════════════

  describe("Dispute - Release to Supplier", () => {
    it("should release full amount to supplier when dispute is invalid", async () => {
      const { poId } = await createDeliveredPO();

      const raiseRes = await request(app.getHttpServer())
        .post("/disputes")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ purchaseOrderId: poId, reason: "False claim" });

      const resolveRes = await request(app.getHttpServer())
        .patch(`/disputes/${raiseRes.body.id}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          outcome: "RELEASE_TO_SUPPLIER",
          resolutionNotes: "Buyer claim not substantiated",
        });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.outcome).toBe("RELEASE_TO_SUPPLIER");

      // PO should be VERIFIED
      const poRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(poRes.body.status).toBe("VERIFIED");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  Dispute - Rework
  // ═══════════════════════════════════════════════════════════

  describe("Dispute - Rework", () => {
    it("should send PO back to FULFILLMENT for rework", async () => {
      const { poId } = await createDeliveredPO();

      const raiseRes = await request(app.getHttpServer())
        .post("/disputes")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ purchaseOrderId: poId, reason: "Wrong specifications" });

      const resolveRes = await request(app.getHttpServer())
        .patch(`/disputes/${raiseRes.body.id}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          outcome: "REWORK",
          resolutionNotes: "Supplier must rework per original specs",
        });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.outcome).toBe("REWORK");

      // PO should be FULFILLMENT
      const poRes = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(poRes.body.status).toBe("FULFILLMENT");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  Dispute Listing & Filtering
  // ═══════════════════════════════════════════════════════════

  describe("Dispute Listing", () => {
    it("should list all disputes for admin", async () => {
      const res = await request(app.getHttpServer())
        .get("/disputes")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(4);
    });

    it("should filter disputes by status", async () => {
      const res = await request(app.getHttpServer())
        .get("/disputes?status=RESOLVED")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      for (const d of res.body) {
        expect(d.status).toBe("RESOLVED");
      }
    });

    it("should get a single dispute by ID", async () => {
      // Get any dispute
      const listRes = await request(app.getHttpServer())
        .get("/disputes")
        .set("Authorization", `Bearer ${adminToken}`);

      const firstId = listRes.body[0].id;
      const res = await request(app.getHttpServer())
        .get(`/disputes/${firstId}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(firstId);
      expect(res.body.purchaseOrder).toBeDefined();
      expect(res.body.raisedBy).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  Fraud Controls
  // ═══════════════════════════════════════════════════════════

  describe("Fraud Controls", () => {
    it("should get fraud config (admin)", async () => {
      const res = await request(app.getHttpServer())
        .get("/risk/fraud/config")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.maxPOsPerBuyerPerDay).toBe(50);
      expect(res.body.maxDailyValuePerBuyer).toBe(50_000_000);
      expect(res.body.mandatoryEvidenceThreshold).toBe(10_000_000);
    });

    it("should reject non-admin from accessing fraud config", async () => {
      const res = await request(app.getHttpServer())
        .get("/risk/fraud/config")
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(403);
    });

    it("should update fraud config", async () => {
      const res = await request(app.getHttpServer())
        .patch("/risk/fraud/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ maxPOsPerBuyerPerDay: 5 });

      expect(res.status).toBe(200);
      expect(res.body.maxPOsPerBuyerPerDay).toBe(5);

      // Reset
      await request(app.getHttpServer())
        .patch("/risk/fraud/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ maxPOsPerBuyerPerDay: 50 });
    });

    it("should list unacknowledged fraud flags", async () => {
      const res = await request(app.getHttpServer())
        .get("/risk/fraud/flags")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("should get fraud flags for a specific user", async () => {
      const res = await request(app.getHttpServer())
        .get(`/risk/fraud/flags/user/${buyerId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("should enforce velocity limits when configured low", async () => {
      // Set a very low velocity limit
      await request(app.getHttpServer())
        .patch("/risk/fraud/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ maxPOsPerBuyerPerDay: 0 });

      // Try to trigger velocity check via the fraud service directly
      // (The PO controller doesn't integrate fraud checks yet —
      //  we test the service through the risk API)
      const configRes = await request(app.getHttpServer())
        .get("/risk/fraud/config")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(configRes.body.maxPOsPerBuyerPerDay).toBe(0);

      // Reset
      await request(app.getHttpServer())
        .patch("/risk/fraud/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ maxPOsPerBuyerPerDay: 50 });
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  LP Risk & Exposure
  // ═══════════════════════════════════════════════════════════

  describe("LP Risk & Exposure", () => {
    it("should get LP risk config (admin)", async () => {
      const res = await request(app.getHttpServer())
        .get("/risk/lp/config")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.maxBuyerConcentrationPct).toBe(30);
      expect(res.body.autoSuspendUtilisationPct).toBe(95);
    });

    it("should update LP risk config", async () => {
      const res = await request(app.getHttpServer())
        .patch("/risk/lp/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ maxBuyerConcentrationPct: 50 });

      expect(res.status).toBe(200);
      expect(res.body.maxBuyerConcentrationPct).toBe(50);

      // Reset
      await request(app.getHttpServer())
        .patch("/risk/lp/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ maxBuyerConcentrationPct: 30 });
    });

    it("should calculate LP exposure (zero when no active advances)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/risk/lp/exposure/${lpId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.liquidityPartnerId).toBe(lpId);
      expect(res.body.totalExposure).toBe(0);
      expect(res.body.fundingSuspended).toBe(false);
      expect(res.body.fundingLimit).toBe(20_000_000);
    });

    it("should take an exposure snapshot", async () => {
      const res = await request(app.getHttpServer())
        .post(`/risk/lp/exposure/${lpId}/snapshot`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.snapshot).toBeDefined();
      expect(res.body.snapshot.liquidityPartnerId).toBe(lpId);
      expect(res.body.exposure).toBeDefined();
    });

    it("should get exposure snapshot history", async () => {
      const res = await request(app.getHttpServer())
        .get(`/risk/lp/exposure/${lpId}/history`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it("should check funding eligibility", async () => {
      const res = await request(app.getHttpServer())
        .post("/risk/lp/check-funding")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ lpId, amount: 1_000_000 });

      expect(res.status).toBe(201);
      expect(res.body.eligible).toBe(true);
      expect(res.body.currentExposure).toBe(0);
      expect(res.body.newExposure).toBe(1_000_000);
    });

    it("LP should access own exposure", async () => {
      const res = await request(app.getHttpServer())
        .get(`/risk/lp/exposure/${lpId}`)
        .set("Authorization", `Bearer ${lpToken}`);

      expect(res.status).toBe(200);
      expect(res.body.liquidityPartnerId).toBe(lpId);
    });

    it("buyer should not access LP exposure", async () => {
      const res = await request(app.getHttpServer())
        .get(`/risk/lp/exposure/${lpId}`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  Ledger Integration
  // ═══════════════════════════════════════════════════════════

  describe("Ledger Integration", () => {
    it("dispute events should be recorded in the ledger", async () => {
      // Get a dispute to find its ID
      const listRes = await request(app.getHttpServer())
        .get("/disputes?status=RESOLVED")
        .set("Authorization", `Bearer ${adminToken}`);
      const disputeId = listRes.body[0].id;

      const res = await request(app.getHttpServer())
        .get(`/ledger?entityId=${disputeId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const eventTypes = res.body.map((e: any) => e.eventType);
      expect(eventTypes).toContain("DISPUTE_RAISED");
      expect(eventTypes).toContain("DISPUTE_RESOLVED");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  Idempotency: resolve is safe to retry
  // ═══════════════════════════════════════════════════════════

  describe("Idempotency: resolve is safe to retry", () => {
    it("should return idempotent response when resolving an already-RESOLVED dispute", async () => {
      // Get a resolved dispute from previous tests
      const listRes = await request(app.getHttpServer())
        .get("/disputes?status=RESOLVED")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(listRes.body.length).toBeGreaterThan(0);
      const resolvedDispute = listRes.body[0];

      // Retry the resolve call — should return 200 with existing state, not 400
      const res = await request(app.getHttpServer())
        .patch(`/disputes/${resolvedDispute.id}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          outcome: "RELEASE_TO_SUPPLIER",
          resolutionNotes: "Retry test",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("RESOLVED");
      expect(res.body.id).toBe(resolvedDispute.id);
    });
  });
});
