/**
 * CryptoService interface — the single abstraction for all cryptographic operations.
 *
 * Every service in the platform that needs hashing, signature verification,
 * or random generation depends on this interface via NestJS DI token.
 *
 * To swap implementations (e.g., TS → Rust via napi-rs, or → HSM sidecar):
 *   1. Implement this interface
 *   2. Change the provider in CryptoModule
 *   3. All 226+ tests pass without modification
 */
export interface ICryptoService {
  // ── Hashing ────────────────────────────────────────────────

  /**
   * SHA-256 hash → hex string.
   */
  sha256Hex(input: string | Buffer): string;

  /**
   * SHA-256 hash → base64url string (used for WebAuthn challenges).
   */
  sha256Base64Url(input: string | Buffer): string;

  /**
   * SHA-256 hash → raw Buffer (used for WebAuthn clientDataHash).
   */
  sha256Buffer(input: Buffer): Buffer;

  // ── Signature verification ─────────────────────────────────

  /**
   * Verify an ECDSA P-256 signature (WebAuthn format).
   *
   * @param signedData  The data that was signed (authenticatorData || clientDataHash)
   * @param signature   Raw signature bytes (IEEE P1363 or DER)
   * @param publicKey   Public key bytes (COSE or SPKI DER)
   * @returns true if signature is valid
   */
  verifyEcdsaP256(
    signedData: Buffer,
    signature: Buffer,
    publicKey: Buffer,
  ): boolean;

  // ── Random ─────────────────────────────────────────────────

  /**
   * Generate a random UUID v4.
   */
  randomUUID(): string;
}

/**
 * DI token for the CryptoService.
 *
 * Usage in any service:
 *   constructor(@Inject(CRYPTO_SERVICE) private readonly crypto: ICryptoService) {}
 */
export const CRYPTO_SERVICE = "CRYPTO_SERVICE";
