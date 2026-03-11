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
   * **Entity-scoped chain**: Each event links to the previous event for the
   * SAME entity, not the global ledger.  This eliminates the global mutex
   * and allows events for different entities to be written in parallel.
   *
   * The @@unique([entityId, entitySequence]) constraint prevents duplicate
   * sequences.  Retries on unique constraint violations (rare — only when
   * two requests try to append to the same entity simultaneously).
   */
  async logEvent(input: LogEventInput, _attempt = 1): Promise<any> {
    const MAX_RETRIES = 5;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const lastEntityEvent = await tx.eventLog.findFirst({
            where: { entityId: input.entityId },
            orderBy: { entitySequence: "desc" },
            select: { entitySequence: true, eventHash: true },
          });
          const entitySequence = (lastEntityEvent?.entitySequence ?? 0) + 1;
          const previousHash = lastEntityEvent?.eventHash ?? "GENESIS";

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
        { isolationLevel: "ReadCommitted" },
      );
    } catch (err: any) {
      const code = err?.code ?? err?.meta?.code;
      if ((code === "P2034" || code === "P2002") && _attempt < MAX_RETRIES) {
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
   * Verify entity-scoped hash chains.
   *
   * If entityId is provided, only that entity's chain is verified (O(entity events)).
   * Otherwise, all entities are verified (O(all events)).
   */
  async verifyChain(entityId?: string): Promise<{
    valid: boolean;
    eventCount?: number;
    signedCount?: number;
    details: string;
  }> {
    const where = entityId ? { entityId } : undefined;
    const allEvents = await this.prisma.eventLog.findMany({
      where,
      orderBy: { sequence: "asc" },
    });

    if (allEvents.length === 0) {
      return {
        valid: true,
        details: entityId
          ? "No events found for this entity"
          : "Ledger is empty",
      };
    }

    let signedCount = 0;

    // Group events by entity
    const entityGroups = new Map<string, typeof allEvents>();
    for (const event of allEvents) {
      const group = entityGroups.get(event.entityId) ?? [];
      group.push(event);
      entityGroups.set(event.entityId, group);

      const isSigned =
        event.actorSignature !== "SYSTEM" &&
        event.actorSignature !== "MVP_PLACEHOLDER";
      if (isSigned) signedCount++;
    }

    for (const [eid, events] of entityGroups) {
      events.sort((a, b) => a.entitySequence - b.entitySequence);

      for (let i = 0; i < events.length; i++) {
        const event = events[i];

        // Recompute hash
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
            details: `Hash mismatch for entity ${eid} at sequence ${event.entitySequence}`,
          };
        }

        // Check entity chain linkage
        if (i === 0) {
          if (event.previousHash !== "GENESIS") {
            return {
              valid: false,
              details: `First event for entity ${eid} should have GENESIS, got ${event.previousHash}`,
            };
          }
        } else {
          if (event.previousHash !== events[i - 1].eventHash) {
            return {
              valid: false,
              details: `Entity chain broken for ${eid} at sequence ${event.entitySequence}`,
            };
          }
        }
      }
    }

    return {
      valid: true,
      eventCount: allEvents.length,
      signedCount,
      details: entityId
        ? `Chain intact. Entity has ${allEvents.length} events (${signedCount} passkey-signed, ${allEvents.length - signedCount} system).`
        : `All ${allEvents.length} events verified across ${entityGroups.size} entities (${signedCount} passkey-signed, ${allEvents.length - signedCount} system).`,
    };
  }
}
