import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CRYPTO_SERVICE,
  type ICryptoService,
} from "../crypto/crypto.interface";
import {
  buildEntityMerkleTree,
  generateEntityProof,
  type MerkleProofStep,
} from "../crypto/merkle-tree";
import {
  ANCHOR_PROVIDER,
  type AnchorProvider,
  type AnchorReceipt,
} from "./anchor-providers/anchor-provider.interface";

/**
 * Ledger Anchoring Service — Periodic Global Integrity Snapshots with Merkle Trees.
 *
 * Creates cryptographic snapshots of all entity chain heads using a binary
 * SHA-256 Merkle tree, signs the Merkle root with the platform key, and
 * publishes to an external transparency service (Sigstore Rekor by default)
 * for non-repudiation.
 *
 * This prevents the platform operator from rewriting history — external
 * timestamps freeze the ledger state at a provable point in time.
 *
 * Anchor chain: each anchor links to the previous anchor hash, making
 * the anchor log itself tamper-evident.
 *
 * Merkle tree enables per-entity inclusion proofs: a bank can verify that
 * a specific entity's chain head was part of the global snapshot without
 * seeing any other entity's data.
 */
@Injectable()
export class AnchorService {
  private readonly logger = new Logger(AnchorService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CRYPTO_SERVICE) private readonly crypto: ICryptoService,
    @Inject(ANCHOR_PROVIDER) private readonly anchorProvider: AnchorProvider,
  ) {}

  /**
   * Create a new ledger anchor (global integrity snapshot).
   *
   * 1. Gathers the latest event hash for every entity in the ledger
   * 2. Builds a binary SHA-256 Merkle tree over entity head hashes
   * 3. Signs the Merkle root with the platform key
   * 4. Publishes to external transparency service (Rekor)
   * 5. Stores anchor with Merkle leaves, external proof, and prev link
   *
   * @param options.skipExternal  Skip external anchoring (for testing)
   */
  async createAnchor(options: { skipExternal?: boolean } = {}): Promise<{
    anchorId: string;
    anchorHash: string;
    merkleRoot: string;
    previousAnchorHash: string | null;
    eventCount: number;
    entityCount: number;
    externalAnchor: AnchorReceipt | null;
    createdAt: Date;
  }> {
    // Get the latest event hash for each entity
    const entityHeads = await this.prisma.$queryRaw<
      { entity_id: string; event_hash: string }[]
    >`
      SELECT DISTINCT ON (entity_id)
        entity_id,
        event_hash
      FROM event_log
      ORDER BY entity_id, entity_sequence DESC
    `;

    if (entityHeads.length === 0) {
      throw new Error("No events in ledger — cannot create anchor");
    }

    // Build head hashes map
    const headHashes: Record<string, string> = {};
    for (const head of entityHeads) {
      headHashes[head.entity_id] = head.event_hash;
    }

    // Build Merkle tree over entity heads
    const tree = buildEntityMerkleTree(headHashes);
    const merkleRoot = tree.root;

    // The anchorHash is the Merkle root
    const anchorHash = merkleRoot;

    // Ordered leaf hashes for proof generation
    const merkleLeaves = tree.entityOrder.map((entityId, i) => ({
      entityId,
      leafHash: tree.leaves[i],
      headHash: headHashes[entityId],
    }));

    // Get total event count
    const eventCount = await this.prisma.eventLog.count();

    // Get previous anchor for chaining
    const lastAnchor = await this.prisma.ledgerAnchor.findFirst({
      orderBy: { sequence: "desc" },
      select: { anchorHash: true, eventCount: true, anchorProvider: true },
    });

    // If the Merkle root hasn't changed (same events), check whether we need
    // to upgrade the existing anchor with external anchoring.
    if (lastAnchor?.anchorHash === anchorHash) {
      // If the previous anchor already has external anchoring, nothing to do
      if (lastAnchor.anchorProvider) {
        this.logger.log(
          "Anchor already exists with same hash and external anchoring — skipping",
        );
        const existing = await this.prisma.ledgerAnchor.findFirst({
          where: { anchorHash },
        });
        return {
          anchorId: existing!.id,
          anchorHash: existing!.anchorHash,
          merkleRoot,
          previousAnchorHash: existing!.previousAnchorHash,
          eventCount: existing!.eventCount,
          entityCount: existing!.entityCount,
          externalAnchor: existing!.externalProof
            ? ({
                provider: existing!.anchorProvider,
                externalId: existing!.externalId,
                proof: existing!.externalProof,
                verificationUrl: existing!.externalUrl,
                anchoredAt: existing!.anchoredAt,
              } as AnchorReceipt)
            : null,
          createdAt: existing!.createdAt,
        };
      }

      // Previous anchor exists with same hash but no external anchoring.
      // Upgrade it with external anchoring if available.
      if (!options.skipExternal && this.anchorProvider.name !== "none") {
        this.logger.log("Upgrading existing anchor with external anchoring...");
        const { signature } = this.crypto.signWithPlatformKey(merkleRoot);
        const publicKeyPem = this.crypto.getPlatformPublicKeyPem();
        try {
          const receipt = await this.anchorProvider.anchor(
            merkleRoot,
            signature,
            publicKeyPem,
          );
          const updated = await this.prisma.ledgerAnchor.update({
            where: { anchorHash },
            data: {
              anchorProvider: receipt.provider,
              externalId: receipt.externalId,
              externalProof: (receipt.proof as any) ?? null,
              externalUrl: receipt.verificationUrl ?? null,
              anchoredAt: receipt.anchoredAt ?? null,
            },
          });
          this.logger.log(
            `Anchor upgraded: ${receipt.provider} → ${receipt.externalId}`,
          );
          return {
            anchorId: updated.id,
            anchorHash: updated.anchorHash,
            merkleRoot,
            previousAnchorHash: updated.previousAnchorHash,
            eventCount: updated.eventCount,
            entityCount: updated.entityCount,
            externalAnchor: receipt,
            createdAt: updated.createdAt,
          };
        } catch (err) {
          this.logger.error(`External anchoring upgrade failed: ${err}`);
        }
      }

      // Nothing changed and no upgrade possible
      this.logger.log("Anchor already exists with same hash — no changes");
      const existing = await this.prisma.ledgerAnchor.findFirst({
        where: { anchorHash },
      });
      return {
        anchorId: existing!.id,
        anchorHash: existing!.anchorHash,
        merkleRoot,
        previousAnchorHash: existing!.previousAnchorHash,
        eventCount: existing!.eventCount,
        entityCount: existing!.entityCount,
        externalAnchor: null,
        createdAt: existing!.createdAt,
      };
    }

    // Sign the Merkle root with platform key
    const { signature, publicKey } =
      this.crypto.signWithPlatformKey(merkleRoot);

    // Publish to external transparency service
    let externalAnchor: AnchorReceipt | null = null;
    if (!options.skipExternal && this.anchorProvider.name !== "none") {
      try {
        const publicKeyPem = this.crypto.getPlatformPublicKeyPem();
        externalAnchor = await this.anchorProvider.anchor(
          merkleRoot,
          signature,
          publicKeyPem,
        );
        this.logger.log(
          `External anchor: ${externalAnchor.provider} → ${externalAnchor.externalId}`,
        );
      } catch (err) {
        this.logger.error(`External anchoring failed: ${err}`);
        // Don't fail the anchor — internal anchor still valid
        // External anchoring is best-effort
      }
    }

    // Store the anchor
    const anchor = await this.prisma.ledgerAnchor.create({
      data: {
        anchorHash,
        previousAnchorHash: lastAnchor?.anchorHash ?? null,
        eventCount,
        entityCount: entityHeads.length,
        headHashes: headHashes as any,
        merkleLeaves: merkleLeaves as any,
        anchorProvider: externalAnchor?.provider ?? null,
        externalId: externalAnchor?.externalId ?? null,
        externalProof: (externalAnchor?.proof as any) ?? null,
        externalUrl: externalAnchor?.verificationUrl ?? null,
        anchoredAt: externalAnchor?.anchoredAt ?? null,
      },
    });

    this.logger.log(
      `Anchor created: merkleRoot=${merkleRoot.substring(0, 16)}... ` +
        `(${eventCount} events, ${entityHeads.length} entities` +
        `${externalAnchor ? `, external=${externalAnchor.provider}` : ", no external"})`,
    );

    return {
      anchorId: anchor.id,
      anchorHash: anchor.anchorHash,
      merkleRoot,
      previousAnchorHash: anchor.previousAnchorHash,
      eventCount: anchor.eventCount,
      entityCount: anchor.entityCount,
      externalAnchor,
      createdAt: anchor.createdAt,
    };
  }

  /**
   * Get a Merkle inclusion proof for a specific entity.
   *
   * Given an entity ID, finds the most recent anchor that covers it
   * and returns the Merkle proof path from the entity's leaf to the root.
   *
   * A bank can use this proof to verify:
   *   1. The entity's chain head was included in the Merkle root
   *   2. The Merkle root was published to Rekor (external timestamp)
   *   3. Therefore, the entity's state existed before the external timestamp
   */
  async getInclusionProof(entityId: string): Promise<{
    found: boolean;
    anchor?: {
      anchorId: string;
      merkleRoot: string;
      anchoredAt: Date | null;
      externalAnchor: {
        provider: string | null;
        externalId: string | null;
        verificationUrl: string | null;
        anchoredAt: Date | null;
      };
    };
    proof?: {
      entityId: string;
      leafHash: string;
      headHash: string;
      path: MerkleProofStep[];
    };
  }> {
    // Find the most recent anchor that includes this entity
    const anchors = await this.prisma.ledgerAnchor.findMany({
      orderBy: { sequence: "desc" },
      take: 20,
    });

    for (const anchor of anchors) {
      const headHashes = anchor.headHashes as Record<string, string>;
      if (!headHashes[entityId]) continue;

      // Generate Merkle proof from stored head hashes
      const proofResult = generateEntityProof(headHashes, entityId);
      if (!proofResult) continue;

      return {
        found: true,
        anchor: {
          anchorId: anchor.id,
          merkleRoot: anchor.anchorHash,
          anchoredAt: anchor.anchoredAt,
          externalAnchor: {
            provider: anchor.anchorProvider,
            externalId: anchor.externalId,
            verificationUrl: anchor.externalUrl,
            anchoredAt: anchor.anchoredAt,
          },
        },
        proof: {
          entityId,
          leafHash: proofResult.leafHash,
          headHash: headHashes[entityId],
          path: proofResult.proof,
        },
      };
    }

    return { found: false };
  }

  /**
   * Verify the anchor chain integrity.
   *
   * 1. Fetches all anchors in order
   * 2. Verifies each anchor's previousAnchorHash matches the preceding anchor
   * 3. Re-derives the Merkle root from stored headHashes
   * 4. Reports external anchoring status
   */
  async verifyAnchorChain(): Promise<{
    valid: boolean;
    anchorCount: number;
    externallyAnchored: number;
    details: string;
  }> {
    const anchors = await this.prisma.ledgerAnchor.findMany({
      orderBy: { sequence: "asc" },
    });

    if (anchors.length === 0) {
      return {
        valid: true,
        anchorCount: 0,
        externallyAnchored: 0,
        details: "No anchors yet",
      };
    }

    let externallyAnchored = 0;

    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];

      // Check chain linkage
      if (i === 0) {
        if (anchor.previousAnchorHash !== null) {
          return {
            valid: false,
            anchorCount: anchors.length,
            externallyAnchored,
            details: `First anchor should have null previousAnchorHash, got ${anchor.previousAnchorHash}`,
          };
        }
      } else {
        if (anchor.previousAnchorHash !== anchors[i - 1].anchorHash) {
          return {
            valid: false,
            anchorCount: anchors.length,
            externallyAnchored,
            details: `Anchor chain broken at sequence ${anchor.sequence}: expected ${anchors[i - 1].anchorHash}, got ${anchor.previousAnchorHash}`,
          };
        }
      }

      // Re-derive Merkle root from headHashes
      const headHashes = anchor.headHashes as Record<string, string>;
      const tree = buildEntityMerkleTree(headHashes);

      if (tree.root !== anchor.anchorHash) {
        return {
          valid: false,
          anchorCount: anchors.length,
          externallyAnchored,
          details: `Merkle root mismatch at sequence ${anchor.sequence}: recomputed ${tree.root}, stored ${anchor.anchorHash}`,
        };
      }

      if (anchor.anchorProvider) {
        externallyAnchored++;
      }
    }

    const latest = anchors[anchors.length - 1];
    return {
      valid: true,
      anchorCount: anchors.length,
      externallyAnchored,
      details:
        `All ${anchors.length} anchors verified (${externallyAnchored} externally anchored). ` +
        `Latest: ${latest.anchorHash.substring(0, 16)}... (${latest.eventCount} events)`,
    };
  }

  /**
   * Get the latest anchor (for inclusion in evidence packs).
   */
  async getLatestAnchor() {
    return this.prisma.ledgerAnchor.findFirst({
      orderBy: { sequence: "desc" },
    });
  }

  /**
   * Get an anchor that covers a specific entity event hash.
   * Returns the earliest anchor whose headHashes include the given entity
   * with a hash that is equal to or follows the given event hash in the chain.
   */
  async getAnchorForEntity(entityId: string) {
    const anchors = await this.prisma.ledgerAnchor.findMany({
      orderBy: { sequence: "desc" },
      take: 10,
    });

    for (const anchor of anchors) {
      const headHashes = anchor.headHashes as Record<string, string>;
      if (headHashes[entityId]) {
        return anchor;
      }
    }

    return null;
  }
}
