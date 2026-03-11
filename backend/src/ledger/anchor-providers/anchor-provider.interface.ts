/**
 * Anchor Provider Interface — Abstract external anchoring.
 *
 * External anchoring publishes the Merkle root to a third-party
 * transparency service (Sigstore Rekor, OpenTimestamps, Bitcoin, etc.)
 * so that the platform operator cannot rewrite history.
 *
 * Providers are pluggable. The platform starts with Sigstore Rekor (free)
 * and can move to Bitcoin OP_RETURN or RFC 3161 TSA later.
 */

export const ANCHOR_PROVIDER = "ANCHOR_PROVIDER";

export interface AnchorReceipt {
  /** Provider identifier, e.g. "sigstore-rekor", "opentimestamps", "bitcoin" */
  provider: string;
  /** External unique ID (Rekor UUID, Bitcoin txId, TSA serial, etc.) */
  externalId: string;
  /** Provider-specific proof data (inclusion proof, signed timestamp, etc.) */
  proof: Record<string, unknown>;
  /** URL where a third party can independently verify the anchor */
  verificationUrl: string;
  /** Timestamp assigned by the external service (not the platform) */
  anchoredAt: Date;
}

export interface AnchorProvider {
  /** Human-readable provider name */
  readonly name: string;

  /**
   * Publish a hash to the external transparency service.
   *
   * @param merkleRoot - The hex-encoded Merkle root to anchor
   * @param signature  - Platform signature over the Merkle root (base64)
   * @param publicKeyPem - Platform public key in PEM format
   * @returns The receipt from the external service
   */
  anchor(
    merkleRoot: string,
    signature: string,
    publicKeyPem: string,
  ): Promise<AnchorReceipt>;

  /**
   * Verify an existing anchor receipt against the external service.
   * Returns true if the receipt is still valid in the external log.
   * May make a network call.
   */
  verify(receipt: AnchorReceipt): Promise<boolean>;
}
