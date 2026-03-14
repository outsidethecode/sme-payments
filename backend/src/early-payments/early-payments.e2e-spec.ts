import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

/**
 * E2E: Marketplace risk snapshots (Phase 7)
 *
 * Verifies that GET /early-payments/marketplace returns a `risk` object
 * for each listed early-payment request, with the expected shape.
 */
describe("Early-Payments Marketplace Risk (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let buyerToken: string;
  let supplierToken: string;
  let lpToken: string;
  let adminToken: string;
  let supplierId: string;

  const TEST_PREFIX = "risk-mkt-";

  // ── Bootstrap the real app ────────────────────────────────

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Clean up leftover data from previous runs
    await prisma.earlyPaymentRequest.deleteMany({
      where: {
        OR: [
          { supplier: { email: { startsWith: TEST_PREFIX } } },
          { purchaseOrder: { buyer: { email: { startsWith: TEST_PREFIX } } } },
        ],
      },
    });
    await prisma.purchaseOrder.deleteMany({
      where: {
        OR: [
          { buyer: { email: { startsWith: TEST_PREFIX } } },
          { supplier: { email: { startsWith: TEST_PREFIX } } },
        ],
      },
    });
    await prisma.orgMembership.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: TEST_PREFIX } },
    });

    // ── Register buyer + supplier via API ────────────────────
    const buyerRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `${TEST_PREFIX}buyer@test.com`,
        password: "Password123!",
        name: "Risk Buyer",
        companyName: "Risk Buyer Co",
        role: "BUYER",
      });
    buyerToken = buyerRes.body.accessToken;

    // Give buyer enough balance
    await prisma.user.update({
      where: { email: `${TEST_PREFIX}buyer@test.com` },
      data: { balance: 100_000_000 },
    });

    const supplierRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: `${TEST_PREFIX}supplier@test.com`,
        password: "Password123!",
        name: "Risk Supplier",
        companyName: "Risk Supplier Co",
        role: "SUPPLIER",
      });
    supplierToken = supplierRes.body.accessToken;
    supplierId = supplierRes.body.user.id;

    // ── Create LP directly via Prisma then login ─────────────
    const bcrypt = await import("bcrypt");
    const hashedPw = await bcrypt.hash("Password123!", 12);
    const lpUser = await prisma.user.create({
      data: {
        email: `${TEST_PREFIX}lp@test.com`,
        password: hashedPw,
        name: "Risk LP",
        role: "LIQUIDITY_PARTNER",
        balance: 100_000_000,
      },
    });

    // Create org + membership for LP
    const lpOrg = await prisma.organisation.create({
      data: {
        name: "Risk LP Org",
        type: "LIQUIDITY_PARTNER",
        registrationNo: "RISK-LP-001",
        jurisdiction: "KSA",
        status: "ACTIVE",
      },
    });
    await prisma.orgMembership.create({
      data: {
        userId: lpUser.id,
        organisationId: lpOrg.id,
        orgRole: "OWNER",
      },
    });

    const lpLoginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        email: `${TEST_PREFIX}lp@test.com`,
        password: "Password123!",
      });
    lpToken = lpLoginRes.body.accessToken;

    // Register admin (needed for confirm-escrow)
    const adminUser = await prisma.user.create({
      data: {
        email: `${TEST_PREFIX}admin@test.com`,
        password: hashedPw,
        name: "Risk Admin",
        role: "ADMIN",
      },
    });
    const adminOrg = await prisma.organisation.create({
      data: {
        name: "Risk Admin Org",
        type: "BUYER",
        registrationNo: "RISK-ADM-001",
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
      .post("/auth/login")
      .send({
        email: `${TEST_PREFIX}admin@test.com`,
        password: "Password123!",
      });
    adminToken = adminLoginRes.body.accessToken;

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
    const buyerMembership = await prisma.orgMembership.findFirst({
      where: { user: { email: `${TEST_PREFIX}buyer@test.com` } },
    });
    if (buyerMembership) {
      await prisma.organisation.update({
        where: { id: buyerMembership.organisationId },
        data: { bankIban: "GB29NWBK60161331926819" },
      });
    }
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  // ── Helper: create PO + accept + fund + request early payment ────

  async function createEarlyPaymentMarketplaceItem(): Promise<string> {
    // Create PO
    const createRes = await request(app.getHttpServer())
      .post("/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        supplierId,
        description: "Risk marketplace test PO",
        lineItems: [
          { description: "Widget", quantity: 5, unitPricePennies: 20_000 },
        ],
      });
    const poId = createRes.body.id;

    // Send + Accept + Fund
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/send`)
      .set("Authorization", `Bearer ${buyerToken}`);
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/accept`)
      .set("Authorization", `Bearer ${supplierToken}`);
    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/fund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    // Confirm escrow (simulates bank callback)
    const confirmRes = await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/confirm-escrow`)
      .set("Authorization", `Bearer ${adminToken}`);

    // Request early payment
    const epRes = await request(app.getHttpServer())
      .post("/early-payments")
      .set("Authorization", `Bearer ${supplierToken}`)
      .send({ purchaseOrderId: poId });

    return epRes.body.id;
  }

  // ── Tests ─────────────────────────────────────────────────

  it("marketplace returns items with risk snapshots", async () => {
    await createEarlyPaymentMarketplaceItem();

    const res = await request(app.getHttpServer())
      .get("/early-payments/marketplace")
      .set("Authorization", `Bearer ${lpToken}`)
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const item = res.body[0];
    expect(item).toHaveProperty("risk");
    expect(item.risk).toBeDefined();

    // Validate risk snapshot shape
    const risk = item.risk;
    expect(typeof risk.riskScore).toBe("number");
    expect(risk.riskScore).toBeGreaterThanOrEqual(0);
    expect(risk.riskScore).toBeLessThanOrEqual(10);

    expect(typeof risk.defaultProbability).toBe("number");
    expect(risk.defaultProbability).toBeGreaterThanOrEqual(0);
    expect(risk.defaultProbability).toBeLessThanOrEqual(100);

    expect(typeof risk.paymentLocked).toBe("boolean");
    expect(typeof risk.deliveryStatus).toBe("string");
    expect(typeof risk.buyerDisputeRate).toBe("number");
    expect(typeof risk.evidencePackAvailable).toBe("boolean");

    // expectedSettlement should be a date string or null
    expect(
      risk.expectedSettlement === null ||
        typeof risk.expectedSettlement === "string",
    ).toBe(true);
  });

  it("risk score reflects PO status (FULFILLMENT should have moderate score)", async () => {
    await createEarlyPaymentMarketplaceItem();

    const res = await request(app.getHttpServer())
      .get("/early-payments/marketplace")
      .set("Authorization", `Bearer ${lpToken}`)
      .expect(200);

    const item = res.body.find(
      (i: any) => i.risk && i.risk.deliveryStatus === "FULFILLMENT",
    );
    expect(item).toBeDefined();

    // FULFILLMENT PO with payment lock + instrument → moderate score
    expect(item.risk.riskScore).toBeGreaterThanOrEqual(2);
    expect(item.risk.riskScore).toBeLessThanOrEqual(10);
    expect(item.risk.deliveryStatus).toBe("FULFILLMENT");
    expect(item.risk.buyerDisputeRate).toBeGreaterThanOrEqual(0);
  });

  it("rejects marketplace access for SUPPLIER role", async () => {
    await request(app.getHttpServer())
      .get("/early-payments/marketplace")
      .set("Authorization", `Bearer ${supplierToken}`)
      .expect(403);
  });
});
