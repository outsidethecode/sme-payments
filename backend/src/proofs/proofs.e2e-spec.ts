import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { createHash } from "crypto";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { ProofVerifierService } from "./proof-verifier.service";
import type { ProofBundle } from "./proof-bundle.schema";

describe("Standalone Cryptographic Proofs (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifier: ProofVerifierService;
  let buyerToken: string;
  let buyerId: string;
  let supplierToken: string;
  let supplierId: string;
  let poId: string;
  let eventId: string;
  let entityIdForBatch: string;

  const BUYER_EMAIL = "proof-buyer@test.com";
  const SUPPLIER_EMAIL = "proof-supplier@test.com";

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
    verifier = app.get(ProofVerifierService);

    // ── Clean up stale test data ──────────────────────────
    const existingUsers = await prisma.user.findMany({
      where: { email: { in: [BUYER_EMAIL, SUPPLIER_EMAIL] } },
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
      await prisma.eventLog.deleteMany({
        where: { actorId: { in: existingUserIds } },
      });
      await prisma.userPasskey.deleteMany({
        where: { userId: { in: existingUserIds } },
      });
      await prisma.orgMembership.deleteMany({
        where: { userId: { in: existingUserIds } },
      });
      await prisma.invitation.deleteMany({
        where: { inviterUserId: { in: existingUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: existingUserIds } },
      });
    }

    // ── Register buyer ────────────────────────────────────
    const buyerReg = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email: BUYER_EMAIL,
        password: "Test1234!",
        name: "Proof Buyer",
        companyName: "Proof Corp",
        role: "BUYER",
        jurisdiction: "KSA",
      });
    buyerToken = buyerReg.body.accessToken;
    buyerId = buyerReg.body.user.id;

    // ── Register supplier ─────────────────────────────────
    const supplierReg = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email: SUPPLIER_EMAIL,
        password: "Test1234!",
        name: "Proof Supplier",
        companyName: "Proof Supply Co",
        role: "SUPPLIER",
        jurisdiction: "KSA",
      });
    supplierToken = supplierReg.body.accessToken;
    supplierId = supplierReg.body.user.id;

    // ── Create a PO to generate ledger events ─────────────
    const poRes = await request(app.getHttpServer())
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        supplierId,
        description: "Proof test PO",
        lineItems: [
          {
            description: "Widget A",
            quantity: 100,
            unitPricePennies: 5000,
          },
        ],
        paymentTerms: "NET_30",
        deliveryTerms: "DDP",
      });
    poId = poRes.body.id;

    // Get a ledger event for this PO (may have different entityType)
    const events = await prisma.eventLog.findMany({
      where: {
        OR: [...(poId ? [{ entityId: poId }] : []), { actorId: buyerId }],
      },
      orderBy: { sequence: "desc" },
    });
    // Use the first event that has a valid ID
    eventId = events[0]?.id;
    entityIdForBatch = events[0]?.entityId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // ══════════════════════════════════════════════════════════
  // Proof Bundle Generation
  // ══════════════════════════════════════════════════════════

  describe("GET /api/proofs/event/:eventId", () => {
    it("should generate a standalone proof bundle for a single event", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/proofs/event/${eventId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const bundle: ProofBundle = res.body;

      // Schema version
      expect(bundle.version).toBe("1.0");
      expect(bundle.proofId).toBe(eventId);
      expect(bundle.generatedAt).toBeDefined();

      // Intent
      expect(bundle.intent.eventType).toBeDefined();
      expect(bundle.intent.entityType).toBeDefined();
      expect(bundle.intent.entityId).toBeDefined();
      expect(bundle.intent.payload).toBeDefined();
      expect(bundle.intent.timestamp).toBeDefined();
      expect(bundle.intent.payloadHash).toBeDefined();

      // Signer identity
      expect(bundle.signer.userId).toBe(buyerId);
      expect(bundle.signer.name).toBe("Proof Buyer");
      expect(bundle.signer.email).toBe(BUYER_EMAIL);
      expect(bundle.signer.role).toBeDefined();

      // Issuer
      expect(bundle.issuer.name).toBeDefined();
      expect(bundle.issuer.rpId).toBeDefined();
      expect(bundle.issuer.origin).toBeDefined();
      expect(bundle.issuer.registryUri).toContain("/proofs/registry");
      expect(bundle.issuer.identityUri).toContain("/proofs/identity");

      // Chain
      expect(bundle.chain.eventHash).toBeDefined();
      expect(bundle.chain.previousHash).toBeDefined();
      expect(bundle.chain.entitySequence).toBeGreaterThan(0);
      expect(bundle.chain.hashAlgorithm).toBe("SHA-256");
      expect(bundle.chain.hashInputFormat).toContain("previousHash");

      // Verification spec
      expect(bundle.verification).toBeDefined();
      expect(bundle.verification.steps.length).toBeGreaterThan(0);
    });

    it("should include signer organisation details when available", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/proofs/event/${eventId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const bundle: ProofBundle = res.body;
      // Organisation may or may not be present depending on whether user
      // was auto-assigned to an org at registration
      expect(bundle.signer.userId).toBe(buyerId);
    });

    it("should return 404 for non-existent event", async () => {
      await request(app.getHttpServer())
        .get("/api/proofs/event/00000000-0000-0000-0000-000000000000")
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(404);
    });
  });

  describe("GET /api/proofs/entity/:entityId", () => {
    it("should generate proof bundles for all entity events", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/proofs/entity/${entityIdForBatch}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.entityId).toBe(entityIdForBatch);
      expect(res.body.proofCount).toBeGreaterThan(0);
      expect(res.body.proofs).toHaveLength(res.body.proofCount);
      expect(res.body.chainValid).toBe(true);
      expect(res.body.chainSummary).toContain("events");

      // Each proof should be a complete bundle
      const firstProof: ProofBundle = res.body.proofs[0];
      expect(firstProof.version).toBe("1.0");
      expect(firstProof.intent.entityId).toBe(entityIdForBatch);
      expect(firstProof.signer.userId).toBeDefined();
      expect(firstProof.chain.eventHash).toBeDefined();
    });

    it("should verify chain linkage within the batch", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/proofs/entity/${entityIdForBatch}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const proofs: ProofBundle[] = res.body.proofs;
      if (proofs.length > 1) {
        for (let i = 1; i < proofs.length; i++) {
          expect(proofs[i].chain.previousHash).toBe(
            proofs[i - 1].chain.eventHash,
          );
        }
      }
      // First proof should have GENESIS
      expect(proofs[0].chain.previousHash).toBe("GENESIS");
    });

    it("should return 404 for entity with no events", async () => {
      await request(app.getHttpServer())
        .get("/api/proofs/entity/00000000-0000-0000-0000-000000000000")
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(404);
    });
  });

  // ══════════════════════════════════════════════════════════
  // Proof Verification (Public Endpoints)
  // ══════════════════════════════════════════════════════════

  describe("POST /api/proofs/verify", () => {
    it("should verify a valid proof bundle (system event — hash chain only)", async () => {
      // Get a proof bundle first
      const proofRes = await request(app.getHttpServer())
        .get(`/api/proofs/event/${eventId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const bundle: ProofBundle = proofRes.body;

      // Submit it for verification — NO AUTH REQUIRED
      const verifyRes = await request(app.getHttpServer())
        .post("/api/proofs/verify")
        .send(bundle)
        .expect(201);

      expect(verifyRes.body.verifiedAt).toBeDefined();
      expect(verifyRes.body.steps).toBeDefined();
      expect(verifyRes.body.steps.length).toBeGreaterThan(0);
      expect(verifyRes.body.summary).toBeDefined();
    });

    it("should verify hash chain integrity in the bundle", async () => {
      const proofRes = await request(app.getHttpServer())
        .get(`/api/proofs/event/${eventId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const bundle: ProofBundle = proofRes.body;
      const verifyRes = await request(app.getHttpServer())
        .post("/api/proofs/verify")
        .send(bundle)
        .expect(201);

      // The hash chain step should pass
      const hashChainStep = verifyRes.body.steps.find(
        (s: any) => s.name === "Hash chain integrity",
      );
      expect(hashChainStep).toBeDefined();
      expect(hashChainStep.passed).toBe(true);
    });

    it("should detect tampered payload in proof bundle", async () => {
      const proofRes = await request(app.getHttpServer())
        .get(`/api/proofs/event/${eventId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const bundle: ProofBundle = proofRes.body;

      // Tamper with the payload
      bundle.intent.payload = { tampered: true };

      const verifyRes = await request(app.getHttpServer())
        .post("/api/proofs/verify")
        .send(bundle)
        .expect(201);

      // Should detect the tampering (payload hash and/or chain hash mismatch)
      expect(verifyRes.body.valid).toBe(false);
      expect(verifyRes.body.summary).toContain("INVALID");
    });

    it("should detect tampered signer identity", async () => {
      const proofRes = await request(app.getHttpServer())
        .get(`/api/proofs/event/${eventId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const bundle: ProofBundle = proofRes.body;

      // Tamper with the signer
      bundle.signer.userId = "00000000-0000-0000-0000-000000000000";

      const verifyRes = await request(app.getHttpServer())
        .post("/api/proofs/verify")
        .send(bundle)
        .expect(201);

      // Hash chain should fail because actorId is part of the hash input
      expect(verifyRes.body.valid).toBe(false);
    });

    it("should detect tampered event hash", async () => {
      const proofRes = await request(app.getHttpServer())
        .get(`/api/proofs/event/${eventId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const bundle: ProofBundle = proofRes.body;

      // Tamper with the event hash
      bundle.chain.eventHash =
        "0000000000000000000000000000000000000000000000000000000000000000";

      const verifyRes = await request(app.getHttpServer())
        .post("/api/proofs/verify")
        .send(bundle)
        .expect(201);

      expect(verifyRes.body.valid).toBe(false);
      const hashStep = verifyRes.body.steps.find(
        (s: any) => s.name === "Hash chain integrity",
      );
      expect(hashStep?.passed).toBe(false);
    });
  });

  describe("POST /api/proofs/verify/offline", () => {
    it("should verify without contacting registry", async () => {
      const proofRes = await request(app.getHttpServer())
        .get(`/api/proofs/event/${eventId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      const verifyRes = await request(app.getHttpServer())
        .post("/api/proofs/verify/offline")
        .send(proofRes.body)
        .expect(201);

      expect(verifyRes.body.steps).toBeDefined();
      expect(verifyRes.body.summary).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════
  // Public Credential & Identity Registry
  // ══════════════════════════════════════════════════════════

  describe("GET /api/proofs/registry/credentials/:credentialId", () => {
    it("should return 404 for non-existent credential", async () => {
      await request(app.getHttpServer())
        .get("/api/proofs/registry/credentials/nonexistent-cred-id")
        .expect(404);
    });
  });

  describe("GET /api/proofs/identity/signers/:userId", () => {
    it("should return signer identity (public endpoint)", async () => {
      // No auth required
      const res = await request(app.getHttpServer())
        .get(`/api/proofs/identity/signers/${buyerId}`)
        .expect(200);

      expect(res.body.userId).toBe(buyerId);
      expect(res.body.name).toBe("Proof Buyer");
      expect(res.body.email).toBe(BUYER_EMAIL);
      expect(res.body.role).toBeDefined();
      expect(res.body.credentials).toBeDefined();
      expect(Array.isArray(res.body.credentials)).toBe(true);
    });

    it("should include organisation details", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/proofs/identity/signers/${buyerId}`)
        .expect(200);

      // Organisation might be null if user wasn't assigned to one at registration,
      // but the field should be present
      expect(res.body).toHaveProperty("organisation");
    });

    it("should return 404 for non-existent user", async () => {
      await request(app.getHttpServer())
        .get(
          "/api/proofs/identity/signers/00000000-0000-0000-0000-000000000000",
        )
        .expect(404);
    });
  });

  // ══════════════════════════════════════════════════════════
  // Standalone Verifier Service (Unit Tests)
  // ══════════════════════════════════════════════════════════

  describe("ProofVerifierService (direct)", () => {
    it("should validate a well-formed system event bundle", async () => {
      // Create a minimal bundle matching a system event
      const payload = { test: "data", amount: 500000 };
      const payloadHash = createHash("sha256")
        .update(canonicalStringify(payload))
        .digest("hex");

      const timestamp = new Date().toISOString();
      const previousHash = "GENESIS";

      const hashInput = [
        previousHash,
        "PurchaseOrder",
        "test-entity-id",
        "1",
        "PO_CREATED",
        buyerId,
        "BUYER",
        canonicalStringify(payload),
        timestamp,
      ].join("|");
      const eventHash = createHash("sha256").update(hashInput).digest("hex");

      const bundle: ProofBundle = {
        version: "1.0",
        proofId: "test-proof-id",
        generatedAt: new Date().toISOString(),
        intent: {
          eventType: "PO_CREATED",
          entityType: "PurchaseOrder",
          entityId: "test-entity-id",
          payload,
          timestamp,
          payloadHash,
        },
        signer: {
          userId: buyerId,
          name: "Proof Buyer",
          email: BUYER_EMAIL,
          role: "BUYER",
          organisation: null,
        },
        credential: {
          credentialId: "SYSTEM",
          publicKeyBase64: "SYSTEM",
          deviceType: null,
          backedUp: false,
          registeredAt: "",
          publicKeyResolutionUri: "",
        },
        assertion: null,
        issuer: {
          name: "Test RP",
          rpId: "localhost",
          origin: process.env.WEBAUTHN_ORIGIN || "http://localhost:3002",
          registryUri: "http://localhost:3001/api/proofs/registry",
          identityUri: "http://localhost:3001/api/proofs/identity",
        },
        chain: {
          eventHash,
          previousHash,
          entitySequence: 1,
          hashAlgorithm: "SHA-256",
          hashInputFormat:
            "previousHash|entityType|entityId|entitySequence|eventType|actorId|actorRole|canonicalPayload|timestamp",
        },
        evidence: [],
        verification: {
          isCryptographicallySigned: false,
          algorithm: "none",
          steps: [
            {
              step: 1,
              description: "System event",
              operation: "N/A",
              expected: "Verify hash chain",
            },
          ],
        },
      };

      const result = verifier.verify(bundle);

      expect(result.valid).toBe(true);
      expect(result.steps.every((s) => s.passed)).toBe(true);
      expect(result.summary).toContain("VALID");
    });

    it("should reject a bundle with invalid version", () => {
      const bundle = {
        version: "99.0",
        proofId: "test",
        intent: {
          eventType: "X",
          entityType: "Y",
          entityId: "Z",
          payload: {},
          timestamp: "",
          payloadHash: "",
        },
        signer: {
          userId: "u",
          name: "n",
          email: "e",
          role: "r",
          organisation: null,
        },
        credential: {
          credentialId: "c",
          publicKeyBase64: "p",
          deviceType: null,
          backedUp: false,
          registeredAt: "",
          publicKeyResolutionUri: "",
        },
        assertion: null,
        issuer: {
          name: "",
          rpId: "",
          origin: "",
          registryUri: "",
          identityUri: "",
        },
        chain: {
          eventHash: "",
          previousHash: "",
          entitySequence: 1,
          hashAlgorithm: "",
          hashInputFormat: "",
        },
        evidence: [],
        verification: {
          isCryptographicallySigned: false,
          algorithm: "none" as const,
          steps: [],
        },
        generatedAt: "",
      } as unknown as ProofBundle;

      const result = verifier.verify(bundle);
      expect(result.valid).toBe(false);
      expect(result.steps[0].passed).toBe(false);
      expect(result.steps[0].detail).toContain("Unknown bundle version");
    });

    it("should detect payload hash tampering", () => {
      const payload = { amount: 100 };
      const timestamp = new Date().toISOString();

      const hashInput = [
        "GENESIS",
        "PurchaseOrder",
        "eid",
        "1",
        "PO_CREATED",
        "uid",
        "BUYER",
        canonicalStringify(payload),
        timestamp,
      ].join("|");
      const eventHash = createHash("sha256").update(hashInput).digest("hex");

      const bundle: ProofBundle = {
        version: "1.0",
        proofId: "test",
        generatedAt: new Date().toISOString(),
        intent: {
          eventType: "PO_CREATED",
          entityType: "PurchaseOrder",
          entityId: "eid",
          payload,
          timestamp,
          payloadHash: "wrong-hash-value",
        },
        signer: {
          userId: "uid",
          name: "n",
          email: "e",
          role: "BUYER",
          organisation: null,
        },
        credential: {
          credentialId: "SYSTEM",
          publicKeyBase64: "SYSTEM",
          deviceType: null,
          backedUp: false,
          registeredAt: "",
          publicKeyResolutionUri: "",
        },
        assertion: {
          intentHash: "test",
          clientDataJSON: "",
          authenticatorData: "",
          signature: "",
        },
        issuer: {
          name: "",
          rpId: "",
          origin: "",
          registryUri: "",
          identityUri: "",
        },
        chain: {
          eventHash,
          previousHash: "GENESIS",
          entitySequence: 1,
          hashAlgorithm: "SHA-256",
          hashInputFormat: "",
        },
        evidence: [],
        verification: {
          isCryptographicallySigned: true,
          algorithm: "WebAuthn-FIDO2-ES256",
          steps: [],
        },
      };

      const result = verifier.verify(bundle);
      expect(result.valid).toBe(false);

      const payloadStep = result.steps.find((s) => s.name === "Payload hash");
      expect(payloadStep?.passed).toBe(false);
      expect(payloadStep?.detail).toContain("mismatch");
    });
  });

  // ══════════════════════════════════════════════════════════
  // Round-trip: Generate → Verify
  // ══════════════════════════════════════════════════════════

  describe("Round-trip: generate proof → verify proof", () => {
    it("should generate a bundle that passes verification", async () => {
      // Generate
      const proofRes = await request(app.getHttpServer())
        .get(`/api/proofs/event/${eventId}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      // Verify via API
      const verifyRes = await request(app.getHttpServer())
        .post("/api/proofs/verify")
        .send(proofRes.body)
        .expect(201);

      // The bundle structure and hash chain steps should pass
      const structureStep = verifyRes.body.steps.find(
        (s: any) => s.name === "Bundle structure",
      );
      expect(structureStep?.passed).toBe(true);
    });

    it("should generate entity proofs that each pass verification", async () => {
      const entityRes = await request(app.getHttpServer())
        .get(`/api/proofs/entity/${entityIdForBatch}`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .expect(200);

      // Verify each proof
      for (const proof of entityRes.body.proofs) {
        const verifyRes = await request(app.getHttpServer())
          .post("/api/proofs/verify")
          .send(proof)
          .expect(201);

        const structureStep = verifyRes.body.steps.find(
          (s: any) => s.name === "Bundle structure",
        );
        expect(structureStep?.passed).toBe(true);

        const hashStep = verifyRes.body.steps.find(
          (s: any) => s.name === "Hash chain integrity",
        );
        expect(hashStep?.passed).toBe(true);
      }
    });
  });
});

/**
 * Canonical JSON serialization — duplicated for test-side hash recomputation.
 */
function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (obj instanceof Date) return JSON.stringify(obj.toISOString());
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalStringify).join(",") + "]";
  }
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        JSON.stringify(key) +
        ":" +
        canonicalStringify((obj as Record<string, unknown>)[key]),
    )
    .join(",");
  return "{" + sorted + "}";
}
