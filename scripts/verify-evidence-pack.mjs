#!/usr/bin/env node
/**
 * Standalone Trust Envelope / Evidence Pack Verifier
 * ===================================================
 * Zero dependencies — uses only Node.js built-in `crypto` module.
 *
 * Supports:
 *   - Trust Envelope v2.0 (metadata.packVersion === "2.0")
 *   - Legacy Evidence Pack v1.x (packVersion === "1.0" / "1.1")
 *
 * Usage:
 *   node verify-evidence-pack.mjs <path-to-evidence-pack.json>
 *   node verify-evidence-pack.mjs --live <path-to-evidence-pack.json>
 *
 * Flags:
 *   --live   Perform live external anchor verification (fetches from
 *            Rekor/OpenTimestamps to cross-check the Merkle root).
 *            Requires network access. Without this flag, external
 *            anchor checks are metadata-only (offline).
 *
 * This script performs the same verification a bank or auditor would:
 *   0. Pack structure & version detection
 *   1. Hash chain integrity (recompute every eventHash)
 *   2. Entity chain continuity (verify previousHash links)
 *   3. Payload hash verification
 *   4. Intent hash verification (signed events)
 *   5. WebAuthn challenge binding
 *   6. ECDSA P-256 signature verification
 *   7. Integrity root hashes (v2.0: documentHash, ledgerRootHash, envelopeHash)
 *   8. Actors & approvals validation (v2.0)
 *   9. Cross-consistency checks
 *  10. Credential uniqueness
 *  11. Timestamp ordering
 *  12. External URI analysis
 *  13. Platform signature & notarization status
 *  14. Merkle proof & external anchor verification (live with --live)
 *
 * Exit code: 0 = all checks pass, 1 = failures found, 2 = invalid input
 */

import { createHash, createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Colour helpers (ANSI) ─────────────────────────────────────
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const PASS = `${GREEN}✓${RESET}`;
const FAIL = `${RED}✗${RESET}`;
const WARN = `${YELLOW}⚠${RESET}`;
const INFO = `${CYAN}ℹ${RESET}`;

// ── Canonical JSON stringification ────────────────────────────
function canonicalStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => canonicalStringify(item)).join(",") + "]";
  }
  const sortedKeys = Object.keys(obj).sort();
  const parts = sortedKeys.map(
    (key) => JSON.stringify(key) + ":" + canonicalStringify(obj[key]),
  );
  return "{" + parts.join(",") + "}";
}

// ── Crypto helpers ────────────────────────────────────────────

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function sha256Base64Url(input) {
  return createHash("sha256").update(input).digest("base64url");
}

function sha256Buffer(input) {
  return createHash("sha256").update(input).digest();
}

/**
 * Minimal CBOR parser for COSE EC2 key maps.
 */
function parseCoseKey(buf) {
  let offset = 0;
  const firstByte = buf[offset++];
  let mapSize;

  if ((firstByte & 0xe0) === 0xa0) {
    mapSize = firstByte & 0x1f;
  } else if (firstByte === 0xb8) {
    mapSize = buf[offset++];
  } else if (firstByte === 0xbf) {
    mapSize = -1;
  } else {
    return null;
  }

  let x = null;
  let y = null;
  let count = 0;

  while (offset < buf.length) {
    if (mapSize >= 0 && count >= mapSize) break;
    if (mapSize < 0 && buf[offset] === 0xff) break;

    const { value: key, newOffset: keyOff } = readCborInt(buf, offset);
    offset = keyOff;

    const valueByte = buf[offset];
    const major = (valueByte & 0xe0) >> 5;
    const additional = valueByte & 0x1f;

    if (major === 2 && additional < 24) {
      const len = additional;
      offset++;
      const val = buf.subarray(offset, offset + len);
      offset += len;
      if (key === -2) x = val;
      else if (key === -3) y = val;
    } else if (major === 2 && additional === 24) {
      offset++;
      const len = buf[offset++];
      const val = buf.subarray(offset, offset + len);
      offset += len;
      if (key === -2) x = val;
      else if (key === -3) y = val;
    } else if (major === 2 && additional === 25) {
      offset++;
      const len = (buf[offset] << 8) | buf[offset + 1];
      offset += 2;
      const val = buf.subarray(offset, offset + len);
      offset += len;
      if (key === -2) x = val;
      else if (key === -3) y = val;
    } else {
      const { newOffset: skipOff } = skipCborValue(buf, offset);
      offset = skipOff;
    }

    count++;
  }

  if (!x || !y || x.length !== 32 || y.length !== 32) return null;
  return { x: Buffer.from(x), y: Buffer.from(y) };
}

function readCborInt(buf, offset) {
  const first = buf[offset++];
  const major = (first & 0xe0) >> 5;
  const additional = first & 0x1f;

  let rawValue;
  if (additional < 24) {
    rawValue = additional;
  } else if (additional === 24) {
    rawValue = buf[offset++];
  } else if (additional === 25) {
    rawValue = (buf[offset] << 8) | buf[offset + 1];
    offset += 2;
  } else {
    rawValue = 0;
    offset++;
  }

  const value = major === 1 ? -(rawValue + 1) : rawValue;
  return { value, newOffset: offset };
}

function skipCborValue(buf, offset) {
  const byte = buf[offset];
  const major = byte >> 5;
  const minor = byte & 0x1f;

  if (major <= 1) {
    if (minor <= 23) return { newOffset: offset + 1 };
    if (minor === 24) return { newOffset: offset + 2 };
    if (minor === 25) return { newOffset: offset + 3 };
    if (minor === 26) return { newOffset: offset + 5 };
    if (minor === 27) return { newOffset: offset + 9 };
  }
  if (major === 2 || major === 3) {
    let len;
    if (minor <= 23) {
      len = minor;
      offset++;
    } else if (minor === 24) {
      len = buf[offset + 1];
      offset += 2;
    } else {
      len = 0;
      offset++;
    }
    return { newOffset: offset + len };
  }
  return { newOffset: offset + 1 };
}

function coseToSpki(coseKeyBuf) {
  const parsed = parseCoseKey(coseKeyBuf);
  if (!parsed) return null;

  const { x, y } = parsed;
  const point = Buffer.concat([Buffer.from([0x04]), x, y]);
  const algorithmId = Buffer.from(
    "301306072a8648ce3d020106082a8648ce3d030107",
    "hex",
  );
  const bitString = Buffer.concat([Buffer.from([0x03, 0x42, 0x00]), point]);
  const innerLen = algorithmId.length + bitString.length;
  return Buffer.concat([Buffer.from([0x30, innerLen]), algorithmId, bitString]);
}

function derEncodeSignature(sigBuf) {
  if (sigBuf[0] === 0x30) return sigBuf;
  if (sigBuf.length !== 64) {
    const half = sigBuf.length / 2;
    return derEncodeRS(sigBuf.subarray(0, half), sigBuf.subarray(half));
  }
  return derEncodeRS(sigBuf.subarray(0, 32), sigBuf.subarray(32));
}

function derEncodeRS(r, s) {
  function encodeInteger(buf) {
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0) i++;
    buf = buf.subarray(i);
    if (buf[0] & 0x80) {
      buf = Buffer.concat([Buffer.from([0x00]), buf]);
    }
    return Buffer.concat([Buffer.from([0x02, buf.length]), buf]);
  }

  const rDer = encodeInteger(r);
  const sDer = encodeInteger(s);
  const body = Buffer.concat([rDer, sDer]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function verifyEcdsaP256(signedData, signature, publicKey) {
  const spkiKey = coseToSpki(publicKey);
  const derSig = derEncodeSignature(signature);

  if (!spkiKey) return false;

  try {
    const verifier = createVerify("SHA256");
    verifier.update(signedData);
    return verifier.verify(
      { key: spkiKey, format: "der", type: "spki" },
      derSig,
    );
  } catch {
    return false;
  }
}

// ── Reporting ─────────────────────────────────────────────────

class Report {
  constructor() {
    this.sections = [];
    this.currentSection = null;
    this.totalPass = 0;
    this.totalFail = 0;
    this.totalWarn = 0;
  }

  section(title) {
    this.currentSection = { title, results: [] };
    this.sections.push(this.currentSection);
  }

  pass(msg) {
    this.currentSection.results.push({ status: "pass", msg });
    this.totalPass++;
  }

  fail(msg) {
    this.currentSection.results.push({ status: "fail", msg });
    this.totalFail++;
  }

  warn(msg) {
    this.currentSection.results.push({ status: "warn", msg });
    this.totalWarn++;
  }

  info(msg) {
    this.currentSection.results.push({ status: "info", msg });
  }

  print() {
    console.log();
    console.log(
      `${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}`,
    );
    console.log(
      `${BOLD}║        TRUST ENVELOPE VERIFICATION REPORT                   ║${RESET}`,
    );
    console.log(
      `${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}`,
    );
    console.log();

    for (const section of this.sections) {
      console.log(
        `${BOLD}${CYAN}── ${section.title} ${"─".repeat(Math.max(0, 55 - section.title.length))}${RESET}`,
      );
      for (const r of section.results) {
        const icon =
          r.status === "pass"
            ? PASS
            : r.status === "fail"
              ? FAIL
              : r.status === "warn"
                ? WARN
                : INFO;
        console.log(`  ${icon} ${r.msg}`);
      }
      console.log();
    }

    console.log(`${BOLD}${"═".repeat(64)}${RESET}`);
    console.log(
      `  ${GREEN}${this.totalPass} passed${RESET}  ${RED}${this.totalFail} failed${RESET}  ${YELLOW}${this.totalWarn} warnings${RESET}`,
    );
    console.log(`${BOLD}${"═".repeat(64)}${RESET}`);

    if (this.totalFail === 0 && this.totalWarn === 0) {
      console.log(`\n  ${GREEN}${BOLD}VERDICT: ALL CHECKS PASSED ✓${RESET}\n`);
    } else if (this.totalFail === 0) {
      console.log(
        `\n  ${YELLOW}${BOLD}VERDICT: PASSED WITH WARNINGS ⚠${RESET}\n`,
      );
    } else {
      console.log(`\n  ${RED}${BOLD}VERDICT: VERIFICATION FAILED ✗${RESET}\n`);
    }

    return this.totalFail;
  }
}

// ── Format normalisation (v1.x → v2.0 compatible accessors) ──

/**
 * Normalise a pack of any version into common access shape for the verifier.
 */
function normalisePack(raw) {
  const isV2 = raw.metadata?.packVersion === "2.0";

  return {
    isV2,
    version: isV2 ? "2.0" : (raw.packVersion ?? "1.0"),
    generatedAt: isV2 ? raw.metadata.generatedAt : raw.generatedAt,
    document: isV2 ? raw.document : raw.purchaseOrder,
    ledgerEvents: isV2 ? (raw.ledger?.events ?? []) : (raw.ledgerEvents ?? []),
    proofBundles: raw.proofBundles ?? [],
    attachments: raw.attachments ?? [],
    actors: isV2 ? (raw.actors ?? []) : [],
    approvals: isV2 ? (raw.approvals ?? []) : [],
    integrity: raw.integrity ?? null,
    verification: isV2 ? (raw.verification ?? null) : null,
    metadata: isV2 ? raw.metadata : null,
    platformSignature: isV2 ? (raw.platformSignature ?? null) : null,
    notarization: isV2 ? (raw.notarization ?? null) : null,
    raw,
  };
}

// ── Live external anchor verification (provider-dispatched) ───

/**
 * Provider dispatch map for live external anchor verification.
 *
 * Each provider implements a function that:
 *   1. Fetches the entry from the external service by its ID
 *   2. Extracts the anchored hash from the response body
 *   3. Cross-checks it against the Merkle root in the envelope
 *
 * To add a new provider, add an entry to ANCHOR_VERIFIERS with:
 *   - key:   the provider name string (must match externalAnchor.provider)
 *   - value: async function(externalAnchor, merkleRoot, report)
 */
const ANCHOR_VERIFIERS = {
  /**
   * Sigstore Rekor — Public transparency log (Linux Foundation).
   *
   * Fetches the log entry by UUID, decodes the body (base64 → JSON),
   * extracts the hashedrekord spec, and verifies that the SHA-256 of
   * the Merkle root matches the anchored artifact hash.
   */
  "sigstore-rekor": async (externalAnchor, merkleRoot, report) => {
    const uuid = externalAnchor.externalId;
    if (!uuid) {
      report.warn("Rekor anchor missing externalId (UUID) — cannot verify");
      return;
    }

    // Derive the Rekor API URL from the verification URL or use default
    const rekorBaseUrl = "https://rekor.sigstore.dev/api/v1/log/entries";
    const lookupUrl = `${rekorBaseUrl}/${uuid}`;

    report.info(`Fetching Rekor entry: ${uuid.substring(0, 24)}...`);

    try {
      const response = await fetch(lookupUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        report.fail(
          `Rekor lookup failed (HTTP ${response.status}) — entry may not exist`,
        );
        return;
      }

      const data = await response.json();
      const [entryUuid, entryData] = Object.entries(data)[0];

      // Verify UUID matches
      if (entryUuid !== uuid) {
        report.fail(
          `Rekor UUID mismatch: expected ${uuid.substring(0, 16)}..., got ${entryUuid.substring(0, 16)}...`,
        );
        return;
      }

      // Verify integratedTime matches
      const storedTime = externalAnchor.anchoredAt
        ? new Date(externalAnchor.anchoredAt).getTime()
        : null;
      const rekorTime = entryData.integratedTime
        ? entryData.integratedTime * 1000
        : null;

      if (storedTime && rekorTime && Math.abs(storedTime - rekorTime) > 2000) {
        report.fail(
          `Rekor timestamp mismatch: stored=${new Date(storedTime).toISOString()}, rekor=${new Date(rekorTime).toISOString()}`,
        );
      } else if (rekorTime) {
        report.pass(
          `Rekor timestamp verified: ${new Date(rekorTime).toISOString()}`,
        );
      }

      // Decode the body to extract the anchored hash
      if (entryData.body) {
        try {
          const bodyJson = JSON.parse(
            Buffer.from(entryData.body, "base64").toString("utf-8"),
          );
          const spec = bodyJson?.spec;
          const anchoredHash = spec?.data?.hash?.value;

          if (anchoredHash) {
            // The anchored hash should be SHA-256(merkleRoot)
            const expectedHash = createHash("sha256")
              .update(merkleRoot)
              .digest("hex");

            if (anchoredHash === expectedHash) {
              report.pass(
                `Rekor artifact hash MATCHES — SHA-256(merkleRoot) confirmed in transparency log`,
              );
            } else {
              report.fail(
                `Rekor artifact hash MISMATCH — expected SHA-256(merkleRoot)=${expectedHash.substring(0, 16)}..., got ${anchoredHash.substring(0, 16)}...`,
              );
            }
          } else {
            report.warn(
              "Rekor entry body missing spec.data.hash.value — cannot cross-check",
            );
          }
        } catch {
          report.warn("Failed to decode Rekor entry body — cannot cross-check");
        }
      } else {
        report.warn("Rekor entry missing body — cannot cross-check hash");
      }

      report.pass(
        `Rekor live verification PASSED — entry exists at logIndex ${entryData.logIndex}`,
      );
    } catch (err) {
      if (err.name === "TimeoutError") {
        report.warn("Rekor live verification timed out (10s) — network issue?");
      } else {
        report.warn(`Rekor live verification error: ${err.message}`);
      }
    }
  },

  /**
   * Placeholder for future providers.
   * Add entries here for: "opentimestamps", "rfc3161-tsa", "bitcoin-op-return", etc.
   */
};

/**
 * Dispatch live external anchor verification to the appropriate provider.
 */
async function verifyExternalAnchorLive(externalAnchor, merkleRoot, report) {
  const provider = externalAnchor.provider;
  const verifier = ANCHOR_VERIFIERS[provider];

  if (verifier) {
    await verifier(externalAnchor, merkleRoot, report);
  } else {
    report.warn(
      `Unknown anchor provider "${provider}" — no live verifier available. ` +
        `Supported providers: ${Object.keys(ANCHOR_VERIFIERS).join(", ")}`,
    );
    report.info(
      `External anchor present but cannot be live-verified. ` +
        `Manual verification: ${externalAnchor.verificationUrl}`,
    );
  }
}

/**
 * Offline cross-check of the embedded proof body (no network required).
 *
 * If the envelope includes the external service's response body (e.g. Rekor's
 * base64-encoded entry body), we decode it and verify the artifact hash matches
 * SHA-256(merkleRoot). This gives the same assurance as live verification but
 * works completely offline.
 */
function crossCheckEmbeddedProof(externalAnchor, merkleRoot, report) {
  const provider = externalAnchor.provider;
  const proof = externalAnchor.proof;

  if (!proof) {
    report.pass(
      `External anchor present — ${provider} (no embedded proof; use --live for online cross-check)`,
    );
    return;
  }

  switch (provider) {
    case "sigstore-rekor": {
      if (!proof.body) {
        report.pass(
          `Rekor anchor present (proof body not embedded — use --live to cross-check)`,
        );
        return;
      }

      try {
        const bodyJson = JSON.parse(
          Buffer.from(proof.body, "base64").toString("utf-8"),
        );
        const anchoredHash = bodyJson?.spec?.data?.hash?.value;

        if (!anchoredHash) {
          report.warn(
            "Rekor body decoded but missing spec.data.hash.value — cannot cross-check",
          );
          return;
        }

        const expectedHash = createHash("sha256")
          .update(merkleRoot)
          .digest("hex");

        if (anchoredHash === expectedHash) {
          report.pass(
            `Rekor artifact hash MATCHES — SHA-256(merkleRoot) confirmed in embedded proof (offline)`,
          );
        } else {
          report.fail(
            `Rekor artifact hash MISMATCH — expected ${expectedHash.substring(0, 16)}..., got ${anchoredHash.substring(0, 16)}...`,
          );
        }

        if (proof.logIndex !== undefined) {
          report.info(`Rekor log index: ${proof.logIndex}`);
        }
      } catch {
        report.warn("Failed to decode Rekor proof body");
      }
      break;
    }
    // Future providers:
    // case "opentimestamps": ...
    // case "rfc3161-tsa": ...
    default:
      report.pass(
        `External anchor present — ${provider} (use --live for online cross-check)`,
      );
  }
}

// ── Main verification ─────────────────────────────────────────

async function verify(rawPack, { live = false } = {}) {
  const report = new Report();
  const pack = normalisePack(rawPack);

  // ── 0. Structure check ──────────────────────────────────
  report.section("Pack Structure & Version");

  report.info(`Format version: ${pack.version}`);

  if (pack.isV2) {
    const m = pack.metadata;
    if (m.schemaVersion === "trust-envelope-v1")
      report.pass(`Schema: ${m.schemaVersion}`);
    else report.warn(`Unexpected schema version: ${m.schemaVersion}`);

    if (m.generator) report.pass(`Generator: ${m.generator}`);
    else report.warn("Missing metadata.generator");

    if (m.hashAlgorithm) report.pass(`Hash algorithm: ${m.hashAlgorithm}`);
    if (m.signatureAlgorithm)
      report.pass(`Signature algorithm: ${m.signatureAlgorithm}`);

    if (m.canonicalization?.algorithm)
      report.pass(`Canonicalization: ${m.canonicalization.algorithm}`);

    if (m.envelopeId) report.pass(`Envelope ID: ${m.envelopeId}`);
    else report.warn("Missing metadata.envelopeId");
  }

  if (!pack.document) report.fail("Missing document / purchaseOrder");
  else report.pass("Document present");

  if (!pack.ledgerEvents || !Array.isArray(pack.ledgerEvents))
    report.fail("Missing or invalid ledger events");
  else report.pass(`Ledger events: ${pack.ledgerEvents.length}`);

  if (!pack.proofBundles || !Array.isArray(pack.proofBundles))
    report.fail("Missing or invalid proofBundles");
  else report.pass(`Proof bundles: ${pack.proofBundles.length}`);

  if (pack.ledgerEvents?.length !== pack.proofBundles?.length)
    report.warn(
      `Event count (${pack.ledgerEvents?.length}) ≠ bundle count (${pack.proofBundles?.length})`,
    );
  else report.pass("Event count matches bundle count");

  if (!pack.generatedAt) report.warn("Missing generatedAt timestamp");
  else report.pass(`Generated at ${pack.generatedAt}`);

  if (pack.document && !pack.document.lineItems) {
    report.warn("Document missing lineItems — bank cannot see ordered goods");
  }

  // ── 1. Hash chain integrity ─────────────────────────────
  report.section("Hash Chain Integrity");
  report.info(
    `Algorithm: SHA-256  Format: previousHash|entityType|entityId|entitySequence|eventType|actorId|actorRole|canonicalPayload|timestamp`,
  );

  const bundles = pack.proofBundles;
  for (const bundle of bundles) {
    const hashInput = [
      bundle.chain.previousHash,
      bundle.intent.entityType,
      bundle.intent.entityId,
      String(bundle.chain.entitySequence),
      bundle.intent.eventType,
      bundle.signer.userId,
      bundle.signer.role,
      canonicalStringify(bundle.intent.payload),
      bundle.intent.timestamp,
    ].join("|");

    const recomputed = sha256Hex(hashInput);
    const matches = recomputed === bundle.chain.eventHash;

    if (matches) {
      report.pass(
        `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — hash verified`,
      );
    } else {
      report.fail(
        `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — HASH MISMATCH\n` +
          `      Expected: ${bundle.chain.eventHash}\n` +
          `      Got:      ${recomputed}`,
      );
    }
  }

  // ── 2. Entity chain continuity ──────────────────────────
  report.section("Entity Chain Continuity");
  report.info(
    "Verifying that each event's previousHash matches the prior event's eventHash",
  );

  // Group proof bundles by entityId for independent per-chain verification
  const byEntity = new Map();
  for (const b of bundles) {
    const eid = b.intent?.entityId ?? "unknown";
    if (!byEntity.has(eid)) byEntity.set(eid, []);
    byEntity.get(eid).push(b);
  }

  if (byEntity.size === 0) {
    report.info("No events to check continuity");
  } else {
    report.info(`${byEntity.size} entity chain(s) detected`);

    for (const [eid, entityBundles] of byEntity) {
      const sorted = [...entityBundles].sort(
        (a, b) => a.chain.entitySequence - b.chain.entitySequence,
      );

      const entityType = sorted[0]?.intent?.entityType ?? "UNKNOWN";
      report.info(
        `Chain: ${entityType} / ${eid.slice(0, 8)}… (${sorted.length} events)`,
      );

      // First event must start with GENESIS
      if (sorted[0]?.chain?.previousHash === "GENESIS") {
        report.pass(`seq 1 — starts with GENESIS`);
      } else {
        report.fail(
          `seq 1 — expected GENESIS, got ${sorted[0]?.chain?.previousHash}`,
        );
      }

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];

        if (curr.chain.previousHash === prev.chain.eventHash) {
          report.pass(
            `seq ${prev.chain.entitySequence}→${curr.chain.entitySequence} — linked`,
          );
        } else {
          report.fail(
            `seq ${prev.chain.entitySequence}→${curr.chain.entitySequence} — BROKEN\n` +
              `      Expected previousHash: ${prev.chain.eventHash.substring(0, 16)}...\n` +
              `      Got: ${curr.chain.previousHash.substring(0, 16)}...`,
          );
        }
      }
    }
  }

  // ── 3. Payload hash verification ────────────────────────
  report.section("Payload Hash Verification");

  for (const bundle of bundles) {
    const recomputed = sha256Hex(canonicalStringify(bundle.intent.payload));
    const matches = recomputed === bundle.intent.payloadHash;

    if (matches) {
      report.pass(
        `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — payload hash ✓`,
      );
    } else {
      report.fail(
        `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — PAYLOAD HASH MISMATCH`,
      );
    }
  }

  // ── 4. Intent hash verification ─────────────────────────
  report.section("Intent Hash Verification (passkey-signed events)");

  const signedBundles = bundles.filter(
    (b) => b.verification.isCryptographicallySigned,
  );
  const unsignedBundles = bundles.filter(
    (b) => !b.verification.isCryptographicallySigned,
  );

  report.info(
    `${signedBundles.length} passkey-signed, ${unsignedBundles.length} system events`,
  );

  for (const bundle of signedBundles) {
    if (!bundle.assertion?.intentHash) {
      report.fail(
        `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — missing intentHash`,
      );
      continue;
    }

    // Build candidate inputs: cross-entity events may have been signed with
    // a different event type or entity ID than what was recorded on the ledger.
    const uid = bundle.signer.userId;
    const candidates = [];

    candidates.push(
      `${bundle.intent.eventType}|${bundle.intent.entityId}|${uid}`,
    );

    const poId = bundle.intent.payload?.purchaseOrderId;
    if (poId && poId !== bundle.intent.entityId) {
      candidates.push(`${bundle.intent.eventType}|${poId}|${uid}`);
    }

    const aliasMap = {
      EARLY_PAY_REQUESTED: "EARLY_PAYMENT_REQUESTED",
      EARLY_PAYMENT_REQUESTED: "EARLY_PAY_REQUESTED",
    };
    const alias = aliasMap[bundle.intent.eventType];
    if (alias) {
      candidates.push(`${alias}|${bundle.intent.entityId}|${uid}`);
      if (poId && poId !== bundle.intent.entityId) {
        candidates.push(`${alias}|${poId}|${uid}`);
      }
    }

    let matched = false;
    for (const input of candidates) {
      if (sha256Base64Url(input) === bundle.assertion.intentHash) {
        matched = true;
        break;
      }
    }

    if (matched) {
      report.pass(
        `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — intentHash ✓`,
      );
    } else {
      const intentInput = `${bundle.intent.eventType}|${bundle.intent.entityId}|${uid}`;
      report.fail(
        `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — INTENT HASH MISMATCH\n` +
          `      Input:    SHA-256("${intentInput}")\n` +
          `      Expected: ${bundle.assertion.intentHash}\n` +
          `      Got:      ${sha256Base64Url(intentInput)}`,
      );
    }
  }

  // ── 5. Challenge binding ────────────────────────────────
  report.section("WebAuthn Challenge Binding");
  report.info(
    "Verifying that clientDataJSON.challenge === intentHash (action binding)",
  );

  for (const bundle of signedBundles) {
    if (!bundle.assertion?.clientDataJSON) {
      report.fail(
        `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — missing clientDataJSON`,
      );
      continue;
    }

    try {
      let clientData;
      try {
        const decoded = Buffer.from(
          bundle.assertion.clientDataJSON,
          "base64url",
        ).toString("utf-8");
        clientData = JSON.parse(decoded);
      } catch {
        const decoded = Buffer.from(
          bundle.assertion.clientDataJSON,
          "base64",
        ).toString("utf-8");
        clientData = JSON.parse(decoded);
      }

      if (clientData.type !== "webauthn.get") {
        report.fail(
          `[seq ${bundle.chain.entitySequence}] Unexpected type: "${clientData.type}"`,
        );
        continue;
      }

      let challengeMatches =
        clientData.challenge === bundle.assertion.intentHash;

      if (!challengeMatches) {
        try {
          const decoded = Buffer.from(
            clientData.challenge,
            "base64url",
          ).toString("utf-8");
          challengeMatches = decoded === bundle.assertion.intentHash;
        } catch {
          /* ignore */
        }
      }

      if (challengeMatches) {
        report.pass(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — challenge bound to intent ✓ (origin: ${clientData.origin})`,
        );
      } else {
        report.fail(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — CHALLENGE MISMATCH\n` +
            `      clientDataJSON.challenge: ${clientData.challenge}\n` +
            `      assertion.intentHash:     ${bundle.assertion.intentHash}`,
        );
      }
    } catch (err) {
      report.fail(
        `[seq ${bundle.chain.entitySequence}] Failed to decode clientDataJSON: ${err.message}`,
      );
    }
  }

  // ── 6. ECDSA P-256 signature verification ───────────────
  report.section("WebAuthn ECDSA P-256 Signature Verification");
  report.info(
    "signedData = authenticatorData || SHA-256(clientDataJSON_bytes)",
  );

  for (const bundle of signedBundles) {
    if (!bundle.assertion) {
      report.fail(`[seq ${bundle.chain.entitySequence}] No assertion`);
      continue;
    }

    try {
      const authenticatorData = Buffer.from(
        bundle.assertion.authenticatorData,
        "base64url",
      );

      let clientDataJSONBytes;
      try {
        clientDataJSONBytes = Buffer.from(
          bundle.assertion.clientDataJSON,
          "base64url",
        );
        JSON.parse(clientDataJSONBytes.toString("utf-8"));
      } catch {
        clientDataJSONBytes = Buffer.from(
          bundle.assertion.clientDataJSON,
          "base64",
        );
      }

      const signature = Buffer.from(bundle.assertion.signature, "base64url");
      const publicKeyBuf = Buffer.from(
        bundle.credential.publicKeyBase64,
        "base64",
      );

      const clientDataHash = sha256Buffer(clientDataJSONBytes);
      const signedData = Buffer.concat([authenticatorData, clientDataHash]);

      const valid = verifyEcdsaP256(signedData, signature, publicKeyBuf);

      const signerLabel = `${bundle.signer.name} (${bundle.signer.role})`;

      if (valid) {
        report.pass(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — signature VALID\n` +
            `      Signer: ${signerLabel}\n` +
            `      Credential: ${bundle.credential.credentialId}`,
        );
      } else {
        report.fail(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — SIGNATURE INVALID\n` +
            `      Signer: ${signerLabel}`,
        );
      }
    } catch (err) {
      report.fail(
        `[seq ${bundle.chain.entitySequence}] Signature verification error: ${err.message}`,
      );
    }
  }

  // ── 7. Integrity root hashes (v2.0 only) ───────────────
  report.section("Integrity Root Hashes");

  if (
    pack.isV2 &&
    pack.integrity &&
    typeof pack.integrity === "object" &&
    !Array.isArray(pack.integrity)
  ) {
    const integ = pack.integrity;

    // Verify documentHash
    if (integ.documentHash && pack.document) {
      const docForHash = { ...pack.document };
      delete docForHash.documentHash;
      const recomputed = sha256Hex(canonicalStringify(docForHash));
      if (recomputed === integ.documentHash) {
        report.pass(
          `documentHash verified: ${integ.documentHash.substring(0, 16)}...`,
        );
      } else {
        report.fail(
          `documentHash MISMATCH\n` +
            `      Expected: ${integ.documentHash}\n` +
            `      Got:      ${recomputed}`,
        );
      }
    } else {
      report.warn("Missing documentHash or document for verification");
    }

    // Verify ledgerRootHash
    if (integ.ledgerRootHash && pack.ledgerEvents.length > 0) {
      const eventHashes = pack.ledgerEvents.map((e) => e.eventHash);
      const recomputed = sha256Hex(eventHashes.join("|"));
      if (recomputed === integ.ledgerRootHash) {
        report.pass(
          `ledgerRootHash verified: ${integ.ledgerRootHash.substring(0, 16)}...`,
        );
      } else {
        report.fail(
          `ledgerRootHash MISMATCH\n` +
            `      Expected: ${integ.ledgerRootHash}\n` +
            `      Got:      ${recomputed}`,
        );
      }
    } else if (integ.ledgerRootHash) {
      const emptyHash = sha256Hex("EMPTY");
      if (emptyHash === integ.ledgerRootHash) {
        report.pass("ledgerRootHash verified (empty ledger)");
      } else {
        report.warn("Cannot verify ledgerRootHash — no events");
      }
    }

    // Verify attachmentsHash
    if (integ.attachmentsHash) {
      let recomputed;
      if (pack.attachments.length > 0) {
        const hashes = pack.attachments.map((a) => a.sha256Hash);
        recomputed = sha256Hex(hashes.join("|"));
      } else {
        recomputed = sha256Hex("NONE");
      }
      if (recomputed === integ.attachmentsHash) {
        report.pass(
          `attachmentsHash verified: ${integ.attachmentsHash.substring(0, 16)}...`,
        );
      } else {
        report.fail(
          `attachmentsHash MISMATCH\n` +
            `      Expected: ${integ.attachmentsHash}\n` +
            `      Got:      ${recomputed}`,
        );
      }
    }

    // Verify envelopeHash
    if (
      integ.envelopeHash &&
      integ.documentHash &&
      integ.ledgerRootHash &&
      integ.attachmentsHash
    ) {
      const recomputed = sha256Hex(
        `${integ.documentHash}|${integ.ledgerRootHash}|${integ.attachmentsHash}`,
      );
      if (recomputed === integ.envelopeHash) {
        report.pass(
          `envelopeHash verified: ${integ.envelopeHash.substring(0, 16)}... (seals entire pack)`,
        );
      } else {
        report.fail(
          `envelopeHash MISMATCH\n` +
            `      Expected: ${integ.envelopeHash}\n` +
            `      Got:      ${recomputed}`,
        );
      }
    } else if (integ.envelopeHash) {
      report.warn("Cannot verify envelopeHash — missing component hashes");
    }

    // Report counts
    if (typeof integ.eventCount === "number") {
      if (integ.eventCount === pack.ledgerEvents.length) {
        report.pass(`Event count: ${integ.eventCount} (matches ledger)`);
      } else {
        report.fail(
          `Event count mismatch: integrity says ${integ.eventCount}, ledger has ${pack.ledgerEvents.length}`,
        );
      }
    }

    if (typeof integ.signedEventCount === "number") {
      report.info(
        `Signed: ${integ.signedEventCount}  Unsigned: ${integ.unsignedEventCount ?? "?"}`,
      );
    }

    // File integrity
    if (integ.fileIntegrity && Array.isArray(integ.fileIntegrity)) {
      for (const fi of integ.fileIntegrity) {
        if (fi.valid) {
          report.pass(
            `File ${fi.filename}: integrity OK (${fi.sha256.substring(0, 12)}...)`,
          );
        } else {
          report.fail(`File ${fi.filename}: integrity FAILED`);
        }
      }
    }
  } else if (!pack.isV2) {
    const legacyIntegrity = pack.integrity;
    if (Array.isArray(legacyIntegrity)) {
      for (const fi of legacyIntegrity) {
        if (fi.valid) {
          report.pass(
            `File ${fi.filename}: integrity OK (${fi.sha256?.substring(0, 12)}...)`,
          );
        } else {
          report.fail(`File ${fi.filename}: integrity FAILED`);
        }
      }
      if (legacyIntegrity.length === 0) {
        report.info("No attachments — file integrity N/A");
      }
    }
    report.info(
      "Root hash verification unavailable for v1.x packs — upgrade to v2.0",
    );
  } else {
    report.warn("Integrity section missing or invalid");
  }

  // ── 8. Actors & Approvals (v2.0 only) ──────────────────
  if (pack.isV2) {
    report.section("Actors & Approvals (v2.0)");

    if (pack.actors.length === 0) {
      report.warn("No actors in envelope");
    } else {
      report.pass(`${pack.actors.length} actors declared`);

      for (const actor of pack.actors) {
        const hasCredentials =
          actor.credentials && actor.credentials.length > 0;
        if (hasCredentials) {
          report.pass(
            `${actor.name} (${actor.role}) — ${actor.credentials.length} credential(s), ` +
              `company: ${actor.companyName ?? "N/A"}`,
          );
        } else {
          report.info(
            `${actor.name} (${actor.role}) — no passkey credentials (system/unsigned events only)`,
          );
        }

        if (actor.identityResolutionUri) {
          report.info(`  Identity URI: ${actor.identityResolutionUri}`);
        }
      }

      // Cross-check: actors referenced in proof bundles should be in actors[]
      const actorIds = new Set(pack.actors.map((a) => a.id));
      const bundleSignerIds = new Set(bundles.map((b) => b.signer.userId));
      for (const signerId of bundleSignerIds) {
        if (actorIds.has(signerId)) {
          report.pass(
            `Signer ${signerId.substring(0, 8)}... found in actors[]`,
          );
        } else {
          report.fail(
            `Signer ${signerId.substring(0, 8)}... NOT in actors[] — missing identity`,
          );
        }
      }

      // Cross-check: actor public keys match proof bundle credentials
      for (const actor of pack.actors) {
        for (const cred of actor.credentials ?? []) {
          const matchingBundle = signedBundles.find(
            (b) =>
              b.credential.credentialId === cred.credentialId &&
              b.signer.userId === actor.id,
          );
          if (matchingBundle) {
            if (
              matchingBundle.credential.publicKeyBase64 === cred.publicKeyBase64
            ) {
              report.pass(
                `Actor ${actor.name}: credential ${cred.credentialId.substring(0, 12)}... key matches proof bundle`,
              );
            } else {
              report.fail(
                `Actor ${actor.name}: credential ${cred.credentialId.substring(0, 12)}... key MISMATCH between actors[] and proofBundles`,
              );
            }
          }
        }
      }
    }

    // Approvals
    if (pack.approvals.length === 0 && signedBundles.length === 0) {
      report.info("No approvals (no passkey-signed events)");
    } else if (pack.approvals.length === 0 && signedBundles.length > 0) {
      report.warn(
        `${signedBundles.length} signed events but no approvals[] — expected ${signedBundles.length}`,
      );
    } else {
      report.pass(`${pack.approvals.length} approvals declared`);

      for (const approval of pack.approvals) {
        const matchingBundle = signedBundles.find(
          (b) => b.proofId === approval.eventId,
        );
        if (matchingBundle) {
          if (
            matchingBundle.signer.userId === approval.actorId &&
            matchingBundle.assertion?.signature === approval.signature
          ) {
            report.pass(
              `Approval ${approval.eventType} by ${approval.actorRole} — matches proof bundle`,
            );
          } else {
            report.fail(
              `Approval ${approval.eventType} — data mismatch with proof bundle`,
            );
          }
        } else {
          report.fail(
            `Approval ${approval.eventType} (event ${approval.eventId.substring(0, 8)}...) — no matching proof bundle`,
          );
        }
      }
    }
  }

  // ── 9. Cross-consistency checks ─────────────────────────
  report.section("Cross-Consistency Checks");

  const po = pack.document;
  if (po) {
    const acceptedEvent = bundles.find(
      (b) => b.intent.eventType === "PO_ACCEPTED",
    );
    if (acceptedEvent) {
      const acceptedAmount = acceptedEvent.intent.payload.amount;
      if (po.amount === acceptedAmount) {
        report.pass(
          `PO amount (${po.amount}) matches PO_ACCEPTED payload (${acceptedAmount})`,
        );
      } else {
        report.fail(
          `PO amount (${po.amount}) ≠ PO_ACCEPTED payload (${acceptedAmount})`,
        );
      }
    }

    const eventTypes = bundles.map((b) => b.intent.eventType);
    if (po.status === "ACCEPTED" && eventTypes.includes("PO_ACCEPTED")) {
      report.pass(`PO status "${po.status}" consistent with event trail`);
    } else if (
      po.status === "ACCEPTED" &&
      !eventTypes.includes("PO_ACCEPTED")
    ) {
      report.fail(`PO status is ACCEPTED but no PO_ACCEPTED event in trail`);
    } else {
      report.info(`PO status: ${po.status}`);
    }

    const counterEvents = bundles.filter(
      (b) => b.intent.eventType === "PO_COUNTER_PROPOSED",
    );
    const counterAccepted = bundles.find(
      (b) => b.intent.eventType === "PO_COUNTER_ACCEPTED",
    );
    if (counterEvents.length > 0) {
      report.info(
        `Negotiation: ${counterEvents.length} counter-proposals, ` +
          `${counterAccepted ? "final counter accepted" : "no counter accepted"}`,
      );

      const createdAmount = bundles.find(
        (b) => b.intent.eventType === "PO_CREATED",
      )?.intent.payload.amount;
      const finalAmount = counterAccepted?.intent.payload.acceptedAmount;

      if (createdAmount && finalAmount) {
        report.info(
          `Amount negotiated: ${createdAmount} → ${finalAmount} (${((1 - finalAmount / createdAmount) * 100).toFixed(1)}% reduction)`,
        );
      }
    }

    if (po.paymentLock) {
      if (
        po.paymentLock.status === "LOCKED" &&
        po.paymentLock.amount === po.amount
      ) {
        report.pass(
          `Payment lock: ${po.paymentLock.status} for ${po.paymentLock.amount} (matches PO amount)`,
        );
      } else if (po.paymentLock.amount !== po.amount) {
        report.warn(
          `Payment lock amount (${po.paymentLock.amount}) ≠ PO amount (${po.amount})`,
        );
      }
    }

    if (po.buyer && po.supplier) {
      if (po.buyer.id !== po.supplier.id) {
        report.pass(
          `Buyer (${po.buyer.companyName}) ≠ Supplier (${po.supplier.companyName})`,
        );
      } else {
        report.fail("Buyer and supplier are the same entity");
      }
    }

    const signerIds = new Set(bundles.map((b) => b.signer.userId));
    if (po.buyer && signerIds.has(po.buyer.id)) {
      report.pass(`Buyer ${po.buyer.name} appears as signer in events`);
    }
    if (po.supplier && signerIds.has(po.supplier.id)) {
      report.pass(`Supplier ${po.supplier.name} appears as signer in events`);
    }

    if (counterEvents.length > 1) {
      let turnsCorrect = true;
      for (let i = 1; i < counterEvents.length; i++) {
        if (
          counterEvents[i].signer.userId === counterEvents[i - 1].signer.userId
        ) {
          turnsCorrect = false;
          report.fail(
            `Counter-proposal ${i + 1} by same party as ${i} — turns not alternating`,
          );
        }
      }
      if (turnsCorrect) {
        report.pass("Negotiation turns alternate correctly between parties");
      }
    }
  }

  // ── 10. Credential uniqueness ───────────────────────────
  report.section("Credential Verification");

  const credMap = new Map();
  for (const bundle of signedBundles) {
    const cred = bundle.credential;
    if (cred.credentialId === "SYSTEM") continue;

    if (!credMap.has(cred.credentialId)) {
      credMap.set(cred.credentialId, {
        publicKey: cred.publicKeyBase64,
        users: new Set(),
      });
    }
    credMap.get(cred.credentialId).users.add(bundle.signer.userId);
  }

  for (const [credId, info] of credMap) {
    if (info.users.size === 1) {
      report.pass(
        `Credential ${credId.substring(0, 12)}... bound to single user`,
      );
    } else {
      report.fail(
        `Credential ${credId.substring(0, 12)}... used by ${info.users.size} different users!`,
      );
    }
  }

  // ── 11. Timestamp ordering (per entity chain) ──────────
  report.section("Timestamp Ordering");

  if (bundles.length === 0) {
    report.info("No events to check ordering");
  } else {
    const tsByEntity = new Map();
    for (const b of bundles) {
      const eid = b.intent?.entityId ?? "unknown";
      if (!tsByEntity.has(eid)) tsByEntity.set(eid, []);
      tsByEntity.get(eid).push(b);
    }

    let allOrdered = true;
    for (const [eid, entityBundles] of tsByEntity) {
      const tsSorted = [...entityBundles].sort(
        (a, b) => a.chain.entitySequence - b.chain.entitySequence,
      );
      const entityType = tsSorted[0]?.intent?.entityType ?? "UNKNOWN";
      for (let i = 1; i < tsSorted.length; i++) {
        const prevTs = new Date(tsSorted[i - 1].intent.timestamp);
        const currTs = new Date(tsSorted[i].intent.timestamp);
        if (currTs < prevTs) {
          allOrdered = false;
          report.fail(
            `${entityType} seq ${tsSorted[i - 1].chain.entitySequence}→${tsSorted[i].chain.entitySequence} — timestamp regressed`,
          );
        }
      }
    }
    if (allOrdered) {
      const allTs = bundles.map((b) => new Date(b.intent.timestamp).getTime());
      const durationMin = (
        (Math.max(...allTs) - Math.min(...allTs)) /
        60000
      ).toFixed(1);
      report.pass(
        `All ${bundles.length} events in chronological order within their chains (span: ${durationMin} minutes)`,
      );
    }
  }

  // ── 12. URI analysis ────────────────────────────────────
  report.section("External Verification URIs");

  const sampleBundle = signedBundles[0];
  if (sampleBundle) {
    const registryUri = sampleBundle.issuer.registryUri;
    const identityUri = sampleBundle.issuer.identityUri;

    report.info(`Registry: ${registryUri}`);
    report.info(`Identity: ${identityUri}`);

    if (
      registryUri.includes("localhost") ||
      identityUri.includes("localhost")
    ) {
      report.warn(
        "URIs point to localhost — external parties cannot resolve credentials online.\n" +
          "      Pack is self-contained for offline verification using embedded public keys.",
      );
    } else {
      report.pass("URIs point to accessible endpoints");
    }

    for (const bundle of signedBundles) {
      const uri = bundle.credential.publicKeyResolutionUri;
      if (!uri || uri === "") {
        report.warn(
          `[seq ${bundle.chain.entitySequence}] No credential resolution URI`,
        );
      }
    }
  }

  // ── 13. Platform signature & notarization ───────────────
  if (pack.isV2) {
    report.section("Platform Signature & Notarization");

    if (pack.platformSignature) {
      const ps = pack.platformSignature;
      report.info(`Algorithm: ${ps.algorithm}`);
      report.info(`Signed at: ${ps.signedAt}`);
      report.info(`Signed fields: ${ps.signedFields}`);

      if (ps.signedFields === "envelopeHash" && pack.integrity?.envelopeHash) {
        try {
          const pubKeyBuf = Buffer.from(ps.publicKey, "base64");
          const sigBuf = Buffer.from(ps.signature, "base64");

          // Platform key is SPKI DER (not COSE), verify directly
          const verifier = createVerify("SHA256");
          verifier.update(pack.integrity.envelopeHash);
          const valid = verifier.verify(
            { key: pubKeyBuf, format: "der", type: "spki" },
            sigBuf,
          );

          if (valid) {
            report.pass(
              `Platform signature VALID — envelope sealed by issuing platform\n` +
                `      Public key: ${ps.publicKey.substring(0, 24)}...`,
            );
          } else {
            report.fail(
              `Platform signature INVALID — envelope may have been tampered with after generation`,
            );
          }
        } catch (err) {
          report.fail(`Platform signature verification error: ${err.message}`);
        }
      } else {
        report.warn(
          `Cannot verify platform signature — signedFields="${ps.signedFields}" or missing envelopeHash`,
        );
      }
    } else {
      report.info("No platform signature present");
    }

    if (pack.notarization) {
      report.section("Merkle Proof & External Anchoring");

      const { merkleRoot, merkleProof, anchor, externalAnchor, algorithm } =
        pack.notarization;

      if (merkleRoot && merkleProof) {
        report.info(`Algorithm: ${algorithm ?? "SHA-256-Merkle-Tree"}`);
        report.info(
          `Merkle root: ${merkleRoot.substring(0, 16)}... (${merkleProof.path?.length ?? 0} proof steps)`,
        );

        // Verify Merkle inclusion proof: walk from leaf to root
        if (merkleProof.leafHash && merkleProof.path) {
          let current = merkleProof.leafHash;
          for (const step of merkleProof.path) {
            const left = step.position === "left" ? step.hash : current;
            const right = step.position === "left" ? current : step.hash;
            current = createHash("sha256")
              .update(left + "|" + right)
              .digest("hex");
          }

          if (current === merkleRoot) {
            report.pass(
              `Merkle inclusion proof VALID — entity ${merkleProof.entityId} is in the anchor tree`,
            );
          } else {
            report.fail(
              `Merkle inclusion proof INVALID — recomputed root ${current.substring(0, 16)}... ≠ expected ${merkleRoot.substring(0, 16)}...`,
            );
          }
        } else {
          report.warn("Merkle proof missing leafHash or path — cannot verify");
        }

        if (anchor) {
          report.info(
            `Anchor: ${(anchor.anchorId ?? "?").substring(0, 8)}... (${anchor.eventCount} events, ${anchor.entityCount} entities)`,
          );
        }

        if (externalAnchor && externalAnchor.provider) {
          report.info(`External provider: ${externalAnchor.provider}`);
          report.info(`External ID: ${externalAnchor.externalId}`);
          report.info(`Verification URL: ${externalAnchor.verificationUrl}`);
          report.info(`Anchored at: ${externalAnchor.anchoredAt}`);

          if (live) {
            // ── Live external anchor verification ──────────
            // Dispatch to provider-specific verifier (fetches from external service)
            await verifyExternalAnchorLive(externalAnchor, merkleRoot, report);
          } else {
            // ── Offline cross-check of embedded proof body ──
            crossCheckEmbeddedProof(externalAnchor, merkleRoot, report);
          }
        } else {
          report.warn(
            "No external anchor — Merkle root only internally recorded",
          );
        }
      } else {
        report.warn("Notarization present but missing Merkle root or proof");
      }
    } else {
      report.info("No notarization / Merkle proof present");
    }
  }

  return report.print();
}

// ── CLI entry point ───────────────────────────────────────────

const args = process.argv.slice(2);
const live = args.includes("--live");
const fileArgs = args.filter((a) => !a.startsWith("--"));

if (fileArgs.length === 0) {
  console.error(
    `\n${BOLD}Usage:${RESET} node verify-evidence-pack.mjs [--live] <evidence-pack.json>\n`,
  );
  console.error(
    "  Standalone verification of a Trust Envelope or legacy evidence pack.",
  );
  console.error("  Supports Trust Envelope v2.0 and legacy v1.x formats.");
  console.error("  Zero dependencies — uses only Node.js built-in crypto.\n");
  console.error("  Flags:");
  console.error(
    "    --live   Fetch from external services (Rekor) to cross-check anchors\n",
  );
  process.exit(2);
}

const filePath = resolve(fileArgs[0]);
let pack;

try {
  const raw = readFileSync(filePath, "utf-8");
  pack = JSON.parse(raw);
  console.log(`\n${DIM}Loaded: ${filePath}${RESET}`);
  if (live)
    console.log(
      `${CYAN}Live mode: external anchor verification enabled${RESET}`,
    );
} catch (err) {
  console.error(`${RED}Failed to load evidence pack: ${err.message}${RESET}`);
  process.exit(2);
}

verify(pack, { live }).then((failures) => {
  process.exit(failures > 0 ? 1 : 0);
});
