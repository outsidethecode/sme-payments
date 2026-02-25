import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createHash } from "crypto";

/**
 * Canonical JSON serialization with sorted keys.
 * PostgreSQL JSONB does not preserve key order, so we must sort
 * keys deterministically before hashing to ensure verify-after-read works.
 * Also handles Date objects which JSONB stores as ISO strings.
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

export interface LogEventInput {
  entityType: string;
  entityId: string;
  eventType: string;
  actorId: string;
  actorRole: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

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

    const eventHash = createHash("sha256").update(hashInput).digest("hex");

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
        // For MVP, we use a placeholder signature — real Passkey signing comes later
        actorSignature: "MVP_PLACEHOLDER",
        actorPublicKey: "MVP_PLACEHOLDER",
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
  async verifyChain(
    entityId: string,
  ): Promise<{ valid: boolean; eventCount?: number; details: string }> {
    const events = await this.prisma.eventLog.findMany({
      where: { entityId },
      orderBy: { entitySequence: "asc" },
    });

    if (events.length === 0) {
      return { valid: true, details: "No events found for this entity" };
    }

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

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

      const expectedHash = createHash("sha256").update(hashInput).digest("hex");

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
      details: `All ${events.length} events verified successfully`,
    };
  }
}
