import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { AnchorService } from "../ledger/anchor.service";
import { ProofGeneratorService } from "../proofs/proof-generator.service";
import {
  CRYPTO_SERVICE,
  type ICryptoService,
} from "../crypto/crypto.interface";
import { canonicalStringify } from "../crypto/canonical-stringify";
import * as fs from "fs";
import * as path from "path";

export type EvidenceTypeValue =
  | "DELIVERY_NOTE"
  | "SIGNED_RECEIPT"
  | "PHOTO_PROOF"
  | "INVOICE"
  | "INSPECTION_REPORT"
  | "SHIPPING_DOCUMENT"
  | "PO_DOCUMENT"
  | "OTHER";

/* ── Trust Envelope types ──────────────────────────────────── */

export interface TrustEnvelopeActorCredential {
  credentialId: string;
  publicKeyBase64: string;
  deviceType: string | null;
  backedUp: boolean;
  registeredAt: string;
  resolutionUri: string;
}

export interface TrustEnvelopeActor {
  id: string;
  role: string;
  name: string;
  email: string | null;
  companyName: string | null;
  jurisdiction: string | null;
  organisationType: string | null;
  credentials: TrustEnvelopeActorCredential[];
  identityResolutionUri: string;
}

export interface TrustEnvelopeApproval {
  eventId: string;
  eventType: string;
  actorId: string;
  actorRole: string;
  method: "passkey";
  credentialId: string;
  intentHash: string;
  signature: string;
  timestamp: string;
}

export interface TrustEnvelopeIntegrity {
  documentHash: string;
  ledgerRootHash: string;
  attachmentsHash: string;
  envelopeHash: string;
  eventCount: number;
  attachmentCount: number;
  signedEventCount: number;
  unsignedEventCount: number;
  fileIntegrity: {
    attachmentId: string;
    filename: string;
    valid: boolean;
    sha256: string;
  }[];
}

export interface TrustEnvelope {
  metadata: {
    envelopeId: string;
    packVersion: string;
    schemaVersion: string;
    generatedAt: string;
    generator: string;
    hashAlgorithm: string;
    signatureAlgorithm: string;
    canonicalization: {
      algorithm: string;
      implementation: string;
    };
  };
  actors: TrustEnvelopeActor[];
  document: Record<string, unknown>;
  paymentInstrument: null | {
    instrumentId: string;
    type: string;
    amount: number;
    currency: string;
    status: string;
    settlementBeneficiary: string;
    escrowReference: string | null;
    bankReference: string | null;
    escrowAccount: null | {
      id: string;
      label: string;
      bank: string;
      country: string;
      currency: string;
    };
    lifecycle: { status: string; at: string; bankRef?: string | null }[];
  };
  reconciliation: null | {
    lastChecked: string;
    status: string;
    bankBalance: number | null;
    ledgerBalance: number | null;
    variance: number | null;
  };
  attachments: any[];
  ledger: {
    chainAlgorithm: string;
    hashInputFormat: string;
    entityChains: { entityType: string; entityId: string; events: any[] }[];
    events: any[];
  };
  approvals: TrustEnvelopeApproval[];
  proofBundles: any[];
  integrity: TrustEnvelopeIntegrity;
  verification: {
    instructions: string;
    checksToPerform: string[];
  };
  platformSignature: null | {
    algorithm: string;
    signature: string;
    publicKey: string;
    signedAt: string;
    signedFields: string;
  };
  notarization: null | {
    merkleRoot: string;
    merkleProof: {
      entityId: string;
      leafHash: string;
      headHash: string;
      path: { position: "left" | "right"; hash: string }[];
    };
    anchor: {
      anchorId: string;
      anchorHash: string;
      previousAnchorHash: string | null;
      eventCount: number;
      entityCount: number;
      createdAt: string;
    };
    externalAnchor: null | {
      provider: string;
      externalId: string;
      verificationUrl: string;
      anchoredAt: string;
      proof: Record<string, unknown> | null;
    };
    algorithm: string;
    verificationUri: string;
  };
}

const UPLOAD_DIR = path.resolve(
  process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"),
);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly anchorService: AnchorService,
    private readonly proofGenerator: ProofGeneratorService,
    @Inject(CRYPTO_SERVICE) private readonly crypto: ICryptoService,
    private readonly config: ConfigService,
  ) {
    // Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    this.baseUrl = this.config.get<string>(
      "BASE_URL",
      "http://localhost:3001/api",
    );
  }

  /**
   * Upload one or more evidence files for a PO.
   */
  async upload(input: {
    purchaseOrderId: string;
    uploaderId: string;
    uploaderRole: string;
    type: EvidenceTypeValue;
    description?: string;
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    };
  }) {
    const {
      purchaseOrderId,
      uploaderId,
      uploaderRole,
      type,
      description,
      file,
    } = input;

    // Validate PO exists
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
    });
    if (!po) throw new NotFoundException("Purchase order not found");

    // Validate user is buyer or supplier on this PO
    if (po.buyerId !== uploaderId && po.supplierId !== uploaderId) {
      throw new BadRequestException(
        "Only the buyer or supplier of this PO can upload evidence",
      );
    }

    // Validate file
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type '${file.mimetype}' not allowed. Accepted: PDF, JPEG, PNG, WebP, CSV, XLSX`,
      );
    }

    // Compute SHA-256 hash
    const sha256Hash = this.crypto.sha256Hex(file.buffer);

    // Store file locally
    const ext = path.extname(file.originalname) || "";
    const storageName = `${this.crypto.randomUUID()}${ext}`;
    const storagePath = path.join(UPLOAD_DIR, storageName);
    fs.writeFileSync(storagePath, file.buffer);

    // Create DB record
    const attachment = await this.prisma.evidenceAttachment.create({
      data: {
        purchaseOrderId,
        uploaderId,
        type: type as any,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storagePath: storageName, // relative to UPLOAD_DIR
        sha256Hash,
        description,
      },
    });

    // Log ledger event with file hash
    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: purchaseOrderId,
      eventType: "EVIDENCE_UPLOADED",
      actorId: uploaderId,
      actorRole: uploaderRole,
      payload: {
        attachmentId: attachment.id,
        type,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256Hash,
      },
    });

    // Update attachment with ledger event ID
    const updatedAttachment = await this.prisma.evidenceAttachment.update({
      where: { id: attachment.id },
      data: { eventLogId: event.id },
    });

    this.logger.log(
      `Evidence uploaded for PO ${purchaseOrderId}: ${file.originalname} (${type}, ${sha256Hash.slice(0, 12)}…)`,
    );

    return this.format(updatedAttachment);
  }

  /**
   * List all evidence attachments for a PO.
   */
  async findByPO(purchaseOrderId: string) {
    const attachments = await this.prisma.evidenceAttachment.findMany({
      where: { purchaseOrderId },
      include: {
        uploader: {
          select: { id: true, name: true, companyName: true, role: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return attachments.map((a) => this.format(a));
  }

  /**
   * Get a single attachment record.
   */
  async findById(id: string) {
    const attachment = await this.prisma.evidenceAttachment.findUnique({
      where: { id },
      include: {
        uploader: {
          select: { id: true, name: true, companyName: true, role: true },
        },
      },
    });
    if (!attachment) throw new NotFoundException("Attachment not found");
    return attachment;
  }

  /**
   * Get the file buffer for download.
   */
  async getFileBuffer(id: string): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }> {
    const attachment = await this.prisma.evidenceAttachment.findUnique({
      where: { id },
    });
    if (!attachment) throw new NotFoundException("Attachment not found");

    const filePath = path.join(UPLOAD_DIR, attachment.storagePath);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException("File not found on disk");
    }

    return {
      buffer: fs.readFileSync(filePath),
      filename: attachment.filename,
      mimeType: attachment.mimeType,
    };
  }

  /**
   * Verify a file's integrity by comparing its hash.
   */
  async verifyIntegrity(id: string): Promise<{
    valid: boolean;
    storedHash: string;
    computedHash: string;
  }> {
    const attachment = await this.prisma.evidenceAttachment.findUnique({
      where: { id },
    });
    if (!attachment) throw new NotFoundException("Attachment not found");

    const filePath = path.join(UPLOAD_DIR, attachment.storagePath);
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        storedHash: attachment.sha256Hash,
        computedHash: "FILE_MISSING",
      };
    }

    const fileBuffer = fs.readFileSync(filePath);
    const computedHash = this.crypto.sha256Hex(fileBuffer);

    return {
      valid: computedHash === attachment.sha256Hash,
      storedHash: attachment.sha256Hash,
      computedHash,
    };
  }

  /**
   * Build a Trust Envelope for a PO — the bank-grade, self-contained,
   * cryptographically verifiable evidence pack.
   *
   * Structure: metadata, actors, document, attachments, ledger, approvals,
   * proofBundles, integrity, verification.
   */
  async buildEvidencePack(purchaseOrderId: string): Promise<TrustEnvelope> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        buyer: {
          select: { id: true, name: true, companyName: true, role: true },
        },
        supplier: {
          select: { id: true, name: true, companyName: true, role: true },
        },
        paymentLock: true,
        paymentInstrument: true,
        settlements: true,
        disputes: true,
        earlyPaymentRequest: true,
        revisions: { orderBy: { revision: "asc" as const } },
      },
    });
    if (!po) throw new NotFoundException("Purchase order not found");

    const attachments = await this.prisma.evidenceAttachment.findMany({
      where: { purchaseOrderId },
      include: {
        uploader: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // ── Collect ALL related entity IDs (cross-entity chains) ──
    const relatedEntityIds: string[] = [purchaseOrderId];
    if (po.paymentLock) relatedEntityIds.push(po.paymentLock.id);
    if (po.paymentInstrument) relatedEntityIds.push(po.paymentInstrument.id);
    if (po.earlyPaymentRequest)
      relatedEntityIds.push(po.earlyPaymentRequest.id);
    for (const s of po.settlements) relatedEntityIds.push(s.id);
    for (const d of po.disputes) relatedEntityIds.push(d.id);

    const ledgerEvents = await this.prisma.eventLog.findMany({
      where: { entityId: { in: relatedEntityIds } },
      orderBy: { sequence: "asc" },
    });

    // Verify integrity of all attachments
    const fileIntegrity = await Promise.all(
      attachments.map(async (a) => {
        const result = await this.verifyIntegrity(a.id);
        return {
          attachmentId: a.id,
          filename: a.filename,
          valid: result.valid,
          sha256: a.sha256Hash,
        };
      }),
    );

    // Generate standalone proof bundles for ALL related entity chains
    let proofBundles: any[] = [];
    for (const eid of relatedEntityIds) {
      try {
        const entityProofs =
          await this.proofGenerator.generateEntityProofs(eid);
        proofBundles.push(...entityProofs.proofs);
      } catch {
        // If proof generation fails for an entity (e.g., no events), skip gracefully
      }
    }

    // ── Build document section ─────────────────────────────
    const document = {
      type: "PURCHASE_ORDER" as const,
      id: po.id,
      reference: po.referenceNumber,
      externalPoNumber: po.externalPoNumber,
      description: po.description,
      lineItems: po.lineItems,
      amount: po.amount,
      currency: po.currency,
      status: po.status,
      paymentTerms: po.paymentTerms,
      deliveryTerms: po.deliveryTerms,
      expectedDeliveryDate: po.expectedDeliveryDate,
      notes: po.notes,
      buyerContactName: po.buyerContactName,
      buyerContactEmail: po.buyerContactEmail,
      currentRevision: po.currentRevision,
      buyer: po.buyer,
      supplier: po.supplier,
      paymentLock: po.paymentLock
        ? { status: po.paymentLock.status, amount: po.paymentLock.amount }
        : null,
      settlements: po.settlements.map((s) => ({
        id: s.id,
        type: s.type,
        status: s.status,
        amount: s.amount,
        externalRef: s.externalRef,
      })),
      revisions:
        po.revisions?.map((r) => ({
          revision: r.revision,
          proposedBy: r.proposedBy,
          proposedByRole: r.proposedByRole,
          lineItems: r.lineItems,
          amount: r.amount,
          notes: r.notes,
          status: r.status,
          createdAt: r.createdAt,
        })) ?? [],
      createdAt: po.createdAt,
      settledAt: po.settledAt,
    };

    // Compute document hash
    const documentHash = this.crypto.sha256Hex(canonicalStringify(document));

    // ── Build actors array (deduplicated) ──────────────────
    const actors = await this.buildActors(proofBundles, po);

    // ── Build approvals array (signed events) ──────────────
    const approvals = this.buildApprovals(proofBundles);

    // ── Build ledger section (grouped by entity chain) ─────
    const formatEvent = (e: any) => ({
      id: e.id,
      sequence: e.sequence,
      entityType: e.entityType,
      entityId: e.entityId,
      entitySequence: e.entitySequence,
      eventType: e.eventType,
      actorId: e.actorId,
      actorRole: e.actorRole,
      payload: e.payload,
      timestamp: e.timestamp,
      eventHash: e.eventHash,
      previousHash: e.previousHash,
      actorSignature: e.actorSignature,
      intentHash: e.intentHash,
    });

    // Group events by entity for structured output
    const entityChains: Record<
      string,
      { entityType: string; entityId: string; events: any[] }
    > = {};
    for (const e of ledgerEvents) {
      if (!entityChains[e.entityId]) {
        entityChains[e.entityId] = {
          entityType: e.entityType,
          entityId: e.entityId,
          events: [],
        };
      }
      entityChains[e.entityId].events.push(formatEvent(e));
    }

    const ledger = {
      chainAlgorithm: "SHA-256",
      hashInputFormat:
        "previousHash|entityType|entityId|entitySequence|eventType|actorId|actorRole|canonicalPayload|timestamp",
      entityChains: Object.values(entityChains),
      events: ledgerEvents.map(formatEvent),
    };

    // ── Build attachments section ──────────────────────────
    const formattedAttachments = attachments.map((a) => ({
      id: a.id,
      type: a.type,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      sha256Hash: a.sha256Hash,
      uploadedBy: a.uploader,
      createdAt: a.createdAt,
    }));

    // ── Compute integrity hashes ───────────────────────────
    const eventHashes = ledgerEvents.map((e) => e.eventHash);
    const ledgerRootHash =
      eventHashes.length > 0
        ? this.crypto.sha256Hex(eventHashes.join("|"))
        : this.crypto.sha256Hex("EMPTY");

    const attachmentHashes = attachments.map((a) => a.sha256Hash);
    const attachmentsHash =
      attachmentHashes.length > 0
        ? this.crypto.sha256Hex(attachmentHashes.join("|"))
        : this.crypto.sha256Hex("NONE");

    const envelopeHash = this.crypto.sha256Hex(
      `${documentHash}|${ledgerRootHash}|${attachmentsHash}`,
    );

    const signedEventCount = proofBundles.filter(
      (b: any) => b.verification?.isCryptographicallySigned,
    ).length;

    // ── Sign envelope with platform key ───────────────────
    const { signature: platformSig, publicKey: platformPubKey } =
      this.crypto.signWithPlatformKey(envelopeHash);

    // ── Assemble Trust Envelope ────────────────────────────
    return {
      metadata: {
        envelopeId: `tenv_${this.crypto.randomUUID()}`,
        packVersion: "2.0",
        schemaVersion: "trust-envelope-v1",
        generatedAt: new Date().toISOString(),
        generator: "sme-payments-trust-ledger",
        hashAlgorithm: "SHA-256",
        signatureAlgorithm: "WebAuthn-FIDO2-ES256 (ECDSA P-256)",
        canonicalization: {
          algorithm:
            "Recursive key-sorted JSON, no whitespace, dates as ISO-8601",
          implementation:
            "Object.keys(obj).sort() applied recursively; arrays preserve order",
        },
      },

      actors,

      document: {
        ...document,
        documentHash,
      },

      paymentInstrument: await this.buildInstrumentSection(
        po.paymentInstrument,
      ),

      reconciliation: await this.buildReconciliationSection(purchaseOrderId),

      attachments: formattedAttachments,

      ledger,

      approvals,

      proofBundles,

      integrity: {
        documentHash,
        ledgerRootHash,
        attachmentsHash,
        envelopeHash,
        eventCount: ledgerEvents.length,
        attachmentCount: attachments.length,
        signedEventCount,
        unsignedEventCount: ledgerEvents.length - signedEventCount,
        fileIntegrity,
      },

      verification: {
        instructions:
          "Download verify-evidence-pack.mjs and run: node verify-evidence-pack.mjs <this-file.json>",
        checksToPerform: [
          "Verify ledger hash chain integrity (recompute every eventHash)",
          "Verify entity chain continuity (previousHash links)",
          "Verify payload hashes match canonical payloads",
          "Verify WebAuthn intent hash binding (signed events)",
          "Verify ECDSA P-256 signatures against embedded public keys",
          "Verify integrity root hashes (documentHash, ledgerRootHash, envelopeHash)",
          "Verify attachment content hashes",
          "Cross-check actor identities via public registry URIs",
          "Verify platform signature over envelopeHash",
          "Verify Merkle inclusion proof (entity leaf → anchor root)",
          "Verify external anchor receipt (Rekor transparency log)",
          "Verify instrument lifecycle integrity (CREATED → LOCKED → SETTLED matches PO lifecycle)",
          "Verify bank reference consistency (instrument.bankRef matches settlement.externalRef)",
        ],
      },

      platformSignature: {
        algorithm: "ECDSA-P256-SHA256",
        signature: platformSig,
        publicKey: platformPubKey,
        signedAt: new Date().toISOString(),
        signedFields: "envelopeHash",
      },
      notarization: await this.buildNotarization(purchaseOrderId),
    };
  }

  /**
   * Build notarization section with Merkle inclusion proof + external anchor.
   *
   * This proves that the PO entity's chain head was included in a global
   * Merkle tree, and (if externally anchored) that the tree root was
   * published to a public transparency log before a specific timestamp.
   */
  private async buildNotarization(
    entityId: string,
  ): Promise<TrustEnvelope["notarization"]> {
    try {
      // Get inclusion proof (Merkle path + external anchor info)
      const inclusionResult =
        await this.anchorService.getInclusionProof(entityId);
      if (!inclusionResult.found || !inclusionResult.anchor) return null;

      // Also get the full anchor record for metadata
      const anchor = await this.anchorService.getAnchorForEntity(entityId);
      if (!anchor) return null;

      const externalAnchor = inclusionResult.anchor.externalAnchor;

      return {
        merkleRoot: inclusionResult.anchor.merkleRoot,
        merkleProof: inclusionResult.proof!,
        anchor: {
          anchorId: inclusionResult.anchor.anchorId,
          anchorHash: anchor.anchorHash,
          previousAnchorHash: anchor.previousAnchorHash,
          eventCount: anchor.eventCount,
          entityCount: anchor.entityCount,
          createdAt: anchor.createdAt.toISOString(),
        },
        externalAnchor: externalAnchor?.provider
          ? {
              provider: externalAnchor.provider!,
              externalId: externalAnchor.externalId!,
              verificationUrl: externalAnchor.verificationUrl!,
              anchoredAt: externalAnchor.anchoredAt?.toISOString() ?? "",
              proof: (anchor.externalProof as Record<string, unknown>) ?? null,
            }
          : null,
        algorithm: "SHA-256-Merkle-Tree",
        verificationUri: `${this.baseUrl}/ledger/anchors/proof/${entityId}`,
      };
    } catch {
      return null;
    }
  }

  /**
   * Build paymentInstrument section with full lifecycle timeline.
   *
   * Queries ledger events for INSTRUMENT_* events to reconstruct
   * the instrument's lifecycle transitions.
   */
  private async buildInstrumentSection(
    instrument: any | null,
  ): Promise<TrustEnvelope["paymentInstrument"]> {
    if (!instrument) return null;

    // Reconstruct lifecycle from ledger events
    const events = await this.prisma.eventLog.findMany({
      where: {
        entityId: instrument.id,
        eventType: {
          in: [
            "INSTRUMENT_CREATED",
            "INSTRUMENT_LOCKED",
            "INSTRUMENT_SETTLED",
            "FINANCING_REQUESTED",
            "FINANCING_FUNDED",
            "INSTRUMENT_FAILED",
          ],
        },
      },
      orderBy: { sequence: "asc" },
    });

    const lifecycle = events.map((e) => {
      const payload = e.payload as Record<string, unknown>;
      const status =
        e.eventType === "INSTRUMENT_CREATED"
          ? "CREATED"
          : e.eventType === "INSTRUMENT_LOCKED"
            ? "LOCKED"
            : e.eventType === "INSTRUMENT_SETTLED"
              ? "SETTLED"
              : e.eventType === "FINANCING_REQUESTED"
                ? "FINANCING_REQUESTED"
                : e.eventType === "FINANCING_FUNDED"
                  ? "FINANCING_FUNDED"
                  : "FAILED";
      return {
        status,
        at: e.timestamp.toISOString(),
        bankRef: (payload?.bankReference as string) ?? null,
      };
    });

    // If no ledger events yet, at least show current state
    if (lifecycle.length === 0) {
      lifecycle.push({
        status: instrument.status,
        at: instrument.createdAt.toISOString(),
        bankRef: instrument.bankReference,
      });
    }

    // Load escrow account if linked
    let escrowAccount: {
      id: string;
      label: string;
      bank: string;
      country: string;
      currency: string;
    } | null = null;
    if (instrument.escrowAccountId) {
      const ea = await this.prisma.escrowAccount.findUnique({
        where: { id: instrument.escrowAccountId },
        select: {
          id: true,
          label: true,
          bank: true,
          country: true,
          currency: true,
        },
      });
      if (ea) escrowAccount = { ...ea, currency: ea.currency as string };
    }

    return {
      instrumentId: instrument.id,
      type: instrument.type,
      amount: instrument.amount,
      currency: instrument.currency,
      status: instrument.status,
      settlementBeneficiary: instrument.settlementBeneficiary ?? "SUPPLIER",
      escrowReference: instrument.escrowReference,
      bankReference: instrument.bankReference,
      escrowAccount,
      lifecycle,
    };
  }

  /**
   * Build reconciliation section from the most recent reconciliation report.
   */
  private async buildReconciliationSection(
    purchaseOrderId: string,
  ): Promise<TrustEnvelope["reconciliation"]> {
    try {
      const latestReport = await this.prisma.reconciliationReport.findFirst({
        orderBy: { runAt: "desc" },
      });
      if (!latestReport) return null;

      return {
        lastChecked: latestReport.runAt.toISOString(),
        status:
          latestReport.mismatches === 0 ? "CONSISTENT" : "MISMATCH_DETECTED",
        bankBalance: latestReport.bankBalance,
        ledgerBalance: latestReport.ledgerBalance,
        variance: latestReport.variance,
      };
    } catch {
      return null;
    }
  }

  /**
   * Build deduplicated actors array from proof bundles and PO participants.
   */
  private async buildActors(
    proofBundles: any[],
    po: any,
  ): Promise<TrustEnvelopeActor[]> {
    const actorMap = new Map<string, TrustEnvelopeActor>();

    // Extract actors from proof bundles (richest source — has org info)
    for (const bundle of proofBundles) {
      const userId = bundle.signer?.userId;
      if (!userId) continue;

      if (!actorMap.has(userId)) {
        actorMap.set(userId, {
          id: userId,
          role: bundle.signer.role,
          name: bundle.signer.name,
          email: bundle.signer.email,
          companyName: bundle.signer.organisation?.name ?? null,
          jurisdiction: bundle.signer.organisation?.jurisdiction ?? null,
          organisationType: bundle.signer.organisation?.type ?? null,
          credentials: [],
          identityResolutionUri: `${this.baseUrl}/proofs/identity/signers/${userId}`,
        });
      }

      // Add credential if not already present
      const actor = actorMap.get(userId)!;
      const cred = bundle.credential;
      if (
        cred &&
        cred.credentialId !== "SYSTEM" &&
        !actor.credentials.some(
          (c: any) => c.credentialId === cred.credentialId,
        )
      ) {
        actor.credentials.push({
          credentialId: cred.credentialId,
          publicKeyBase64: cred.publicKeyBase64,
          deviceType: cred.deviceType,
          backedUp: cred.backedUp,
          registeredAt: cred.registeredAt,
          resolutionUri: cred.publicKeyResolutionUri,
        });
      }
    }

    // Ensure buyer and supplier are present even if they have no events
    for (const participant of [
      { user: po.buyer, role: "BUYER" },
      { user: po.supplier, role: "SUPPLIER" },
    ]) {
      if (participant.user && !actorMap.has(participant.user.id)) {
        actorMap.set(participant.user.id, {
          id: participant.user.id,
          role: participant.role,
          name: participant.user.name,
          email: null,
          companyName: participant.user.companyName,
          jurisdiction: null,
          organisationType: null,
          credentials: [],
          identityResolutionUri: `${this.baseUrl}/proofs/identity/signers/${participant.user.id}`,
        });
      }
    }

    return Array.from(actorMap.values());
  }

  /**
   * Extract explicit approval records from signed proof bundles.
   */
  private buildApprovals(proofBundles: any[]): TrustEnvelopeApproval[] {
    return proofBundles
      .filter(
        (b: any) => b.verification?.isCryptographicallySigned && b.assertion,
      )
      .map((b: any) => ({
        eventId: b.proofId,
        eventType: b.intent.eventType,
        actorId: b.signer.userId,
        actorRole: b.signer.role,
        method: "passkey" as const,
        credentialId: b.credential.credentialId,
        intentHash: b.assertion.intentHash,
        signature: b.assertion.signature,
        timestamp: b.intent.timestamp,
      }));
  }

  private format(a: any) {
    return {
      id: a.id,
      purchaseOrderId: a.purchaseOrderId,
      uploaderId: a.uploaderId,
      type: a.type,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      sha256Hash: a.sha256Hash,
      eventLogId: a.eventLogId,
      description: a.description,
      createdAt: a.createdAt,
      uploader: a.uploader || undefined,
    };
  }
}
