import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import {
  CRYPTO_SERVICE,
  type ICryptoService,
} from "../crypto/crypto.interface";
import { canonicalStringify } from "../crypto/canonical-stringify";
import type {
  ProofBundle,
  ProofSigner,
  ProofCredential,
  ProofAssertion,
  ProofEvidenceRef,
} from "./proof-bundle.schema";

@Injectable()
export class ProofGeneratorService {
  private readonly baseUrl: string;
  private readonly rpName: string;
  private readonly rpId: string;
  private readonly origin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(CRYPTO_SERVICE) private readonly crypto: ICryptoService,
  ) {
    this.baseUrl = this.config.get<string>(
      "BASE_URL",
      "http://localhost:3001/api",
    );
    this.rpName = this.config.get<string>(
      "WEBAUTHN_RP_NAME",
      "Programmable SME Settlement",
    );
    this.rpId = this.config.get<string>("WEBAUTHN_RP_ID", "localhost");
    this.origin = this.config.get<string>("WEBAUTHN_ORIGIN", "");
  }

  /**
   * Generate a standalone, self-contained proof bundle for a single event.
   *
   * This bundle contains everything an external verifier needs to
   * independently confirm the event's authenticity — without trusting
   * the platform.
   */
  async generateProof(eventId: string): Promise<ProofBundle> {
    const event = await this.prisma.eventLog.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    // ── Resolve signer identity ────────────────────────────
    const signer = await this.resolveSigner(event.actorId);
    // Use the actorRole recorded at event time (may be "SYSTEM" for
    // system-triggered events) so the proof bundle matches the hash input.
    signer.role = event.actorRole;

    // ── Resolve credential ─────────────────────────────────
    const credential = event.credentialId
      ? await this.resolveCredential(event.credentialId)
      : null;

    // ── Build assertion (only for cryptographically signed events) ──
    const isSigned =
      event.actorSignature !== "SYSTEM" &&
      event.actorSignature !== "MVP_PLACEHOLDER";
    const assertion: ProofAssertion | null = isSigned
      ? {
          intentHash: event.intentHash ?? "",
          clientDataJSON: event.clientDataJSON ?? "",
          authenticatorData: event.authenticatorData ?? "",
          signature: event.actorSignature,
        }
      : null;

    // ── Resolve evidence attachments for this entity ───────
    const evidence = await this.resolveEvidence(event.entityId, event.id);

    // ── Compute payload hash ───────────────────────────────
    const payloadHash = this.crypto.sha256Hex(
      canonicalStringify(event.payload),
    );

    return {
      version: "1.0",
      proofId: event.id,
      generatedAt: new Date().toISOString(),

      intent: {
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        payload: event.payload as Record<string, unknown>,
        timestamp: event.timestamp.toISOString(),
        payloadHash,
      },

      signer,

      credential: credential ?? {
        credentialId: "SYSTEM",
        publicKeyBase64: "SYSTEM",
        deviceType: null,
        backedUp: false,
        registeredAt: "",
        publicKeyResolutionUri: "",
      },

      assertion,

      issuer: {
        name: this.rpName,
        rpId: this.rpId,
        origin: this.origin,
        registryUri: `${this.baseUrl}/proofs/registry`,
        identityUri: `${this.baseUrl}/proofs/identity`,
      },

      chain: {
        eventHash: event.eventHash,
        previousHash: event.previousHash,
        entitySequence: event.entitySequence,
        hashAlgorithm: "SHA-256",
        hashInputFormat:
          "previousHash|entityType|entityId|entitySequence|eventType|actorId|actorRole|canonicalPayload|timestamp",
      },

      evidence,

      verification: isSigned
        ? {
            isCryptographicallySigned: true,
            algorithm: "WebAuthn-FIDO2-ES256",
            steps: [
              {
                step: 1,
                description:
                  "Recompute the intent hash from the business action fields",
                operation:
                  "SHA-256(intent.eventType + '|' + intent.entityId + '|' + signer.userId) → base64url",
                expected: "Must equal assertion.intentHash",
              },
              {
                step: 2,
                description:
                  "Decode the clientDataJSON to extract the challenge",
                operation:
                  "base64url-decode(assertion.clientDataJSON) → parse JSON → extract 'challenge' field",
                expected: "challenge === assertion.intentHash",
              },
              {
                step: 3,
                description:
                  "Resolve the signer's public key from the credential registry",
                operation: `GET ${this.baseUrl}/proofs/registry/credentials/{credential.credentialId}`,
                expected:
                  "Response publicKey must match credential.publicKeyBase64",
              },
              {
                step: 4,
                description:
                  "Resolve the signer identity from the identity registry",
                operation: `GET ${this.baseUrl}/proofs/identity/signers/{signer.userId}`,
                expected:
                  "Returned identity must match signer fields in this bundle",
              },
              {
                step: 5,
                description:
                  "Compute the signed data per WebAuthn specification",
                operation:
                  "clientDataHash = SHA-256(base64url-decode(assertion.clientDataJSON)); signedData = base64url-decode(assertion.authenticatorData) || clientDataHash",
                expected: "32-byte clientDataHash; concatenated signedData",
              },
              {
                step: 6,
                description:
                  "Verify the ECDSA P-256 signature over the signed data",
                operation:
                  "ECDSA.verify(signedData, assertion.signature, credential.publicKeyBase64) using COSE key format",
                expected: "Signature valid = true",
              },
              {
                step: 7,
                description:
                  "Verify the hash chain integrity (optional but recommended)",
                operation:
                  "Recompute SHA-256(chain.previousHash|intent.entityType|intent.entityId|chain.entitySequence|intent.eventType|signer.userId|signer.role|canonicalPayload|intent.timestamp)",
                expected: "Must equal chain.eventHash",
              },
            ],
          }
        : {
            isCryptographicallySigned: false,
            algorithm: "none",
            steps: [
              {
                step: 1,
                description:
                  "This event was recorded by the system without a passkey signature",
                operation: "N/A — only hash chain integrity can be verified",
                expected:
                  "Verify chain.eventHash using the hash input format above",
              },
            ],
          },
    };
  }

  /**
   * Generate proof bundles for all events of an entity (e.g., full PO lifecycle).
   */
  async generateEntityProofs(entityId: string): Promise<{
    entityId: string;
    proofCount: number;
    generatedAt: string;
    proofs: ProofBundle[];
    chainValid: boolean;
    chainSummary: string;
  }> {
    const events = await this.prisma.eventLog.findMany({
      where: { entityId },
      orderBy: { entitySequence: "asc" },
    });

    if (events.length === 0) {
      throw new NotFoundException("No events found for this entity");
    }

    const proofs = await Promise.all(
      events.map((e) => this.generateProof(e.id)),
    );

    // Verify each event's hash is recomputable (integrity check).
    // Full global chain verification is handled by GET /ledger/verify.
    let chainValid = true;
    let chainSummary = "";

    for (const p of proofs) {
      const ev = events.find((e) => e.id === p.proofId);
      if (!ev) {
        chainValid = false;
        chainSummary = `Event ${p.proofId} not found`;
        break;
      }

      // Recompute the hash the same way logEvent does
      const hashInput = [
        ev.previousHash,
        ev.entityType,
        ev.entityId,
        String(ev.entitySequence),
        ev.eventType,
        ev.actorId,
        ev.actorRole,
        canonicalStringify(ev.payload),
        ev.timestamp.toISOString(),
      ].join("|");

      const expected = this.crypto.sha256Hex(hashInput);
      if (expected !== ev.eventHash) {
        chainValid = false;
        chainSummary = `Hash mismatch at entity sequence ${ev.entitySequence}: computed ${expected}, stored ${ev.eventHash}`;
        break;
      }
    }

    const signedCount = proofs.filter(
      (p) => p.verification.isCryptographicallySigned,
    ).length;
    if (chainValid) {
      chainSummary = `All ${proofs.length} events verified (${signedCount} passkey-signed, ${proofs.length - signedCount} system). Use GET /ledger/verify for full global chain check.`;
    }

    return {
      entityId,
      proofCount: proofs.length,
      generatedAt: new Date().toISOString(),
      proofs,
      chainValid,
      chainSummary,
    };
  }

  // ── Private helpers ────────────────────────────────────────

  private async resolveSigner(userId: string): Promise<ProofSigner> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        orgMemberships: {
          include: {
            organisation: {
              select: {
                id: true,
                name: true,
                type: true,
                jurisdiction: true,
              },
            },
          },
          take: 1,
        },
      },
    });

    if (!user) {
      return {
        userId,
        name: "Unknown",
        email: "Unknown",
        role: "Unknown",
        organisation: null,
      };
    }

    const org = user.orgMemberships[0]?.organisation ?? null;

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organisation: org
        ? {
            id: org.id,
            name: org.name,
            type: org.type,
            jurisdiction: org.jurisdiction,
          }
        : null,
    };
  }

  private async resolveCredential(
    credentialId: string,
  ): Promise<ProofCredential | null> {
    const passkey = await this.prisma.userPasskey.findUnique({
      where: { credentialId },
    });

    if (!passkey) return null;

    return {
      credentialId: passkey.credentialId,
      publicKeyBase64: passkey.publicKey.toString("base64"),
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      registeredAt: passkey.createdAt.toISOString(),
      publicKeyResolutionUri: `${this.baseUrl}/proofs/registry/credentials/${encodeURIComponent(passkey.credentialId)}`,
    };
  }

  private async resolveEvidence(
    entityId: string,
    eventLogId: string,
  ): Promise<ProofEvidenceRef[]> {
    // Try to find evidence attachments linked to this specific event or to the entity
    const attachments = await this.prisma.evidenceAttachment.findMany({
      where: {
        OR: [{ eventLogId }, { purchaseOrderId: entityId }],
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sha256Hash: true,
        sizeBytes: true,
        uploaderId: true,
        createdAt: true,
      },
    });

    return attachments.map((a) => ({
      attachmentId: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      contentHash: a.sha256Hash,
      sizeBytes: a.sizeBytes,
      uploaderId: a.uploaderId,
      uploadedAt: a.createdAt.toISOString(),
    }));
  }
}
