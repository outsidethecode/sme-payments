import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as bcrypt from "bcrypt";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrityService } from "./integrity.service";

/**
 * E2E tests for Phase 1: Financial State Consistency Rules.
 *
 * Tests the IntegrityService + GET /api/admin/integrity-check endpoint.
 * Includes deliberately planted violations to verify detection.
 */
describe("Integrity Check (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let integrityService: IntegrityService;
  let adminToken: string;
  let buyerToken: string;
  let buyerId: string;
  let supplierId: string;

  const TEST_PREFIX = "integrity-";

  // ── Setup ──────────────────────────────────────────────────

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
    integrityService = app.get(IntegrityService);

    // Clean up stale test data from previous runs
    await cleanupTestData();

    // Register buyer + supplier via API
    const buyerRes = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email: `${TEST_PREFIX}buyer@test.com`,
        password: "TestP@ss123!",
        name: "Integrity Buyer",
        companyName: "Integrity Buyer Ltd",
        role: "BUYER",
        jurisdiction: "UK",
      })
      .expect(201);
    buyerToken = buyerRes.body.accessToken;
    buyerId = buyerRes.body.user.id;

    const supplierRes = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email: `${TEST_PREFIX}supplier@test.com`,
        password: "TestP@ss123!",
        name: "Integrity Supplier",
        companyName: "Integrity Supplier Ltd",
        role: "SUPPLIER",
        jurisdiction: "UK",
      })
      .expect(201);
    supplierId = supplierRes.body.user.id;

    // Create admin directly via Prisma (register endpoint only allows BUYER/SUPPLIER)
    const hashedPw = await bcrypt.hash("TestP@ss123!", 12);
    const adminUser = await prisma.user.create({
      data: {
        email: `${TEST_PREFIX}admin@test.com`,
        password: hashedPw,
        name: "Integrity Admin",
        role: "ADMIN",
      },
    });
    const adminOrg = await prisma.organisation.create({
      data: {
        name: "Integrity Admin Org",
        type: "BUYER",
        registrationNo: "INT-ADM-001",
        jurisdiction: "UK",
        status: "ACTIVE",
      },
    });
    await prisma.orgMembership.create({
      data: {
        userId: adminUser.id,
        organisationId: adminOrg.id,
        orgRole: "OWNER",
      },
    });
    const adminLoginRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({
        email: `${TEST_PREFIX}admin@test.com`,
        password: "TestP@ss123!",
      })
      .expect(201);
    adminToken = adminLoginRes.body.accessToken;
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

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

  // ── Helper: create a PO directly in the database ──────────

  async function createTestPO(
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const po = await prisma.purchaseOrder.create({
      data: {
        referenceNumber: `INT-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        buyerId,
        supplierId,
        description: "Integrity test PO",
        lineItems: [{ description: "Widget", quantity: 1, unitPrice: 10000 }],
        amount: 10000,
        currency: "GBP",
        status: "DRAFT",
        ...overrides,
      },
    });
    return po.id;
  }

  // ── Tests ──────────────────────────────────────────────────

  describe("GET /api/admin/integrity-check", () => {
    it("should require admin auth", async () => {
      await request(app.getHttpServer())
        .get("/api/admin/integrity-check")
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(403);
    });

    it("should return clean result when no POs exist in checked states", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/admin/integrity-check")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("checkedAt");
      expect(res.body).toHaveProperty("totalChecked");
      expect(res.body).toHaveProperty("valid");
      expect(res.body).toHaveProperty("violations");
      expect(Array.isArray(res.body.violations)).toBe(true);
    });
  });

  describe("IntegrityService.verifyAllInvariants()", () => {
    // ── INV-001: FULFILLMENT PO requires LOCKED PaymentLock ──

    it("should detect INV-001: FULFILLMENT PO without PaymentLock", async () => {
      const poId = await createTestPO({ status: "FULFILLMENT" });
      // No PaymentLock created — this is the violation

      const result = await integrityService.verifyAllInvariants();
      const violation = result.violations.find(
        (v) => v.purchaseOrderId === poId && v.invariantId === "INV-001",
      );

      expect(violation).toBeDefined();
      expect(violation!.severity).toBe("CRITICAL");
      expect(violation!.actual).toContain("does not exist");

      // Cleanup
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });

    it("should detect INV-001: FULFILLMENT PO with non-LOCKED PaymentLock", async () => {
      const poId = await createTestPO({ status: "FULFILLMENT" });
      await prisma.paymentLock.create({
        data: {
          purchaseOrderId: poId,
          buyerId,
          amount: 10000,
          currency: "GBP",
          status: "PENDING", // Wrong status!
        },
      });

      const result = await integrityService.verifyAllInvariants();
      const violation = result.violations.find(
        (v) => v.purchaseOrderId === poId && v.invariantId === "INV-001",
      );

      expect(violation).toBeDefined();
      expect(violation!.severity).toBe("CRITICAL");
      expect(violation!.actual).toContain("PENDING");

      // Cleanup
      await prisma.paymentLock.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });

    it("should pass INV-001: FULFILLMENT PO with LOCKED PaymentLock", async () => {
      const poId = await createTestPO({ status: "FULFILLMENT" });
      await prisma.paymentLock.create({
        data: {
          purchaseOrderId: poId,
          buyerId,
          amount: 10000,
          currency: "GBP",
          status: "LOCKED",
        },
      });

      const result = await integrityService.verifyAllInvariants();
      const violation = result.violations.find(
        (v) => v.purchaseOrderId === poId && v.invariantId === "INV-001",
      );

      expect(violation).toBeUndefined();

      // Cleanup
      await prisma.paymentLock.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });

    // ── INV-002: SETTLED PO requires RELEASED PaymentLock ────

    it("should detect INV-002: SETTLED PO with LOCKED PaymentLock", async () => {
      const poId = await createTestPO({ status: "SETTLED" });
      await prisma.paymentLock.create({
        data: {
          purchaseOrderId: poId,
          buyerId,
          amount: 10000,
          currency: "GBP",
          status: "LOCKED", // Should be RELEASED
        },
      });

      const result = await integrityService.verifyAllInvariants();
      const violation = result.violations.find(
        (v) => v.purchaseOrderId === poId && v.invariantId === "INV-002",
      );

      expect(violation).toBeDefined();
      expect(violation!.severity).toBe("CRITICAL");

      // Cleanup
      await prisma.paymentLock.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });

    // ── INV-003: SETTLED PO requires SETTLED PaymentInstrument ─

    it("should detect INV-003: SETTLED PO without PaymentInstrument", async () => {
      const poId = await createTestPO({ status: "SETTLED" });
      // Add a valid lock so INV-002 doesn't fire
      await prisma.paymentLock.create({
        data: {
          purchaseOrderId: poId,
          buyerId,
          amount: 10000,
          currency: "GBP",
          status: "RELEASED",
        },
      });

      const result = await integrityService.verifyAllInvariants();
      const violation = result.violations.find(
        (v) => v.purchaseOrderId === poId && v.invariantId === "INV-003",
      );

      expect(violation).toBeDefined();
      expect(violation!.severity).toBe("CRITICAL");
      expect(violation!.actual).toContain("does not exist");

      // Cleanup
      await prisma.paymentLock.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });

    // ── INV-006: PaymentLock amount must match PO amount ─────

    it("should detect INV-006: PaymentLock amount mismatch", async () => {
      const poId = await createTestPO({ status: "FULFILLMENT" });
      await prisma.paymentLock.create({
        data: {
          purchaseOrderId: poId,
          buyerId,
          amount: 9999, // Wrong amount! PO is 10000
          currency: "GBP",
          status: "LOCKED",
        },
      });

      const result = await integrityService.verifyAllInvariants();
      const violation = result.violations.find(
        (v) => v.purchaseOrderId === poId && v.invariantId === "INV-006",
      );

      expect(violation).toBeDefined();
      expect(violation!.severity).toBe("HIGH");

      // Cleanup
      await prisma.paymentLock.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });

    // ── INV-007: PaymentLock currency must match PO currency ─

    it("should detect INV-007: PaymentLock currency mismatch", async () => {
      const poId = await createTestPO({
        status: "FULFILLMENT",
        currency: "GBP",
      });
      await prisma.paymentLock.create({
        data: {
          purchaseOrderId: poId,
          buyerId,
          amount: 10000,
          currency: "SAR", // Wrong currency!
          status: "LOCKED",
        },
      });

      const result = await integrityService.verifyAllInvariants();
      const violation = result.violations.find(
        (v) => v.purchaseOrderId === poId && v.invariantId === "INV-007",
      );

      expect(violation).toBeDefined();
      expect(violation!.severity).toBe("HIGH");

      // Cleanup
      await prisma.paymentLock.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });

    // ── INV-010: SHIPPED PO requires LOCKED PaymentLock ──────

    it("should detect INV-010: SHIPPED PO without PaymentLock", async () => {
      const poId = await createTestPO({ status: "SHIPPED" });

      const result = await integrityService.verifyAllInvariants();
      const violation = result.violations.find(
        (v) => v.purchaseOrderId === poId && v.invariantId === "INV-010",
      );

      expect(violation).toBeDefined();
      expect(violation!.severity).toBe("CRITICAL");

      // Cleanup
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });

    // ── Clean state: properly wired PO passes all checks ─────

    it("should report no violations for a properly wired FULFILLMENT PO", async () => {
      const poId = await createTestPO({ status: "FULFILLMENT" });
      await prisma.paymentLock.create({
        data: {
          purchaseOrderId: poId,
          buyerId,
          amount: 10000,
          currency: "GBP",
          status: "LOCKED",
        },
      });
      await prisma.paymentInstrument.create({
        data: {
          purchaseOrderId: poId,
          amount: 10000,
          currency: "GBP",
          status: "LOCKED",
        },
      });

      const result = await integrityService.verifyAllInvariants();
      const violations = result.violations.filter(
        (v) => v.purchaseOrderId === poId,
      );

      expect(violations).toHaveLength(0);

      // Cleanup
      await prisma.paymentInstrument.deleteMany({
        where: { purchaseOrderId: poId },
      });
      await prisma.paymentLock.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });

    it("should report no violations for a properly wired SETTLED PO", async () => {
      const poId = await createTestPO({ status: "SETTLED" });
      await prisma.paymentLock.create({
        data: {
          purchaseOrderId: poId,
          buyerId,
          amount: 10000,
          currency: "GBP",
          status: "RELEASED",
        },
      });
      await prisma.paymentInstrument.create({
        data: {
          purchaseOrderId: poId,
          amount: 10000,
          currency: "GBP",
          status: "SETTLED",
        },
      });

      const result = await integrityService.verifyAllInvariants();
      const violations = result.violations.filter(
        (v) => v.purchaseOrderId === poId,
      );

      expect(violations).toHaveLength(0);

      // Cleanup
      await prisma.paymentInstrument.deleteMany({
        where: { purchaseOrderId: poId },
      });
      await prisma.paymentLock.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });

    // ── Multiple violations on one PO ────────────────────────

    it("should detect multiple violations on a single PO", async () => {
      const poId = await createTestPO({ status: "FULFILLMENT" });
      // PaymentLock with wrong status AND wrong amount
      await prisma.paymentLock.create({
        data: {
          purchaseOrderId: poId,
          buyerId,
          amount: 5000, // Wrong amount (INV-006)
          currency: "GBP",
          status: "PENDING", // Wrong status (INV-001)
        },
      });

      const result = await integrityService.verifyAllInvariants();
      const violations = result.violations.filter(
        (v) => v.purchaseOrderId === poId,
      );

      // Should have at least INV-001 (wrong lock status) + INV-006 (wrong amount)
      expect(violations.length).toBeGreaterThanOrEqual(2);
      expect(violations.some((v) => v.invariantId === "INV-001")).toBe(true);
      expect(violations.some((v) => v.invariantId === "INV-006")).toBe(true);

      // Cleanup
      await prisma.paymentLock.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.delete({ where: { id: poId } });
    });
  });
});
