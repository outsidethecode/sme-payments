import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CRYPTO_SERVICE,
  type ICryptoService,
} from "../crypto/crypto.interface";
import { canonicalStringify } from "../crypto/canonical-stringify";

/** Optional passkey signature data to attach to a ledger event. */
export interface SignatureData {
  signature: string;
  authenticatorData: string;
  publicKey: string;
  credentialId: string;
  intentHash?: string;
  clientDataJSON?: string;
}

export interface LogEventInput {
  entityType: string;
  entityId: string;
  eventType: string;
  actorId: string;
  actorRole: string;
  payload: Record<string, unknown>;
  /** Real passkey signature (base64). Falls back to SYSTEM if omitted. */
  signature?: string;
  /** Authenticator data from WebAuthn assertion (base64). */
  authenticatorData?: string;
  /** Actor's public key (base64). Falls back to SYSTEM if omitted. */
  publicKey?: string;
  /** Credential ID that produced the signature. */
  credentialId?: string;
  /** SHA-256 of the business intent, used as the WebAuthn challenge. */
  intentHash?: string;
  /** Raw WebAuthn clientDataJSON — contains the challenge + origin, needed for independent verification. */
  clientDataJSON?: string;
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CRYPTO_SERVICE) private readonly crypto: ICryptoService,
  ) {}

  /**
   * Compute the deterministic intent hash for a business action.
   * This becomes the WebAuthn challenge, binding the biometric
   * signature to this exact intent.
   */
  computeIntentHash(
    eventType: string,
    entityId: string,
    actorId: string,
  ): string {
    return this.crypto.sha256Base64Url(`${eventType}|${entityId}|${actorId}`);
  }

  /**
   * Append a new event to the immutable ledger with SHA-256 hash chaining.
   */
  async logEvent(input: LogEventInput) {
    // Get the sequence number for this entity
    const lastEntityEvent = await this.prisma.eventLog.findFirst({
      where: { entityId: input.entityId },
      orderBy: { entitySequence: "desc" },
      select: { entitySequence: true, eventHash: true },
    });

    const entitySequence = (lastEntityEvent?.entitySequence ?? 0) + 1;
    const previousHash = lastEntityEvent?.eventHash ?? "GENESIS";

    // Build the hash input: previousHash + eventData
    // We use canonicalStringify for the payload to ensure deterministic
    // serialization that survives PostgreSQL JSONB key-reordering.
    const timestamp = new Date();
    const hashInput = [
      previousHash,
      input.entityType,
      input.entityId,
      String(entitySequence),
      input.eventType,
      input.actorId,
      input.actorRole,
      canonicalStringify(input.payload),
      timestamp.toISOString(),
    ].join("|");

    const eventHash = this.crypto.sha256Hex(hashInput);

    // Use real passkey signature if provided, otherwise mark as SYSTEM
    const actorSignature = input.signature ?? "SYSTEM";
    const actorPublicKey = input.publicKey ?? "SYSTEM";
    const authenticatorData = input.authenticatorData ?? null;
    const credentialId = input.credentialId ?? null;

    return this.prisma.eventLog.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        entitySequence,
        eventType: input.eventType,
        actorId: input.actorId,
        actorRole: input.actorRole,
        payload: input.payload as any,
        timestamp,
        previousHash,
        eventHash,
        actorSignature,
        authenticatorData,
        actorPublicKey,
        credentialId,
        intentHash: input.intentHash ?? null,
        clientDataJSON: input.clientDataJSON ?? null,
      },
    });
  }

  /**
   * Get all events, optionally filtered by entity.
   */
  async getEvents(entityId?: string) {
    return this.prisma.eventLog.findMany({
      where: entityId ? { entityId } : undefined,
      orderBy: { sequence: "desc" },
      take: 100,
    });
  }

  /**
   * Verify the hash chain for a given entity.
   */
  async verifyChain(entityId: string): Promise<{
    valid: boolean;
    eventCount?: number;
    signedCount?: number;
    details: string;
  }> {
    const events = await this.prisma.eventLog.findMany({
      where: { entityId },
      orderBy: { entitySequence: "asc" },
    });

    if (events.length === 0) {
      return { valid: true, details: "No events found for this entity" };
    }

    let signedCount = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Track passkey-signed events
      if (
        event.actorSignature !== "SYSTEM" &&
        event.actorSignature !== "MVP_PLACEHOLDER"
      ) {
        signedCount++;
      }

      // Check previous hash linkage
      if (i === 0) {
        if (event.previousHash !== "GENESIS") {
          return {
            valid: false,
            details: `First event should have GENESIS as previous hash, got ${event.previousHash}`,
          };
        }
      } else {
        if (event.previousHash !== events[i - 1].eventHash) {
          return {
            valid: false,
            details: `Hash chain broken at sequence ${event.entitySequence}: expected previous hash ${events[i - 1].eventHash}, got ${event.previousHash}`,
          };
        }
      }

      // Recompute and verify hash using same canonical format as logEvent
      const hashInput = [
        event.previousHash,
        event.entityType,
        event.entityId,
        String(event.entitySequence),
        event.eventType,
        event.actorId,
        event.actorRole,
        canonicalStringify(event.payload),
        event.timestamp.toISOString(),
      ].join("|");

      const expectedHash = this.crypto.sha256Hex(hashInput);

      if (expectedHash !== event.eventHash) {
        return {
          valid: false,
          details: `Hash mismatch at sequence ${event.entitySequence}: computed ${expectedHash}, stored ${event.eventHash}`,
        };
      }
    }

    return {
      valid: true,
      eventCount: events.length,
      signedCount,
      details: `All ${events.length} events verified (${signedCount} passkey-signed, ${events.length - signedCount} system)`,
    };
  }
}
