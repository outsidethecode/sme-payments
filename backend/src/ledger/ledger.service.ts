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
   *
   * Uses a SERIALIZABLE transaction so that the "read last hash → compute
   * new hash → insert" cycle is atomic.  Without this, concurrent writers
   * would both read the same previousHash and fork the chain.
   *
   * Postgres raises a serialization failure (40001) when two transactions
   * conflict.  We retry up to 5 times with exponential back-off.
   */
  async logEvent(input: LogEventInput, _attempt = 1): Promise<any> {
    const MAX_RETRIES = 5;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Per-entity sequence (for ordering within an entity)
          const lastEntityEvent = await tx.eventLog.findFirst({
            where: { entityId: input.entityId },
            orderBy: { entitySequence: "desc" },
            select: { entitySequence: true },
          });
          const entitySequence = (lastEntityEvent?.entitySequence ?? 0) + 1;

          // Global hash chain — every event links to the most recent event
          // in the entire ledger, regardless of entity.  Only the very first
          // event ever recorded gets GENESIS.
          const lastGlobalEvent = await tx.eventLog.findFirst({
            orderBy: { sequence: "desc" },
            select: { eventHash: true },
          });
          const previousHash = lastGlobalEvent?.eventHash ?? "GENESIS";

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

          return tx.eventLog.create({
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
        },
        { isolationLevel: "Serializable" },
      );
    } catch (err: any) {
      // Postgres serialization failure → retry with back-off
      const code = err?.code ?? err?.meta?.code;
      if (code === "P2034" && _attempt < MAX_RETRIES) {
        const delay = 10 * 2 ** _attempt + Math.random() * 10;
        await new Promise((r) => setTimeout(r, delay));
        return this.logEvent(input, _attempt + 1);
      }
      throw err;
    }
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
   * Verify the global hash chain (entire ledger) or just the events for
   * a specific entity.  The chain is always global — every event links to
   * the immediately preceding event regardless of entity.
   */
  async verifyChain(entityId?: string): Promise<{
    valid: boolean;
    eventCount?: number;
    signedCount?: number;
    details: string;
  }> {
    // Always fetch the full global chain to verify linkage
    const allEvents = await this.prisma.eventLog.findMany({
      orderBy: { sequence: "asc" },
    });

    if (allEvents.length === 0) {
      return { valid: true, details: "Ledger is empty" };
    }

    // Build a hash lookup so we can quickly check previousHash references
    const hashSet = new Set<string>();
    let signedCount = 0;
    let entityEventCount = 0;
    let entitySignedCount = 0;

    for (let i = 0; i < allEvents.length; i++) {
      const event = allEvents[i];

      const isSigned =
        event.actorSignature !== "SYSTEM" &&
        event.actorSignature !== "MVP_PLACEHOLDER";
      if (isSigned) signedCount++;

      // Check previous hash linkage (global chain)
      if (i === 0) {
        if (event.previousHash !== "GENESIS") {
          return {
            valid: false,
            details: `First ledger event should have GENESIS as previous hash, got ${event.previousHash}`,
          };
        }
      } else {
        if (event.previousHash !== allEvents[i - 1].eventHash) {
          return {
            valid: false,
            details: `Global hash chain broken at sequence ${event.sequence}: expected previous hash ${allEvents[i - 1].eventHash}, got ${event.previousHash}`,
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
          details: `Hash mismatch at global sequence ${event.sequence}: computed ${expectedHash}, stored ${event.eventHash}`,
        };
      }

      hashSet.add(event.eventHash);

      // Track entity-specific counts
      if (entityId && event.entityId === entityId) {
        entityEventCount++;
        if (isSigned) entitySignedCount++;
      }
    }

    if (entityId) {
      if (entityEventCount === 0) {
        return { valid: true, details: "No events found for this entity" };
      }
      return {
        valid: true,
        eventCount: entityEventCount,
        signedCount: entitySignedCount,
        details: `Global chain intact (${allEvents.length} total events). Entity has ${entityEventCount} events (${entitySignedCount} passkey-signed, ${entityEventCount - entitySignedCount} system)`,
      };
    }

    return {
      valid: true,
      eventCount: allEvents.length,
      signedCount,
      details: `All ${allEvents.length} events verified (${signedCount} passkey-signed, ${allEvents.length - signedCount} system)`,
    };
  }
}
