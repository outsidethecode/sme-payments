import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { ProofGeneratorService } from "../proofs/proof-generator.service";
import * as crypto from "crypto";
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly proofGenerator: ProofGeneratorService,
  ) {
    // Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
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
    const sha256Hash = crypto
      .createHash("sha256")
      .update(file.buffer)
      .digest("hex");

    // Store file locally
    const ext = path.extname(file.originalname) || "";
    const storageName = `${crypto.randomUUID()}${ext}`;
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
    const computedHash = crypto
      .createHash("sha256")
      .update(fileBuffer)
      .digest("hex");

    return {
      valid: computedHash === attachment.sha256Hash,
      storedHash: attachment.sha256Hash,
      computedHash,
    };
  }

  /**
   * Build an evidence pack for a PO — all attachments + ledger events + hashes.
   */
  async buildEvidencePack(purchaseOrderId: string): Promise<{
    purchaseOrder: any;
    attachments: any[];
    ledgerEvents: any[];
    proofBundles: any[];
    integrity: {
      attachmentId: string;
      filename: string;
      valid: boolean;
      sha256: string;
    }[];
    generatedAt: string;
  }> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        buyer: { select: { id: true, name: true, companyName: true } },
        supplier: { select: { id: true, name: true, companyName: true } },
        paymentLock: true,
        settlements: true,
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

    const ledgerEvents = await this.prisma.eventLog.findMany({
      where: { entityId: purchaseOrderId },
      orderBy: { entitySequence: "asc" },
    });

    // Verify integrity of all attachments
    const integrity = await Promise.all(
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

    // Generate standalone proof bundles for all events
    let proofBundles: any[] = [];
    try {
      const entityProofs =
        await this.proofGenerator.generateEntityProofs(purchaseOrderId);
      proofBundles = entityProofs.proofs;
    } catch {
      // If proof generation fails (e.g., no events), skip gracefully
      proofBundles = [];
    }

    return {
      purchaseOrder: {
        id: po.id,
        reference: po.referenceNumber,
        externalPoNumber: po.externalPoNumber,
        amount: po.amount,
        currency: po.currency,
        status: po.status,
        paymentTerms: po.paymentTerms,
        deliveryTerms: po.deliveryTerms,
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
        createdAt: po.createdAt,
        settledAt: po.settledAt,
      },
      attachments: attachments.map((a) => ({
        id: a.id,
        type: a.type,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        sha256Hash: a.sha256Hash,
        uploadedBy: a.uploader,
        createdAt: a.createdAt,
      })),
      ledgerEvents: ledgerEvents.map((e) => ({
        id: e.id,
        sequence: e.sequence,
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
      })),
      proofBundles,
      integrity,
      generatedAt: new Date().toISOString(),
    };
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
