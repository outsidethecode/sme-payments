import { Injectable } from "@nestjs/common";
import { createHash, createVerify, randomUUID } from "crypto";
import type { ICryptoService } from "./crypto.interface";

/**
 * Node.js / OpenSSL implementation of the CryptoService.
 *
 * All actual cryptographic primitives are delegated to Node's `crypto` module,
 * which is a C++ binding to OpenSSL — not pure JavaScript.
 *
 * This class owns ALL low-level crypto calls. No other service in the platform
 * should import `createHash`, `createVerify`, or `randomUUID` directly.
 *
 * To replace with Rust (via napi-rs or sidecar):
 *   1. Implement ICryptoService in a new class
 *   2. Swap the provider in CryptoModule
 */
@Injectable()
export class NodeCryptoService implements ICryptoService {
  // ── Hashing ────────────────────────────────────────────────

  sha256Hex(input: string | Buffer): string {
    return createHash("sha256").update(input).digest("hex");
  }

  sha256Base64Url(input: string | Buffer): string {
    return createHash("sha256").update(input).digest("base64url");
  }

  sha256Buffer(input: Buffer): Buffer {
    return createHash("sha256").update(input).digest();
  }

  // ── Signature verification ─────────────────────────────────

  verifyEcdsaP256(
    signedData: Buffer,
    signature: Buffer,
    publicKey: Buffer,
  ): boolean {
    // Try COSE-encoded key first (WebAuthn default)
    const spkiKey = this.coseToSpki(publicKey);
    const derSignature = this.derEncodeSignature(signature);

    if (spkiKey) {
      try {
        const verifier = createVerify("SHA256");
        verifier.update(signedData);
        return verifier.verify(
          { key: spkiKey, format: "der", type: "spki" },
          derSignature,
        );
      } catch {
        return false;
      }
    }

    // Fallback: key might already be SPKI DER
    try {
      const verifier = createVerify("SHA256");
      verifier.update(signedData);
      return verifier.verify(
        { key: publicKey, format: "der", type: "spki" },
        derSignature,
      );
    } catch {
      return false;
    }
  }

  // ── Random ─────────────────────────────────────────────────

  randomUUID(): string {
    return randomUUID();
  }

  // ── Private: COSE / DER encoding ──────────────────────────
  // These are data marshalling, not cryptographic operations.
  // They convert between WebAuthn's COSE key format and Node.js's
  // expected SPKI DER format.

  /**
   * Convert a COSE EC2 key to SPKI DER format.
   */
  private coseToSpki(coseKey: Buffer): Buffer | null {
    try {
      const parsed = this.parseCoseKey(coseKey);
      if (!parsed) return null;

      const { x, y } = parsed;
      if (!x || !y || x.length !== 32 || y.length !== 32) return null;

      // Uncompressed EC point: 0x04 || x || y
      const point = Buffer.concat([Buffer.from([0x04]), x, y]);

      // AlgorithmIdentifier for id-ecPublicKey with prime256v1
      const algorithmId = Buffer.from(
        "301306072a8648ce3d020106082a8648ce3d030107",
        "hex",
      );

      // BIT STRING: 03 42 00 <point>
      const bitString = Buffer.concat([Buffer.from([0x03, 0x42, 0x00]), point]);

      // Outer SEQUENCE
      const innerLen = algorithmId.length + bitString.length;
      return Buffer.concat([
        Buffer.from([0x30, innerLen]),
        algorithmId,
        bitString,
      ]);
    } catch {
      return null;
    }
  }

  /**
   * Minimal CBOR parser for COSE EC2 key maps.
   */
  private parseCoseKey(buf: Buffer): { x: Buffer; y: Buffer } | null {
    try {
      let offset = 0;
      const firstByte = buf[offset++];
      let mapSize: number;

      if ((firstByte & 0xe0) === 0xa0) {
        mapSize = firstByte & 0x1f;
      } else if (firstByte === 0xb8) {
        mapSize = buf[offset++];
      } else if (firstByte === 0xbf) {
        mapSize = -1;
      } else {
        return null;
      }

      let x: Buffer | null = null;
      let y: Buffer | null = null;
      let count = 0;

      while (offset < buf.length) {
        if (mapSize >= 0 && count >= mapSize) break;
        if (mapSize < 0 && buf[offset] === 0xff) break;

        const { value: key, newOffset: keyOff } = this.readCborInt(buf, offset);
        offset = keyOff;

        const valueByte = buf[offset];
        if ((valueByte & 0xe0) === 0x40) {
          const len = valueByte & 0x1f;
          offset++;
          const val = buf.subarray(offset, offset + len);
          offset += len;
          if (key === -2) x = Buffer.from(val);
          if (key === -3) y = Buffer.from(val);
        } else if (valueByte === 0x58) {
          offset++;
          const len = buf[offset++];
          const val = buf.subarray(offset, offset + len);
          offset += len;
          if (key === -2) x = Buffer.from(val);
          if (key === -3) y = Buffer.from(val);
        } else {
          const { newOffset: valOff } = this.skipCborValue(buf, offset);
          offset = valOff;
        }

        count++;
      }

      return x && y ? { x, y } : null;
    } catch {
      return null;
    }
  }

  private readCborInt(
    buf: Buffer,
    offset: number,
  ): { value: number; newOffset: number } {
    const first = buf[offset++];
    const major = (first & 0xe0) >> 5;
    const additional = first & 0x1f;

    let rawValue: number;
    if (additional < 24) {
      rawValue = additional;
    } else if (additional === 24) {
      rawValue = buf[offset++];
    } else if (additional === 25) {
      rawValue = buf.readUInt16BE(offset);
      offset += 2;
    } else {
      rawValue = 0;
      offset++;
    }

    const value = major === 1 ? -(rawValue + 1) : rawValue;
    return { value, newOffset: offset };
  }

  private skipCborValue(buf: Buffer, offset: number): { newOffset: number } {
    const first = buf[offset++];
    const major = (first & 0xe0) >> 5;
    const additional = first & 0x1f;

    let len = 0;
    if (additional < 24) {
      len = additional;
    } else if (additional === 24) {
      len = buf[offset++];
    } else if (additional === 25) {
      len = buf.readUInt16BE(offset);
      offset += 2;
    }

    if (major === 2 || major === 3) {
      offset += len;
    }

    return { newOffset: offset };
  }

  /**
   * Convert IEEE P1363 signature (r||s) to DER format.
   * If already DER, returns as-is.
   */
  private derEncodeSignature(rawSig: Buffer): Buffer {
    if (rawSig[0] === 0x30) return rawSig;

    const halfLen = rawSig.length / 2;
    let r = rawSig.subarray(0, halfLen);
    let s = rawSig.subarray(halfLen);

    r = this.trimAndPad(r);
    s = this.trimAndPad(s);

    const totalLen = 2 + r.length + 2 + s.length;
    return Buffer.concat([
      Buffer.from([0x30, totalLen, 0x02, r.length]),
      r,
      Buffer.from([0x02, s.length]),
      s,
    ]);
  }

  private trimAndPad(buf: Buffer): Buffer {
    let start = 0;
    while (start < buf.length - 1 && buf[start] === 0) start++;
    buf = buf.subarray(start);
    if (buf[0] & 0x80) {
      buf = Buffer.concat([Buffer.from([0x00]), buf]);
    }
    return buf;
  }
}
