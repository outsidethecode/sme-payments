import { Logger } from "@nestjs/common";
import type {
  AnchorProvider,
  AnchorReceipt,
} from "./anchor-provider.interface";

/**
 * Sigstore Rekor Anchor Provider — Free public transparency log.
 *
 * Rekor is a transparency log for software supply chain integrity,
 * operated by the Linux Foundation as part of the Sigstore project.
 * We repurpose it as a financial ledger anchoring service.
 *
 * Flow:
 *   1. Platform signs the Merkle root with its ECDSA P-256 key
 *   2. POST to Rekor with hash + signature + public key
 *   3. Rekor returns a signed, timestamped log entry with inclusion proof
 *   4. Anyone can verify the entry at https://search.sigstore.dev
 *
 * Rekor API docs: https://www.sigstore.dev/rekor
 *
 * Entry type: "hashedrekord" v0.0.1
 *   - data.hash = SHA-256 of the artifact (our Merkle root hex string)
 *   - signature = ECDSA P-256 signature over the artifact
 *   - publicKey = platform public key in PEM format
 */
export class RekorAnchorProvider implements AnchorProvider {
  readonly name = "sigstore-rekor";

  private readonly logger = new Logger(RekorAnchorProvider.name);

  private readonly rekorUrl: string;

  constructor(rekorUrl?: string) {
    this.rekorUrl = rekorUrl ?? "https://rekor.sigstore.dev/api/v1/log/entries";
  }

  /**
   * Publish a Merkle root to Sigstore Rekor.
   *
   * @param merkleRoot   Hex-encoded Merkle root hash
   * @param signature    Platform signature over the merkleRoot string (base64)
   * @param publicKeyPem Platform public key in PEM format
   */
  async anchor(
    merkleRoot: string,
    signature: string,
    publicKeyPem: string,
  ): Promise<AnchorReceipt> {
    // Rekor expects the hash of the "artifact". Our artifact is the Merkle root
    // hex string itself. For hashedrekord, we provide the SHA-256 of the artifact.
    const { createHash } = await import("crypto");
    const artifactHash = createHash("sha256").update(merkleRoot).digest("hex");

    const entry = {
      kind: "hashedrekord",
      apiVersion: "0.0.1",
      spec: {
        data: {
          hash: {
            algorithm: "sha256",
            value: artifactHash,
          },
        },
        signature: {
          content: signature,
          publicKey: {
            content: Buffer.from(publicKeyPem).toString("base64"),
          },
        },
      },
    };

    this.logger.log(
      `Anchoring Merkle root ${merkleRoot.substring(0, 16)}... to Rekor`,
    );

    const response = await fetch(this.rekorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(entry),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `Rekor anchor failed (${response.status}): ${errorText}`,
      );
      throw new Error(
        `Rekor anchor failed with status ${response.status}: ${errorText}`,
      );
    }

    const data = await response.json();

    // Rekor returns { "<uuid>": { body, integratedTime, logID, logIndex, verification } }
    const [uuid, entryData] = Object.entries(data)[0] as [string, any];

    const receipt: AnchorReceipt = {
      provider: this.name,
      externalId: uuid,
      proof: {
        logIndex: entryData.logIndex,
        logID: entryData.logID,
        integratedTime: entryData.integratedTime,
        body: entryData.body,
        verification: entryData.verification ?? null,
      },
      verificationUrl: `https://search.sigstore.dev/?logIndex=${entryData.logIndex}`,
      anchoredAt: new Date(entryData.integratedTime * 1000),
    };

    this.logger.log(
      `Anchored to Rekor: logIndex=${entryData.logIndex}, uuid=${uuid.substring(0, 16)}...`,
    );

    return receipt;
  }

  /**
   * Verify an anchor receipt by querying Rekor for the entry.
   */
  async verify(receipt: AnchorReceipt): Promise<boolean> {
    if (receipt.provider !== this.name) return false;

    try {
      const lookupUrl = `${this.rekorUrl}/${receipt.externalId}`;
      const response = await fetch(lookupUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        this.logger.warn(
          `Rekor lookup failed (${response.status}) for ${receipt.externalId}`,
        );
        return false;
      }

      const data = await response.json();
      const [, entryData] = Object.entries(data)[0] as [string, any];

      // Verify the integrated time matches
      const proof = receipt.proof as Record<string, unknown>;
      return entryData.integratedTime === proof.integratedTime;
    } catch (err) {
      this.logger.warn(`Rekor verification error: ${err}`);
      return false;
    }
  }
}
