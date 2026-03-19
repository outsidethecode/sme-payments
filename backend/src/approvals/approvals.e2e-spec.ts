import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import * as bcrypt from "bcrypt";

/**
 * Phase 1 E2E: Policy Engine & Approval Workflows
 *
 * Tests the full lifecycle:
 *   1. Auto-approve (small PO within auto-approve threshold)
 *   2. Manual approval (medium PO requiring 1 approver)
 *   3. Rejection flow
 *   4. LP funding policy enforcement
 */
describe("Approvals & Policies (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Tokens
  let buyerToken: string;
  let supplierToken: string;
  let approverToken: string;
  let lpToken: string;
  let adminToken: string;

  // IDs
  let buyerUserId: string;
  let supplierUserId: string;
  let approverUserId: string;
  let buyerOrgId: string;

  // Test user email to clean up
  const APPROVER_EMAIL = "e2e-approver@acme.co.uk";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
    const staleApprover = await prisma.user.findUnique({
      where: { email: APPROVER_EMAIL },
    });
    if (staleApprover) {
      await prisma.approval.deleteMany({
        where: { userId: staleApprover.id },
      });
      await prisma.orgMembership.deleteMany({
        where: { userId: staleApprover.id },
      });
      await prisma.user.delete({ where: { id: staleApprover.id } });
    }

    // Login as seeded UK buyer (has PO approval policies)
    const buyerRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "buyer@acme.co.uk", password: "password123" })
      .expect(201);

    buyerToken = buyerRes.body.accessToken;
    buyerUserId = buyerRes.body.user.id;
    buyerOrgId = buyerRes.body.user.organisationId;

    // Login as seeded UK supplier
    const supplierRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({
        email: "supplier@swiftlogistics.co.uk",
        password: "password123",
      })
      .expect(201);

    supplierToken = supplierRes.body.accessToken;
    supplierUserId = supplierRes.body.user.id;

    // Login as admin
    const adminRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@platform.co.uk", password: "password123" })
      .expect(201);

    adminToken = adminRes.body.accessToken;

    // Login as LP
    const lpRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "lp@capitalbridge.co.uk", password: "password123" })
      .expect(201);

    lpToken = lpRes.body.accessToken;

    // Create an APPROVER user in the buyer's org
    const hashedPw = await bcrypt.hash("password123", 12);
    const approverUser = await prisma.user.create({
      data: {
        email: APPROVER_EMAIL,
        password: hashedPw,
        name: "E2E Approver",
        role: "BUYER",
        companyName: "Acme Retail Ltd",
        balance: 0,
      },
    });
    approverUserId = approverUser.id;

    await prisma.orgMembership.create({
      data: {
        userId: approverUser.id,
        organisationId: buyerOrgId,
        orgRole: "APPROVER",
        isDefault: true,
      },
    });

    // Login as the approver
    const approverRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: APPROVER_EMAIL, password: "password123" })
      .expect(201);

    approverToken = approverRes.body.accessToken;
  });

  afterAll(async () => {
    // Clean up test POs and related data
    const testPOs = await prisma.purchaseOrder.findMany({
      where: { buyerId: buyerUserId, description: { startsWith: "E2E-" } },
    });
    for (const po of testPOs) {
      await prisma.earlyPaymentRequest.deleteMany({
        where: { purchaseOrderId: po.id },
      });
      await prisma.settlement.deleteMany({
        where: { purchaseOrderId: po.id },
      });
      await prisma.platformFee.deleteMany({
        where: { purchaseOrderId: po.id },
      });
      await prisma.paymentLock.deleteMany({
        where: { purchaseOrderId: po.id },
      });
      // Clean up approval chains
      const requests = await prisma.approvalRequest.findMany({
        where: { entityType: "PURCHASE_ORDER", entityId: po.id },
      });
      for (const req of requests) {
        await prisma.approval.deleteMany({
          where: { approvalRequestId: req.id },
        });
      }
      await prisma.approvalRequest.deleteMany({
        where: { entityType: "PURCHASE_ORDER", entityId: po.id },
      });
    }
    await prisma.purchaseOrder.deleteMany({
      where: { buyerId: buyerUserId, description: { startsWith: "E2E-" } },
    });

    // Clean up approver user (must delete event logs first due to FK)
    await prisma.eventLog.deleteMany({
      where: { actorId: approverUserId },
    });
    await prisma.approval.deleteMany({ where: { userId: approverUserId } });
    await prisma.orgMembership.deleteMany({
      where: { userId: approverUserId },
    });
    await prisma.user.delete({ where: { id: approverUserId } });

    // Clean up ledger entries created during tests
    await prisma.eventLog.deleteMany({
      where: { entityType: { in: ["PURCHASE_ORDER", "EARLY_PAYMENT"] } },
    });

    await app.close();
  });

  // ══════════════════════════════════════════════════════════════
  // Policies endpoints
  // ══════════════════════════════════════════════════════════════

  describe("GET /api/policies/org/:orgId", () => {
    it("should return policy rules for the buyer org", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/policies/org/${buyerOrgId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
      expect(
        res.body.some(
          (r: any) => r.ruleType === "PO_APPROVAL" && r.autoApprove === true,
        ),
      ).toBe(true);
    });
  });

  describe("GET /api/policies/evaluate/po-approval", () => {
    it("should indicate auto-approve for small PO", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/policies/evaluate/po-approval?amount=500000`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.requiresApproval).toBe(true);
      expect(res.body.autoApprove).toBe(true);
    });

    it("should require 1 approver for medium PO", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/policies/evaluate/po-approval?amount=2500000`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.requiresApproval).toBe(true);
      expect(res.body.autoApprove).toBe(false);
      expect(res.body.requiredApprovals).toBe(1);
      expect(res.body.requiredRoles).toContain("APPROVER");
    });

    it("should require 2 approvers for large PO", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/policies/evaluate/po-approval?amount=7500000`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.requiresApproval).toBe(true);
      expect(res.body.autoApprove).toBe(false);
      expect(res.body.requiredApprovals).toBe(2);
      expect(res.body.requiredRoles).toEqual(
        expect.arrayContaining(["APPROVER", "FINANCE"]),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Auto-approve flow (PO ≤ £10k)
  // ══════════════════════════════════════════════════════════════

  describe("Auto-approve flow", () => {
    let poId: string;

    it("should create a small PO", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          supplierId: supplierUserId,
          description: "E2E-auto-approve-test",
          lineItems: [
            {
              description: "Small item",
              quantity: 1,
              unitPricePennies: 500000,
            },
          ],
        })
        .expect(201);

      poId = res.body.id;
      expect(res.body.status).toBe("DRAFT");
      expect(res.body.totalAmountPennies).toBe(500000); // £5,000
    });

    it("should auto-approve and send directly (≤ £10k threshold)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/purchase-orders/${poId}/send`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({})
        .expect(200);

      // Should go directly to SENT (auto-approved)
      expect(res.body.status).toBe("SENT");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Manual approval flow (PO £10k–£50k → 1 approver)
  // ══════════════════════════════════════════════════════════════

  describe("Manual approval flow (1 approver)", () => {
    let poId: string;
    let approvalRequestId: string;

    it("should create a medium PO", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          supplierId: supplierUserId,
          description: "E2E-manual-approve-test",
          lineItems: [
            {
              description: "Medium item",
              quantity: 1,
              unitPricePennies: 2500000,
            },
          ],
        })
        .expect(201);

      poId = res.body.id;
      expect(res.body.totalAmountPennies).toBe(2500000); // £25,000
    });

    it("should park PO in PENDING_APPROVAL status", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/purchase-orders/${poId}/send`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({})
        .expect(200);

      expect(res.body.status).toBe("PENDING_APPROVAL");
    });

    it("should show pending approval requests for the org", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/approvals/pending")
        .set("Authorization", `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      const match = res.body.find(
        (r: any) => r.entityType === "PURCHASE_ORDER" && r.entityId === poId,
      );
      expect(match).toBeDefined();
      expect(match.status).toBe("PENDING");
      approvalRequestId = match.id;
    });

    it("should show approval request by entity", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/approvals/entity/PURCHASE_ORDER/${poId}`)
        .set("Authorization", `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(approvalRequestId);
    });

    it("should allow APPROVER to approve and auto-transition PO to SENT", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/approvals/${approvalRequestId}/decide`)
        .set("Authorization", `Bearer ${approverToken}`)
        .send({ decision: "APPROVE", comment: "Looks good" })
        .expect(201);

      expect(res.body.approvalRequest.status).toBe("APPROVED");
      expect(res.body.isComplete).toBe(true);

      // Check PO transitioned to SENT
      const poRes = await request(app.getHttpServer())
        .get(`/api/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(poRes.body.status).toBe("SENT");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Rejection flow
  // ══════════════════════════════════════════════════════════════

  describe("Rejection flow", () => {
    let poId: string;
    let approvalRequestId: string;

    it("should create and send a medium PO", async () => {
      // Create
      const createRes = await request(app.getHttpServer())
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          supplierId: supplierUserId,
          description: "E2E-rejection-test",
          lineItems: [
            {
              description: "Medium item to reject",
              quantity: 1,
              unitPricePennies: 1500000,
            },
          ],
        })
        .expect(201);

      poId = createRes.body.id;

      // Send → PENDING_APPROVAL
      const sendRes = await request(app.getHttpServer())
        .patch(`/api/purchase-orders/${poId}/send`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({})
        .expect(200);

      expect(sendRes.body.status).toBe("PENDING_APPROVAL");

      // Get approval request
      const appRes = await request(app.getHttpServer())
        .get(`/api/approvals/entity/PURCHASE_ORDER/${poId}`)
        .set("Authorization", `Bearer ${approverToken}`)
        .expect(200);

      approvalRequestId = appRes.body[0].id;
    });

    it("should reject and revert PO back to DRAFT", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/approvals/${approvalRequestId}/decide`)
        .set("Authorization", `Bearer ${approverToken}`)
        .send({ decision: "REJECT", comment: "Price too high" })
        .expect(201);

      expect(res.body.approvalRequest.status).toBe("REJECTED");
      expect(res.body.finalStatus).toBe("REJECTED");

      // PO reverts to DRAFT after rejection callback
      const poRes = await request(app.getHttpServer())
        .get(`/api/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(poRes.body.status).toBe("DRAFT");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // LP Exposure endpoint
  // ══════════════════════════════════════════════════════════════

  describe("GET /api/policies/exposure/:orgId", () => {
    it("should return LP exposure data", async () => {
      // Get the LP's org ID
      const lpMe = await request(app.getHttpServer())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${lpToken}`)
        .expect(200);

      const lpOrgId = lpMe.body.organisationId;
      if (!lpOrgId) return; // skip if LP has no org

      const res = await request(app.getHttpServer())
        .get(`/api/policies/exposure/${lpOrgId}`)
        .set("Authorization", `Bearer ${lpToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("perBuyer");
      expect(res.body).toHaveProperty("perSupplier");
      expect(res.body).toHaveProperty("count");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Approval guards
  // ══════════════════════════════════════════════════════════════

  describe("Approval guards", () => {
    it("should reject unauthenticated access to pending approvals", async () => {
      await request(app.getHttpServer())
        .get("/api/approvals/pending")
        .expect(401);
    });

    it("should reject decide with invalid decision", async () => {
      // Create a throwaway PO and approval to test against
      await request(app.getHttpServer())
        .post("/api/approvals/nonexistent-id/decide")
        .set("Authorization", `Bearer ${approverToken}`)
        .send({ decision: "INVALID" })
        .expect(400);
    });
  });
});
