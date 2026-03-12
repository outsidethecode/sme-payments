import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

describe("Evidence & PO Extended Fields E2E", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let supplierToken: string;
  let buyerId: string;
  let supplierId: string;
  let poId: string;

  const TEST_EMAILS = ["evidence-buyer@test.com", "evidence-supplier@test.com"];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Clean up test-specific data
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
      // Also delete any remaining event logs referencing these users
      await prisma.eventLog.deleteMany({
        where: { actorId: { in: existingUserIds } },
      });
      await prisma.orgMembership.deleteMany({
        where: { userId: { in: existingUserIds } },
      });
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

    // Register buyer
    const buyerRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "evidence-buyer@test.com",
        password: "TestPass123!",
        name: "Evidence Buyer",
        role: "BUYER",
        companyName: "Evidence Buyer Co",
      });
    buyerToken = buyerRes.body.accessToken;
    buyerId = buyerRes.body.user.id;

    // Register supplier
    const supplierRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "evidence-supplier@test.com",
        password: "TestPass123!",
        name: "Evidence Supplier",
        role: "SUPPLIER",
        companyName: "Evidence Supplier Co",
      });
    supplierToken = supplierRes.body.accessToken;
    supplierId = supplierRes.body.user.id;

    // Fund buyer account
    await prisma.user.update({
      where: { id: buyerId },
      data: { balance: 10_000_000 },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── PO Extended Fields ──────────────────────────────────────

  describe("PO creation with extended fields", () => {
    it("should create PO with payment terms and delivery details", async () => {
      const res = await request(app.getHttpServer())
        .post("/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          supplierId,
          description: "Extended PO with terms",
          lineItems: [
            { description: "Widget A", quantity: 10, unitPricePennies: 10000 },
            { description: "Widget B", quantity: 5, unitPricePennies: 20000 },
          ],
          externalPoNumber: "EXT-PO-2025-001",
          paymentTerms: "NET_30",
          deliveryTerms: "DDP",
          deliveryTermsNote: "Leave at loading dock",
          deliveryAddress: "456 Industrial Ave, Riyadh, KSA",
          taxRate: 1500, // 15% VAT in BPS
          disputeWindowHours: 48,
          partialAcceptanceAllowed: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.externalPoNumber).toBe("EXT-PO-2025-001");
      expect(res.body.paymentTerms).toBe("NET_30");
      expect(res.body.deliveryTerms).toBe("DDP");
      expect(res.body.deliveryTermsNote).toBe("Leave at loading dock");
      expect(res.body.deliveryAddress).toBe("456 Industrial Ave, Riyadh, KSA");
      expect(res.body.taxRate).toBe(1500);
      expect(res.body.disputeWindowHours).toBe(48);
      expect(res.body.partialAcceptanceAllowed).toBe(true);

      // Verify tax calculation: net = 200000, tax = 200000 * 1500/10000 = 30000
      expect(res.body.totalAmountPennies).toBe(200000);
      expect(res.body.taxAmount).toBe(30000);
      expect(res.body.grossAmount).toBe(230000);

      poId = res.body.id;
    });

    it("should return extended fields in GET", async () => {
      const res = await request(app.getHttpServer())
        .get(`/purchase-orders/${poId}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.externalPoNumber).toBe("EXT-PO-2025-001");
      expect(res.body.paymentTerms).toBe("NET_30");
      expect(res.body.deliveryTerms).toBe("DDP");
      expect(res.body.taxRate).toBe(1500);
      expect(res.body.grossAmount).toBe(230000);
      expect(res.body.currency).toBeDefined();
    });

    it("should create PO with defaults when no extended fields provided", async () => {
      const res = await request(app.getHttpServer())
        .post("/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          supplierId,
          description: "Basic PO",
          lineItems: [
            {
              description: "Basic Item",
              quantity: 10,
              unitPricePennies: 10000,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.paymentTerms).toBe("IMMEDIATE");
      expect(res.body.deliveryTerms).toBe("EX_WORKS");
      expect(res.body.taxRate).toBe(0);
      expect(res.body.taxAmount).toBe(0);
      expect(res.body.grossAmount).toBe(100000);
      expect(res.body.disputeWindowHours).toBe(72);
      expect(res.body.partialAcceptanceAllowed).toBe(false);
      expect(res.body.externalPoNumber).toBeNull();
    });
  });

  // ── Evidence Upload ─────────────────────────────────────────

  describe("Evidence upload and retrieval", () => {
    let createdPoId: string;
    let attachmentId: string;

    beforeAll(async () => {
      // Create a PO for evidence tests
      const res = await request(app.getHttpServer())
        .post("/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          supplierId,
          description: "Evidence Test PO",
          lineItems: [
            {
              description: "Evidence Item",
              quantity: 20,
              unitPricePennies: 5000,
            },
          ],
        });
      createdPoId = res.body.id;

      // Send → Accept so both buyer and supplier can interact
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${createdPoId}/send`)
        .set("Authorization", `Bearer ${buyerToken}`);
      await request(app.getHttpServer())
        .patch(`/purchase-orders/${createdPoId}/accept`)
        .set("Authorization", `Bearer ${supplierToken}`);
    });

    it("should upload evidence for a PO (supplier)", async () => {
      const fileContent = Buffer.from("fake PDF content for testing");
      const res = await request(app.getHttpServer())
        .post("/evidence/upload")
        .set("Authorization", `Bearer ${supplierToken}`)
        .field("purchaseOrderId", createdPoId)
        .field("type", "DELIVERY_NOTE")
        .field("description", "Signed delivery note from carrier")
        .attach("file", fileContent, {
          filename: "delivery-note.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(201);
      expect(res.body.purchaseOrderId).toBe(createdPoId);
      expect(res.body.type).toBe("DELIVERY_NOTE");
      expect(res.body.filename).toBe("delivery-note.pdf");
      expect(res.body.mimeType).toBe("application/pdf");
      expect(res.body.sha256Hash).toBeDefined();
      expect(res.body.sha256Hash).toHaveLength(64); // hex SHA-256
      expect(res.body.eventLogId).toBeDefined();
      attachmentId = res.body.id;
    });

    it("should upload evidence for a PO (buyer)", async () => {
      const imgContent = Buffer.from([
        0xff,
        0xd8,
        0xff,
        0xe0, // JPEG header bytes
        ...Buffer.from("fake JPEG data"),
      ]);
      const res = await request(app.getHttpServer())
        .post("/evidence/upload")
        .set("Authorization", `Bearer ${buyerToken}`)
        .field("purchaseOrderId", createdPoId)
        .field("type", "PHOTO_PROOF")
        .field("description", "Photo of goods received")
        .attach("file", imgContent, {
          filename: "goods-photo.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe("PHOTO_PROOF");
      expect(res.body.filename).toBe("goods-photo.jpg");
    });

    it("should list evidence for a PO", async () => {
      const res = await request(app.getHttpServer())
        .get(`/evidence/po/${createdPoId}`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      // Each attachment should have uploader info
      const first = res.body[0];
      expect(first.uploader).toBeDefined();
      expect(first.uploader.id).toBeDefined();
    });

    it("should download an attachment", async () => {
      const res = await request(app.getHttpServer())
        .get(`/evidence/${attachmentId}/download`)
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toContain("delivery-note.pdf");
      expect(res.body).toBeDefined();
    });

    it("should verify attachment integrity", async () => {
      const res = await request(app.getHttpServer())
        .get(`/evidence/${attachmentId}/verify`)
        .set("Authorization", `Bearer ${supplierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.storedHash).toBe(res.body.computedHash);
    });

    it("should reject unsupported file types", async () => {
      const exeContent = Buffer.from("MZ fake executable");
      const res = await request(app.getHttpServer())
        .post("/evidence/upload")
        .set("Authorization", `Bearer ${supplierToken}`)
        .field("purchaseOrderId", createdPoId)
        .field("type", "OTHER")
        .attach("file", exeContent, {
          filename: "malware.exe",
          contentType: "application/x-msdownload",
        });

      expect(res.status).toBe(400);
    });

    it("should reject upload from non-party user", async () => {
      // Full cleanup of leftover test user
      const leftover = await prisma.user.findMany({
        where: { email: "evidence-other@test.com" },
        select: { id: true },
      });
      if (leftover.length > 0) {
        const ids = leftover.map((u) => u.id);
        await prisma.eventLog.deleteMany({ where: { actorId: { in: ids } } });
        await prisma.orgMembership.deleteMany({
          where: { userId: { in: ids } },
        });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
      }

      // Register a third user who is not buyer or supplier on this PO
      const otherRes = await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          email: "evidence-other@test.com",
          password: "TestPass123!",
          name: "Other User",
          role: "BUYER",
          companyName: "Other Co",
        });
      const otherToken = otherRes.body.accessToken;
      expect(otherToken).toBeDefined();

      const fileContent = Buffer.from("unauthorized upload content");
      const res = await request(app.getHttpServer())
        .post("/evidence/upload")
        .set("Authorization", `Bearer ${otherToken}`)
        .field("purchaseOrderId", createdPoId)
        .field("type", "INVOICE")
        .attach("file", fileContent, {
          filename: "invoice.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(400);

      // Clean up other user
      await prisma.eventLog.deleteMany({
        where: { actorId: otherRes.body.user.id },
      });
      await prisma.orgMembership.deleteMany({
        where: { userId: otherRes.body.user.id },
      });
      await prisma.user.deleteMany({
        where: { email: "evidence-other@test.com" },
      });
    });

    it("should include evidence hash in ledger event", async () => {
      const attachment = await prisma.evidenceAttachment.findUnique({
        where: { id: attachmentId },
      });
      expect(attachment).toBeDefined();
      expect(attachment!.eventLogId).toBeDefined();

      const event = await prisma.eventLog.findUnique({
        where: { id: attachment!.eventLogId! },
      });
      expect(event).toBeDefined();
      expect(event!.eventType).toBe("EVIDENCE_UPLOADED");
      const payload = event!.payload as any;
      expect(payload.sha256Hash).toBe(attachment!.sha256Hash);
      expect(payload.type).toBe("DELIVERY_NOTE");
    });
  });

  // ── Evidence Pack ───────────────────────────────────────────

  describe("Evidence pack export", () => {
    it("should generate evidence pack JSON for a PO", async () => {
      // Use the PO from creation tests
      const res = await request(app.getHttpServer())
        .get(`/evidence/po/${poId}/pack`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);

      // Trust Envelope v2.0 structure
      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata.packVersion).toBe("2.0");
      expect(res.body.metadata.schemaVersion).toBe("trust-envelope-v1");
      expect(res.body.metadata.generatedAt).toBeDefined();

      // Document (formerly purchaseOrder)
      expect(res.body.document).toBeDefined();
      expect(res.body.document.id).toBe(poId);
      expect(res.body.document.type).toBe("PURCHASE_ORDER");
      expect(res.body.document.documentHash).toBeDefined();
      expect(res.body.document.reference).toBeDefined();

      // Actors
      expect(res.body.actors).toBeDefined();
      expect(Array.isArray(res.body.actors)).toBe(true);
      expect(res.body.actors.length).toBeGreaterThanOrEqual(1);

      // Ledger
      expect(res.body.ledger).toBeDefined();
      expect(res.body.ledger.chainAlgorithm).toBe("SHA-256");
      expect(Array.isArray(res.body.ledger.events)).toBe(true);

      // Approvals
      expect(res.body.approvals).toBeDefined();
      expect(Array.isArray(res.body.approvals)).toBe(true);

      // Integrity
      expect(res.body.integrity).toBeDefined();
      expect(res.body.integrity.documentHash).toBeDefined();
      expect(res.body.integrity.ledgerRootHash).toBeDefined();
      expect(res.body.integrity.envelopeHash).toBeDefined();
      expect(typeof res.body.integrity.eventCount).toBe("number");

      // Verification instructions
      expect(res.body.verification).toBeDefined();
      expect(res.body.verification.instructions).toBeDefined();

      // Future fields (null until implemented)
      expect(res.body.platformSignature).toBeDefined();
      expect(res.body.platformSignature.algorithm).toBe("ECDSA-P256-SHA256");
      expect(res.body.platformSignature.signature).toBeDefined();
      expect(typeof res.body.platformSignature.signature).toBe("string");
      expect(res.body.platformSignature.publicKey).toBeDefined();
      expect(typeof res.body.platformSignature.publicKey).toBe("string");
      expect(res.body.platformSignature.signedAt).toBeDefined();
      expect(res.body.platformSignature.signedFields).toBe("envelopeHash");
      expect(res.body.notarization).toBeNull();
    });

    it("should include paymentInstrument section when PO has an instrument", async () => {
      // The PO created earlier should have an auto-created instrument
      const res = await request(app.getHttpServer())
        .get(`/evidence/po/${poId}/pack`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);

      // paymentInstrument may or may not exist depending on whether the PO
      // flow auto-creates instruments — test both cases
      if (res.body.paymentInstrument) {
        expect(res.body.paymentInstrument.instrumentId).toBeDefined();
        expect(typeof res.body.paymentInstrument.type).toBe("string");
        expect(typeof res.body.paymentInstrument.amount).toBe("number");
        expect(typeof res.body.paymentInstrument.currency).toBe("string");
        expect(typeof res.body.paymentInstrument.status).toBe("string");
        expect(Array.isArray(res.body.paymentInstrument.lifecycle)).toBe(true);
        expect(
          res.body.paymentInstrument.lifecycle.length,
        ).toBeGreaterThanOrEqual(1);
        expect(res.body.paymentInstrument.lifecycle[0]).toHaveProperty(
          "status",
        );
        expect(res.body.paymentInstrument.lifecycle[0]).toHaveProperty("at");
      } else {
        expect(res.body.paymentInstrument).toBeNull();
      }
    });

    it("should include reconciliation section (null or valid shape)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/evidence/po/${poId}/pack`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);

      // Reconciliation may be null if no reports have been run
      if (res.body.reconciliation) {
        expect(res.body.reconciliation.lastChecked).toBeDefined();
        expect(["CONSISTENT", "MISMATCH_DETECTED"]).toContain(
          res.body.reconciliation.status,
        );
        expect(res.body.reconciliation).toHaveProperty("bankBalance");
        expect(res.body.reconciliation).toHaveProperty("ledgerBalance");
        expect(res.body.reconciliation).toHaveProperty("variance");
      } else {
        expect(res.body.reconciliation).toBeNull();
      }
    });

    it("should include verification checks 16 and 17", async () => {
      const res = await request(app.getHttpServer())
        .get(`/evidence/po/${poId}/pack`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);

      const checks: string[] = res.body.verification.checksToPerform;
      expect(checks.length).toBeGreaterThanOrEqual(13);

      // Check 16 — instrument lifecycle integrity
      expect(checks.some((c) => c.includes("instrument lifecycle"))).toBe(true);

      // Check 17 — bank reference consistency
      expect(checks.some((c) => c.includes("bank reference consistency"))).toBe(
        true,
      );
    });
  });

  // ── CSV Import ──────────────────────────────────────────────

  describe("CSV import", () => {
    it("should import POs from CSV", async () => {
      const csvContent = [
        "supplierId,description,lineDescription,quantity,unitPricePennies,externalPoNumber,paymentTerms,deliveryTerms,deliveryAddress,taxRate",
        `${supplierId},Imported PO 1,Widget X,10,10000,CSV-PO-001,NET_30,FOB,Warehouse A,1500`,
        `${supplierId},Imported PO 1,Widget Y,5,20000,CSV-PO-001,NET_30,FOB,Warehouse A,1500`,
        `${supplierId},Imported PO 2,Widget Z,3,50000,CSV-PO-002,NET_60,DDP,Warehouse B,0`,
      ].join("\n");

      const res = await request(app.getHttpServer())
        .post("/purchase-orders/import/csv")
        .set("Authorization", `Bearer ${buyerToken}`)
        .attach("file", Buffer.from(csvContent), {
          filename: "po-import.csv",
          contentType: "text/csv",
        });

      expect(res.status).toBe(201);
      expect(res.body.imported).toBe(2); // Two groups by externalPoNumber
      expect(res.body.errors).toHaveLength(0);
    });

    it("should have imported POs with correct data", async () => {
      const res = await request(app.getHttpServer())
        .get("/purchase-orders")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);

      const importedPO1 = res.body.find(
        (po: any) => po.externalPoNumber === "CSV-PO-001",
      );
      expect(importedPO1).toBeDefined();
      expect(importedPO1.paymentTerms).toBe("NET_30");
      expect(importedPO1.deliveryTerms).toBe("FOB");
      expect(importedPO1.importSource).toBe("CSV");
      expect(importedPO1.importBatchId).toBeDefined();
      expect(importedPO1.lineItems).toHaveLength(2);
      // Net amount: 10*10000 + 5*20000 = 200000
      expect(importedPO1.totalAmountPennies).toBe(200000);
      // Tax: 200000 * 1500 / 10000 = 30000
      expect(importedPO1.taxAmount).toBe(30000);
      expect(importedPO1.grossAmount).toBe(230000);

      const importedPO2 = res.body.find(
        (po: any) => po.externalPoNumber === "CSV-PO-002",
      );
      expect(importedPO2).toBeDefined();
      expect(importedPO2.paymentTerms).toBe("NET_60");
      expect(importedPO2.deliveryTerms).toBe("DDP");
      expect(importedPO2.lineItems).toHaveLength(1);
      expect(importedPO2.taxRate).toBe(0);
    });

    it("should reject CSV with missing required columns", async () => {
      const badCsv = "description,quantity\nWidget,10\n";
      const res = await request(app.getHttpServer())
        .post("/purchase-orders/import/csv")
        .set("Authorization", `Bearer ${buyerToken}`)
        .attach("file", Buffer.from(badCsv), {
          filename: "bad.csv",
          contentType: "text/csv",
        });

      expect(res.status).toBe(400);
    });

    it("should report errors for invalid rows", async () => {
      const csvContent = [
        "supplierId,description,lineDescription,quantity,unitPricePennies,externalPoNumber",
        `invalid-supplier-id,Bad PO,Widget,10,10000,CSV-BAD-001`,
      ].join("\n");

      const res = await request(app.getHttpServer())
        .post("/purchase-orders/import/csv")
        .set("Authorization", `Bearer ${buyerToken}`)
        .attach("file", Buffer.from(csvContent), {
          filename: "partial-bad.csv",
          contentType: "text/csv",
        });

      expect(res.status).toBe(201);
      expect(res.body.imported).toBe(0);
      expect(res.body.errors.length).toBeGreaterThan(0);
    });
  });

  // ── Ledger integrity for evidence ───────────────────────────

  describe("Ledger integration", () => {
    it("should have EVIDENCE_UPLOADED events in the ledger", async () => {
      const events = await prisma.eventLog.findMany({
        where: { eventType: "EVIDENCE_UPLOADED" },
        orderBy: { sequence: "desc" },
        take: 5,
      });

      expect(events.length).toBeGreaterThan(0);
      const first = events[0];
      expect(first.entityType).toBe("PURCHASE_ORDER");
      expect(first.eventHash).toBeDefined();
      const payload = first.payload as any;
      expect(payload.sha256Hash).toBeDefined();
      expect(payload.attachmentId).toBeDefined();
    });
  });
});
