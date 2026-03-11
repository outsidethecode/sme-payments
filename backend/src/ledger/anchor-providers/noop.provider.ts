import { Logger } from "@nestjs/common";
import type {
  AnchorProvider,
  AnchorReceipt,
} from "./anchor-provider.interface";

/**
 * No-op Anchor Provider — Used when external anchoring is disabled.
 *
 * Returns a receipt with provider="none" so the system continues
 * working without external dependencies (development, testing, offline).
 */
export class NoopAnchorProvider implements AnchorProvider {
  readonly name = "none";

  private readonly logger = new Logger(NoopAnchorProvider.name);

  async anchor(
    merkleRoot: string,
    _signature: string,
    _publicKeyPem: string,
  ): Promise<AnchorReceipt> {
    this.logger.warn(
      `External anchoring disabled — Merkle root ${merkleRoot.substring(0, 16)}... not published`,
    );

    return {
      provider: this.name,
      externalId: `local-${Date.now()}`,
      proof: { note: "External anchoring disabled — internal anchor only" },
      verificationUrl: "",
      anchoredAt: new Date(),
    };
  }

  async verify(_receipt: AnchorReceipt): Promise<boolean> {
    // No-op provider receipts cannot be verified externally
    return false;
  }
}
