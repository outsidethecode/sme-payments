import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { EscrowAccountingService } from "../settlements/escrow-accounting.service";

/**
 * Phase 4 – Escrow Transaction Journal (e2e)
 *
 * Tests that every escrow balance mutation (deposit, release, fee, refund)
 * produces an EscrowTransaction record, that the running balance is consistent,
 * and that the admin endpoints for statement + verification work correctly.
 */
describe("Phase 4 – Escrow Transaction Journal (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let escrowAccounting: EscrowAccountingService;
  let buyerToken: string;
  let supplierToken: string;
  let adminToken: string;
  let buyerId: string;
  let supplierId: string;
  let escrowAccountId: string;

  const testEmails = [
    "escrow-journal-buyer@test.com",
    "escrow-journal-supplier@test.com",
    "escrow-journal-admin@test.com",
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
    escrowAccounting = app.get(EscrowAccountingService);

    // ── Clean up stale test data ──────────────────────────

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
        await prisma.organisation.deleteMany({
          where: {
            id: { in: orgIds },
            members: { none: {} },
          },
        });
      }
      await prisma.userPasskey.deleteMany({
        where: { userId: { in: existingUserIds } },
      });
      await prisma.invitation.deleteMany({
        where: { inviterUserId: { in: existingUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: existingUserIds } },
      });
    }

    // ── Register test users ─────────────────────────────────

    // Register buyer
    const buyerReg = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: testEmails[0],
        password: "Password123!",
        name: "Journal Buyer",
        companyName: "Journal Buyer Ltd",
        role: "BUYER",
      });
    buyerToken = buyerReg.body.accessToken;
    buyerId = buyerReg.body.user.id;

    // Give buyer sufficient balance for funding
    await prisma.user.update({
      where: { id: buyerId },
      data: { balance: 10_000_000 },
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
    const supplierReg = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: testEmails[1],
        password: "Password123!",
        name: "Journal Supplier",
        companyName: "Journal Supplier Ltd",
        role: "SUPPLIER",
      });
    supplierToken = supplierReg.body.accessToken;
    supplierId = supplierReg.body.user.id;

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

    // Register admin (direct Prisma — register endpoint doesn't support ADMIN)
    const bcrypt = await import("bcrypt");
    const hashedPw = await bcrypt.hash("Password123!", 12);

    const adminUser = await prisma.user.create({
      data: {
        email: testEmails[2],
        password: hashedPw,
        name: "Journal Admin",
        role: "ADMIN",
      },
    });
    const adminOrg = await prisma.organisation.create({
      data: {
        name: "Journal Admin Org",
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
      .send({ email: testEmails[2], password: "Password123!" });
    adminToken = adminLoginRes.body.accessToken;

    // ── Ensure GBP escrow account ───────────────────────────

    // Clean any pre-existing escrow transactions
    await prisma.escrowTransaction.deleteMany({});

    const escrow = await prisma.escrowAccount.upsert({
      where: { country_currency: { country: "GB", currency: "GBP" } },
      update: { balanceMinor: 0 },
      create: {
        label: "Test GBP Escrow",
        bank: "Test Bank",
        country: "GB",
        currency: "GBP",
        balanceMinor: 0,
        active: true,
      },
    });
    escrowAccountId = escrow.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  // ── Helper ──────────────────────────────────────────────

  async function createAndFundPO(
    amount = 100_000,
  ): Promise<{ poId: string; referenceNumber: string }> {
    const unitPrice = amount / 10;

    const createRes = await request(app.getHttpServer())
      .post("/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        supplierId,
        description: "Escrow journal test",
        lineItems: [
          { description: "Item", quantity: 10, unitPricePennies: unitPrice },
        ],
      });
    const poId = createRes.body.id;
    const referenceNumber = createRes.body.referenceNumber;

    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/send`)
      .set("Authorization", `Bearer ${buyerToken}`);

    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/accept`)
      .set("Authorization", `Bearer ${supplierToken}`);

    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/fund`)
      .set("Authorization", `Bearer ${buyerToken}`);

    await request(app.getHttpServer())
      .patch(`/purchase-orders/${poId}/confirm-escrow`)
      .set("Authorization", `Bearer ${adminToken}`);

    return { poId, referenceNumber };
  }

  async function advancePOToSettlement(poId: string) {
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
  }

  // ── Tests ───────────────────────────────────────────────

  describe("Deposit recording on escrow funding", () => {
    let poId: string;
    let referenceNumber: string;

    it("should record DEPOSIT transaction when PO escrow is funded", async () => {
      const result = await createAndFundPO(100_000);
      poId = result.poId;
      referenceNumber = result.referenceNumber;

      const txs = await prisma.escrowTransaction.findMany({
        where: { purchaseOrderId: poId, type: "DEPOSIT" },
      });

      expect(txs).toHaveLength(1);
      expect(txs[0].amountMinor).toBe(100_000);
      expect(txs[0].currency).toBe("GBP");
      expect(txs[0].escrowAccountId).toBe(escrowAccountId);
      expect(txs[0].counterpartyId).toBe(buyerId);
      expect(txs[0].reference).toContain("DEPOSIT");
      expect(txs[0].balanceAfter).toBeGreaterThanOrEqual(100_000);
    });

    it("should have updated escrow shadow balance to match deposit", async () => {
      const account = await prisma.escrowAccount.findUnique({
        where: { id: escrowAccountId },
      });
      expect(account!.balanceMinor).toBeGreaterThanOrEqual(100_000);
    });
  });

  describe("Release + fee recording on settlement", () => {
    let poId: string;

    it("should record RELEASE_SUPPLIER and FEE_DEDUCTION on settlement", async () => {
      const result = await createAndFundPO(100_000);
      poId = result.poId;

      await advancePOToSettlement(poId);

      const releaseTxs = await prisma.escrowTransaction.findMany({
        where: { purchaseOrderId: poId, type: "RELEASE_SUPPLIER" },
      });
      expect(releaseTxs).toHaveLength(1);

      const feeTxs = await prisma.escrowTransaction.findMany({
        where: { purchaseOrderId: poId, type: "FEE_DEDUCTION" },
      });
      expect(feeTxs).toHaveLength(1);

      // Release amount should be net (total - fee)
      const feeAmount = Math.round((100_000 * 50) / 10_000); // 0.5% = 500
      expect(releaseTxs[0].amountMinor).toBe(100_000 - feeAmount);
      expect(feeTxs[0].amountMinor).toBe(feeAmount);
    });

    it("should have three transactions total for a settled PO (DEPOSIT + RELEASE + FEE)", async () => {
      const allTxs = await prisma.escrowTransaction.findMany({
        where: { purchaseOrderId: poId },
        orderBy: { createdAt: "asc" },
      });

      expect(allTxs.length).toBe(3);
      expect(allTxs[0].type).toBe("DEPOSIT");
      expect(allTxs[1].type).toBe("RELEASE_SUPPLIER");
      expect(allTxs[2].type).toBe("FEE_DEDUCTION");
    });
  });

  describe("Balance verification", () => {
    it("should report match=true when journal matches shadow balance", async () => {
      const verification =
        await escrowAccounting.verifyBalance(escrowAccountId);
      expect(verification.match).toBe(true);
      expect(verification.transactionCount).toBeGreaterThan(0);
      expect(verification.shadowBalance).toBe(verification.computedBalance);
    });

    it("should detect mismatch when shadow balance is tampered", async () => {
      // Save original balance
      const original = await prisma.escrowAccount.findUnique({
        where: { id: escrowAccountId },
      });

      // Tamper shadow balance
      await prisma.escrowAccount.update({
        where: { id: escrowAccountId },
        data: { balanceMinor: (original!.balanceMinor || 0) + 99_999 },
      });

      const verification =
        await escrowAccounting.verifyBalance(escrowAccountId);
      expect(verification.match).toBe(false);
      expect(verification.shadowBalance).not.toBe(verification.computedBalance);

      // Restore original balance
      await prisma.escrowAccount.update({
        where: { id: escrowAccountId },
        data: { balanceMinor: original!.balanceMinor },
      });
    });
  });

  describe("Escrow statement", () => {
    it("should return an ordered list of all transactions for the escrow account", async () => {
      const statement = await escrowAccounting.getStatement(escrowAccountId);

      expect(statement.escrowAccountId).toBe(escrowAccountId);
      expect(statement.label).toBeDefined();
      expect(statement.currency).toBe("GBP");
      expect(statement.transactions.length).toBeGreaterThan(0);

      // Verify chronological ordering
      for (let i = 1; i < statement.transactions.length; i++) {
        expect(
          statement.transactions[i].createdAt.getTime(),
        ).toBeGreaterThanOrEqual(
          statement.transactions[i - 1].createdAt.getTime(),
        );
      }
    });

    it("each transaction should have a valid running balance", async () => {
      const statement = await escrowAccounting.getStatement(escrowAccountId);

      for (const tx of statement.transactions) {
        expect(typeof tx.balanceAfter).toBe("number");
        expect(tx.balanceAfter).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Admin endpoints", () => {
    it("GET /admin/escrow-accounts/:id/statement should return statement", async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/escrow-accounts/${escrowAccountId}/statement`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.escrowAccountId).toBe(escrowAccountId);
      expect(res.body.transactions).toBeDefined();
      expect(res.body.transactions.length).toBeGreaterThan(0);
    });

    it("GET /admin/escrow-accounts/:id/verify-balance should return verification", async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/escrow-accounts/${escrowAccountId}/verify-balance`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.escrowAccountId).toBe(escrowAccountId);
      expect(res.body.match).toBe(true);
      expect(res.body.transactionCount).toBeGreaterThan(0);
    });

    it("should reject non-admin access to statement endpoint", async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/escrow-accounts/${escrowAccountId}/statement`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(403);
    });

    it("should reject non-admin access to verify-balance endpoint", async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/escrow-accounts/${escrowAccountId}/verify-balance`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe("Reconciliation includes escrow journal verification", () => {
    it("should include escrowJournalVerification in reconciliation report", async () => {
      const res = await request(app.getHttpServer())
        .post("/admin/reconciliation/run")
        .set("Authorization", `Bearer ${adminToken}`);

      // If the endpoint exists
      if (res.status === 200) {
        expect(res.body.escrowJournalVerification).toBeDefined();
      }
      // If it's not exposed via HTTP, test directly
      const { ReconciliationService } = await import(
        "../settlements/reconciliation.service"
      );
      const recon = app.get(ReconciliationService);
      const report = await recon.runReconciliation();
      expect(report.escrowJournalVerification).toBeDefined();
      expect(Array.isArray(report.escrowJournalVerification)).toBe(true);
    });
  });
});
