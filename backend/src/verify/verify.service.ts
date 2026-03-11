import { Inject, Injectable } from "@nestjs/common";
import {
  CRYPTO_SERVICE,
  type ICryptoService,
} from "../crypto/crypto.interface";
import { canonicalStringify } from "../crypto/canonical-stringify";

/* ── Result types ─────────────────────────────────────────── */

export type CheckStatus = "pass" | "fail" | "warn" | "info";

export interface CheckResult {
  status: CheckStatus;
  message: string;
}

export interface VerifySection {
  title: string;
  results: CheckResult[];
}

export interface VerifyReport {
  version: string;
  generatedAt: string;
  envelopeId: string | null;
  sections: VerifySection[];
  totalPass: number;
  totalFail: number;
  totalWarn: number;
  verdict: "PASSED" | "PASSED_WITH_WARNINGS" | "FAILED";
}

/* ── Internal normalised shape ────────────────────────────── */

interface NormalisedPack {
  isV2: boolean;
  version: string;
  generatedAt: string | null;
  document: any;
  ledgerEvents: any[];
  proofBundles: any[];
  attachments: any[];
  actors: any[];
  approvals: any[];
  integrity: any;
  verification: any;
  metadata: any;
  platformSignature: any;
  notarization: any;
  raw: any;
}

/* ── Builder helper ──────────────────────────────────────── */

class ReportBuilder {
  sections: VerifySection[] = [];
  totalPass = 0;
  totalFail = 0;
  totalWarn = 0;
  private current!: VerifySection;

  section(title: string) {
    this.current = { title, results: [] };
    this.sections.push(this.current);
  }

  pass(msg: string) {
    this.current.results.push({ status: "pass", message: msg });
    this.totalPass++;
  }

  fail(msg: string) {
    this.current.results.push({ status: "fail", message: msg });
    this.totalFail++;
  }

  warn(msg: string) {
    this.current.results.push({ status: "warn", message: msg });
    this.totalWarn++;
  }

  info(msg: string) {
    this.current.results.push({ status: "info", message: msg });
  }
}

@Injectable()
export class VerifyService {
  constructor(
    @Inject(CRYPTO_SERVICE) private readonly crypto: ICryptoService,
  ) {}

  /**
   * Verify a Trust Envelope / evidence pack and return a structured report.
   * This is the same logic as verify-evidence-pack.mjs but running server-side.
   */
  verify(rawPack: any): VerifyReport {
    const r = new ReportBuilder();
    const pack = this.normalise(rawPack);

    this.checkStructure(r, pack);
    this.checkHashChain(r, pack);
    this.checkChainContinuity(r, pack);
    this.checkPayloadHashes(r, pack);
    this.checkIntentHashes(r, pack);
    this.checkChallenge(r, pack);
    this.checkSignatures(r, pack);
    this.checkIntegrityHashes(r, pack);
    this.checkActorsApprovals(r, pack);
    this.checkCrossConsistency(r, pack);
    this.checkCredentials(r, pack);
    this.checkTimestamps(r, pack);
    this.checkUris(r, pack);
    this.checkPlatformSignature(r, pack);

    const verdict =
      r.totalFail > 0
        ? "FAILED"
        : r.totalWarn > 0
          ? "PASSED_WITH_WARNINGS"
          : "PASSED";

    return {
      version: pack.version,
      generatedAt: pack.generatedAt ?? new Date().toISOString(),
      envelopeId: pack.metadata?.envelopeId ?? null,
      sections: r.sections,
      totalPass: r.totalPass,
      totalFail: r.totalFail,
      totalWarn: r.totalWarn,
      verdict,
    };
  }

  /* ── Normalise ───────────────────────────────────────────── */

  private normalise(raw: any): NormalisedPack {
    const isV2 = raw.metadata?.packVersion === "2.0";
    return {
      isV2,
      version: isV2 ? "2.0" : (raw.packVersion ?? "1.0"),
      generatedAt: isV2 ? raw.metadata.generatedAt : raw.generatedAt,
      document: isV2 ? raw.document : raw.purchaseOrder,
      ledgerEvents: isV2
        ? (raw.ledger?.events ?? [])
        : (raw.ledgerEvents ?? []),
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

  /* ── 0. Structure ────────────────────────────────────────── */

  private checkStructure(r: ReportBuilder, pack: NormalisedPack) {
    r.section("Pack Structure & Version");
    r.info(`Format version: ${pack.version}`);

    if (pack.isV2) {
      const m = pack.metadata;
      if (m.schemaVersion === "trust-envelope-v1")
        r.pass(`Schema: ${m.schemaVersion}`);
      else r.warn(`Unexpected schema version: ${m.schemaVersion}`);

      if (m.generator) r.pass(`Generator: ${m.generator}`);
      else r.warn("Missing metadata.generator");

      if (m.hashAlgorithm) r.pass(`Hash algorithm: ${m.hashAlgorithm}`);
      if (m.signatureAlgorithm)
        r.pass(`Signature algorithm: ${m.signatureAlgorithm}`);
      if (m.canonicalization?.algorithm)
        r.pass(`Canonicalization: ${m.canonicalization.algorithm}`);
      if (m.envelopeId) r.pass(`Envelope ID: ${m.envelopeId}`);
      else r.warn("Missing metadata.envelopeId");
    }

    if (!pack.document) r.fail("Missing document / purchaseOrder");
    else r.pass("Document present");

    if (!Array.isArray(pack.ledgerEvents))
      r.fail("Missing or invalid ledger events");
    else r.pass(`Ledger events: ${pack.ledgerEvents.length}`);

    if (!Array.isArray(pack.proofBundles))
      r.fail("Missing or invalid proofBundles");
    else r.pass(`Proof bundles: ${pack.proofBundles.length}`);

    if (pack.ledgerEvents?.length !== pack.proofBundles?.length)
      r.warn(
        `Event count (${pack.ledgerEvents?.length}) ≠ bundle count (${pack.proofBundles?.length})`,
      );
    else r.pass("Event count matches bundle count");

    // Report entity chain breakdown
    const entityChains = pack.raw?.ledger?.entityChains;
    if (Array.isArray(entityChains) && entityChains.length > 0) {
      r.info(`${entityChains.length} entity chain(s) in pack`);
      for (const chain of entityChains) {
        r.info(
          `  → ${chain.entityType} / ${chain.entityId?.slice(0, 8)}… (${chain.events?.length ?? 0} events)`,
        );
      }
    }

    if (!pack.generatedAt) r.warn("Missing generatedAt timestamp");
    else r.pass(`Generated at ${pack.generatedAt}`);
  }

  /* ── 1. Hash chain ──────────────────────────────────────── */

  private checkHashChain(r: ReportBuilder, pack: NormalisedPack) {
    r.section("Hash Chain Integrity");
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

      const recomputed = this.crypto.sha256Hex(hashInput);
      if (recomputed === bundle.chain.eventHash) {
        r.pass(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — hash verified`,
        );
      } else {
        r.fail(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — HASH MISMATCH`,
        );
      }
    }
  }

  /* ── 2. Entity chain continuity ─────────────────────────── */

  private checkChainContinuity(r: ReportBuilder, pack: NormalisedPack) {
    r.section("Entity Chain Continuity");

    // Group proof bundles by entityId for independent per-chain verification
    const byEntity = new Map<string, any[]>();
    for (const b of pack.proofBundles) {
      const eid = b.intent?.entityId ?? "unknown";
      if (!byEntity.has(eid)) byEntity.set(eid, []);
      byEntity.get(eid)!.push(b);
    }

    if (byEntity.size === 0) {
      r.info("No events to check continuity");
      return;
    }

    r.info(`${byEntity.size} entity chain(s) detected`);

    for (const [eid, bundles] of byEntity) {
      const sorted = [...bundles].sort(
        (a, b) => a.chain.entitySequence - b.chain.entitySequence,
      );

      const entityType = sorted[0]?.intent?.entityType ?? "UNKNOWN";
      r.info(
        `Chain: ${entityType} / ${eid.slice(0, 8)}… (${sorted.length} events)`,
      );

      // First event must start with GENESIS
      if (sorted[0]?.chain?.previousHash === "GENESIS") {
        r.pass(`seq 1 — starts with GENESIS`);
      } else {
        r.fail(
          `seq 1 — expected GENESIS, got ${sorted[0]?.chain?.previousHash}`,
        );
      }

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];

        if (curr.chain.previousHash === prev.chain.eventHash) {
          r.pass(
            `seq ${prev.chain.entitySequence}→${curr.chain.entitySequence} — linked`,
          );
        } else {
          r.fail(
            `seq ${prev.chain.entitySequence}→${curr.chain.entitySequence} — BROKEN`,
          );
        }
      }
    }
  }

  /* ── 3. Payload hashes ─────────────────────────────────── */

  private checkPayloadHashes(r: ReportBuilder, pack: NormalisedPack) {
    r.section("Payload Hash Verification");
    for (const bundle of pack.proofBundles) {
      const recomputed = this.crypto.sha256Hex(
        canonicalStringify(bundle.intent.payload),
      );
      if (recomputed === bundle.intent.payloadHash) {
        r.pass(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — payload hash ✓`,
        );
      } else {
        r.fail(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — PAYLOAD HASH MISMATCH`,
        );
      }
    }
  }

  /* ── 4. Intent hashes ──────────────────────────────────── */

  private checkIntentHashes(r: ReportBuilder, pack: NormalisedPack) {
    r.section("Intent Hash Verification");
    const signed = pack.proofBundles.filter(
      (b: any) => b.verification?.isCryptographicallySigned,
    );
    const unsigned = pack.proofBundles.filter(
      (b: any) => !b.verification?.isCryptographicallySigned,
    );
    r.info(`${signed.length} passkey-signed, ${unsigned.length} system events`);

    for (const bundle of signed) {
      if (!bundle.assertion?.intentHash) {
        r.fail(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — missing intentHash`,
        );
        continue;
      }

      // The intent hash is SHA-256(eventType|entityId|userId) computed at
      // signing time. For cross-entity events the signing context may use a
      // different eventType or entityId than what is recorded on the ledger
      // (e.g. early payment signed with the PO ID, recorded under the early
      // payment entity). We try the bundle's own fields first, then fall back
      // to common cross-entity patterns.
      const uid = bundle.signer.userId;
      const candidates: string[] = [];

      // Primary: bundle fields
      candidates.push(
        `${bundle.intent.eventType}|${bundle.intent.entityId}|${uid}`,
      );

      // Cross-entity: payload.purchaseOrderId as entityId
      const poId = (bundle.intent.payload as any)?.purchaseOrderId;
      if (poId && poId !== bundle.intent.entityId) {
        candidates.push(`${bundle.intent.eventType}|${poId}|${uid}`);
      }

      // Event type alias: EARLY_PAY_REQUESTED ↔ EARLY_PAYMENT_REQUESTED etc.
      const aliasMap: Record<string, string> = {
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
        if (
          this.crypto.sha256Base64Url(input) === bundle.assertion.intentHash
        ) {
          matched = true;
          break;
        }
      }

      if (matched) {
        r.pass(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — intentHash ✓`,
        );
      } else {
        r.fail(
          `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — INTENT HASH MISMATCH`,
        );
      }
    }
  }

  /* ── 5. Challenge binding ──────────────────────────────── */

  private checkChallenge(r: ReportBuilder, pack: NormalisedPack) {
    r.section("WebAuthn Challenge Binding");
    const signed = pack.proofBundles.filter(
      (b: any) => b.verification?.isCryptographicallySigned,
    );

    for (const bundle of signed) {
      if (!bundle.assertion?.clientDataJSON) {
        r.fail(`[seq ${bundle.chain.entitySequence}] — missing clientDataJSON`);
        continue;
      }
      try {
        let clientData: any;
        try {
          clientData = JSON.parse(
            Buffer.from(bundle.assertion.clientDataJSON, "base64url").toString(
              "utf-8",
            ),
          );
        } catch {
          clientData = JSON.parse(
            Buffer.from(bundle.assertion.clientDataJSON, "base64").toString(
              "utf-8",
            ),
          );
        }

        let matches = clientData.challenge === bundle.assertion.intentHash;
        if (!matches) {
          try {
            const decoded = Buffer.from(
              clientData.challenge,
              "base64url",
            ).toString("utf-8");
            matches = decoded === bundle.assertion.intentHash;
          } catch {
            /* ignore */
          }
        }

        if (matches) {
          r.pass(
            `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — challenge bound (origin: ${clientData.origin})`,
          );
        } else {
          r.fail(
            `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — CHALLENGE MISMATCH`,
          );
        }
      } catch (err: any) {
        r.fail(
          `[seq ${bundle.chain.entitySequence}] Failed to decode clientDataJSON`,
        );
      }
    }
  }

  /* ── 6. ECDSA P-256 signatures ─────────────────────────── */

  private checkSignatures(r: ReportBuilder, pack: NormalisedPack) {
    r.section("WebAuthn ECDSA P-256 Signature Verification");
    const signed = pack.proofBundles.filter(
      (b: any) => b.verification?.isCryptographicallySigned,
    );

    for (const bundle of signed) {
      if (!bundle.assertion) {
        r.fail(`[seq ${bundle.chain.entitySequence}] No assertion`);
        continue;
      }
      try {
        const authenticatorData = Buffer.from(
          bundle.assertion.authenticatorData,
          "base64url",
        );

        let clientDataJSONBytes: Buffer;
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

        const clientDataHash = this.crypto.sha256Buffer(clientDataJSONBytes);
        const signedData = Buffer.concat([authenticatorData, clientDataHash]);
        const valid = this.crypto.verifyEcdsaP256(
          signedData,
          signature,
          publicKeyBuf,
        );

        const signerLabel = `${bundle.signer.name} (${bundle.signer.role})`;
        if (valid) {
          r.pass(
            `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — signature VALID (${signerLabel})`,
          );
        } else {
          r.fail(
            `[seq ${bundle.chain.entitySequence}] ${bundle.intent.eventType} — SIGNATURE INVALID (${signerLabel})`,
          );
        }
      } catch {
        r.fail(
          `[seq ${bundle.chain.entitySequence}] Signature verification error`,
        );
      }
    }
  }

  /* ── 7. Integrity root hashes ──────────────────────────── */

  private checkIntegrityHashes(r: ReportBuilder, pack: NormalisedPack) {
    r.section("Integrity Root Hashes");

    if (
      pack.isV2 &&
      pack.integrity &&
      typeof pack.integrity === "object" &&
      !Array.isArray(pack.integrity)
    ) {
      const integ = pack.integrity;

      // documentHash
      if (integ.documentHash && pack.document) {
        const docForHash = { ...pack.document };
        delete docForHash.documentHash;
        const recomputed = this.crypto.sha256Hex(
          canonicalStringify(docForHash),
        );
        if (recomputed === integ.documentHash) r.pass(`documentHash verified`);
        else r.fail(`documentHash MISMATCH`);
      } else {
        r.warn("Missing documentHash or document");
      }

      // ledgerRootHash
      if (integ.ledgerRootHash && pack.ledgerEvents.length > 0) {
        const hashes = pack.ledgerEvents.map((e: any) => e.eventHash);
        const recomputed = this.crypto.sha256Hex(hashes.join("|"));
        if (recomputed === integ.ledgerRootHash)
          r.pass(`ledgerRootHash verified`);
        else r.fail(`ledgerRootHash MISMATCH`);
      } else if (integ.ledgerRootHash) {
        const emptyHash = this.crypto.sha256Hex("EMPTY");
        if (emptyHash === integ.ledgerRootHash)
          r.pass("ledgerRootHash verified (empty ledger)");
        else r.warn("Cannot verify ledgerRootHash — no events");
      }

      // attachmentsHash
      if (integ.attachmentsHash) {
        const recomputed =
          pack.attachments.length > 0
            ? this.crypto.sha256Hex(
                pack.attachments.map((a: any) => a.sha256Hash).join("|"),
              )
            : this.crypto.sha256Hex("NONE");
        if (recomputed === integ.attachmentsHash)
          r.pass(`attachmentsHash verified`);
        else r.fail(`attachmentsHash MISMATCH`);
      }

      // envelopeHash
      if (
        integ.envelopeHash &&
        integ.documentHash &&
        integ.ledgerRootHash &&
        integ.attachmentsHash
      ) {
        const recomputed = this.crypto.sha256Hex(
          `${integ.documentHash}|${integ.ledgerRootHash}|${integ.attachmentsHash}`,
        );
        if (recomputed === integ.envelopeHash)
          r.pass(`envelopeHash verified (seals entire pack)`);
        else r.fail(`envelopeHash MISMATCH`);
      }

      if (typeof integ.eventCount === "number") {
        if (integ.eventCount === pack.ledgerEvents.length)
          r.pass(`Event count: ${integ.eventCount}`);
        else
          r.fail(
            `Event count mismatch: integrity says ${integ.eventCount}, ledger has ${pack.ledgerEvents.length}`,
          );
      }
    } else if (!pack.isV2 && Array.isArray(pack.integrity)) {
      for (const fi of pack.integrity) {
        if (fi.valid) r.pass(`File ${fi.filename}: integrity OK`);
        else r.fail(`File ${fi.filename}: integrity FAILED`);
      }
      r.info("Root hash verification unavailable for v1.x packs");
    } else {
      r.warn("Integrity section missing or invalid");
    }
  }

  /* ── 8. Actors & approvals ─────────────────────────────── */

  private checkActorsApprovals(r: ReportBuilder, pack: NormalisedPack) {
    if (!pack.isV2) return;

    r.section("Actors & Approvals");
    const signed = pack.proofBundles.filter(
      (b: any) => b.verification?.isCryptographicallySigned,
    );

    if (pack.actors.length === 0) {
      r.warn("No actors in envelope");
    } else {
      r.pass(`${pack.actors.length} actors declared`);

      for (const actor of pack.actors) {
        const hasCreds = actor.credentials?.length > 0;
        if (hasCreds)
          r.pass(
            `${actor.name} (${actor.role}) — ${actor.credentials.length} credential(s)`,
          );
        else r.info(`${actor.name} (${actor.role}) — no passkey credentials`);
      }

      // Cross-check signers
      const actorIds = new Set(pack.actors.map((a: any) => a.id));
      const signerIds = new Set(
        pack.proofBundles.map((b: any) => b.signer.userId),
      );
      for (const signerId of signerIds) {
        if (actorIds.has(signerId))
          r.pass(`Signer ${signerId.substring(0, 8)}… in actors[]`);
        else r.fail(`Signer ${signerId.substring(0, 8)}… NOT in actors[]`);
      }
    }

    // Approvals
    if (pack.approvals.length === 0 && signed.length === 0) {
      r.info("No approvals (no passkey-signed events)");
    } else if (pack.approvals.length > 0) {
      r.pass(`${pack.approvals.length} approvals declared`);
      for (const approval of pack.approvals) {
        const match = signed.find((b: any) => b.proofId === approval.eventId);
        if (match) r.pass(`Approval ${approval.eventType} — matches bundle`);
        else r.fail(`Approval ${approval.eventType} — no matching bundle`);
      }
    }
  }

  /* ── 9. Cross-consistency ──────────────────────────────── */

  private checkCrossConsistency(r: ReportBuilder, pack: NormalisedPack) {
    r.section("Cross-Consistency Checks");
    const bundles = pack.proofBundles;
    const po = pack.document;
    if (!po) return;

    const accepted = bundles.find(
      (b: any) => b.intent.eventType === "PO_ACCEPTED",
    );
    if (accepted) {
      if (po.amount === accepted.intent.payload.amount)
        r.pass(`PO amount matches PO_ACCEPTED payload`);
      else r.fail(`PO amount ≠ PO_ACCEPTED payload`);
    }

    const eventTypes = bundles.map((b: any) => b.intent.eventType);
    if (po.status === "ACCEPTED" && eventTypes.includes("PO_ACCEPTED"))
      r.pass(`PO status "${po.status}" consistent with event trail`);
    else r.info(`PO status: ${po.status}`);

    if (po.buyer && po.supplier) {
      if (po.buyer.id !== po.supplier.id) r.pass(`Buyer ≠ Supplier`);
      else r.fail("Buyer and supplier are the same entity");
    }
  }

  /* ── 10. Credential uniqueness ─────────────────────────── */

  private checkCredentials(r: ReportBuilder, pack: NormalisedPack) {
    r.section("Credential Verification");
    const signed = pack.proofBundles.filter(
      (b: any) =>
        b.verification?.isCryptographicallySigned &&
        b.credential?.credentialId !== "SYSTEM",
    );

    const credMap = new Map<string, Set<string>>();
    for (const bundle of signed) {
      const credId = bundle.credential.credentialId;
      if (!credMap.has(credId)) credMap.set(credId, new Set());
      credMap.get(credId)!.add(bundle.signer.userId);
    }

    for (const [credId, users] of credMap) {
      if (users.size === 1)
        r.pass(`Credential ${credId.substring(0, 12)}… bound to single user`);
      else
        r.fail(
          `Credential ${credId.substring(0, 12)}… used by ${users.size} users`,
        );
    }
  }

  /* ── 11. Timestamp ordering ────────────────────────────── */

  private checkTimestamps(r: ReportBuilder, pack: NormalisedPack) {
    r.section("Timestamp Ordering");

    if (pack.proofBundles.length === 0) {
      r.info("No events to check ordering");
      return;
    }

    // Group by entity and verify timestamps within each chain
    const byEntity = new Map<string, any[]>();
    for (const b of pack.proofBundles) {
      const eid = b.intent?.entityId ?? "unknown";
      if (!byEntity.has(eid)) byEntity.set(eid, []);
      byEntity.get(eid)!.push(b);
    }

    let allOrdered = true;
    for (const [eid, bundles] of byEntity) {
      const sorted = [...bundles].sort(
        (a, b) => a.chain.entitySequence - b.chain.entitySequence,
      );
      const entityType = sorted[0]?.intent?.entityType ?? "UNKNOWN";

      for (let i = 1; i < sorted.length; i++) {
        if (
          new Date(sorted[i].intent.timestamp) <
          new Date(sorted[i - 1].intent.timestamp)
        ) {
          allOrdered = false;
          r.fail(
            `${entityType} seq ${sorted[i - 1].chain.entitySequence}→${sorted[i].chain.entitySequence} — timestamp regressed`,
          );
        }
      }
    }

    if (allOrdered) {
      // Also report overall time span across all events
      const allTs = pack.proofBundles.map((b) =>
        new Date(b.intent.timestamp).getTime(),
      );
      const mins = ((Math.max(...allTs) - Math.min(...allTs)) / 60000).toFixed(
        1,
      );
      r.pass(
        `All ${pack.proofBundles.length} events in chronological order within their chains (span: ${mins} min)`,
      );
    }
  }

  /* ── 12. URI analysis ──────────────────────────────────── */

  private checkUris(r: ReportBuilder, pack: NormalisedPack) {
    r.section("External Verification URIs");
    const signed = pack.proofBundles.filter(
      (b: any) => b.verification?.isCryptographicallySigned,
    );
    if (signed.length === 0) {
      r.info("No signed events — no URIs to check");
      return;
    }
    const sample = signed[0];
    if (sample.issuer) {
      r.info(`Registry: ${sample.issuer.registryUri}`);
      r.info(`Identity: ${sample.issuer.identityUri}`);
      if (
        sample.issuer.registryUri?.includes("localhost") ||
        sample.issuer.identityUri?.includes("localhost")
      )
        r.warn(
          "URIs point to localhost — external parties cannot resolve online. Pack is self-contained for offline verification.",
        );
      else r.pass("URIs point to accessible endpoints");
    }
  }

  /* ── 13. Platform signature ────────────────────────────── */

  private checkPlatformSignature(r: ReportBuilder, pack: NormalisedPack) {
    if (!pack.isV2) return;

    r.section("Platform Signature & Notarization");

    if (pack.platformSignature) {
      const ps = pack.platformSignature;
      r.info(`Algorithm: ${ps.algorithm}`);
      r.info(`Signed fields: ${ps.signedFields}`);

      if (ps.signedFields === "envelopeHash" && pack.integrity?.envelopeHash) {
        try {
          const pubKeyBuf = Buffer.from(ps.publicKey, "base64");
          const sigBuf = Buffer.from(ps.signature, "base64");

          // Platform key is SPKI DER — use Node crypto directly
          const { createVerify } = require("crypto");
          const verifier = createVerify("SHA256");
          verifier.update(pack.integrity.envelopeHash);
          const valid = verifier.verify(
            { key: pubKeyBuf, format: "der", type: "spki" },
            sigBuf,
          );

          if (valid)
            r.pass(
              `Platform signature VALID — envelope sealed by issuing platform`,
            );
          else
            r.fail(
              `Platform signature INVALID — envelope may have been tampered with`,
            );
        } catch {
          r.fail(`Platform signature verification error`);
        }
      } else {
        r.warn(`Cannot verify platform signature — missing envelopeHash`);
      }
    } else {
      r.info("No platform signature present");
    }

    if (pack.notarization) {
      this.checkMerkleProofAndExternalAnchor(r, pack.notarization);
    } else {
      r.info("No notarization / Merkle proof present");
    }
  }

  /* ── 14. Merkle proof & external anchor verification ────── */

  private checkMerkleProofAndExternalAnchor(
    r: ReportBuilder,
    notarization: any,
  ) {
    r.section("Merkle Proof & External Anchoring");

    const { merkleRoot, merkleProof, anchor, externalAnchor, algorithm } =
      notarization;

    if (!merkleRoot || !merkleProof) {
      r.warn("Notarization present but missing Merkle root or proof");
      return;
    }

    r.info(`Algorithm: ${algorithm ?? "SHA-256-Merkle-Tree"}`);
    r.info(
      `Merkle root: ${merkleRoot.substring(0, 16)}... (${merkleProof.path?.length ?? 0} proof steps)`,
    );

    // Verify Merkle inclusion proof: recompute from leaf to root
    if (merkleProof.leafHash && merkleProof.path) {
      try {
        const { createHash } = require("crypto");
        let current = merkleProof.leafHash;

        for (const step of merkleProof.path) {
          const left = step.position === "left" ? step.hash : current;
          const right = step.position === "left" ? current : step.hash;
          current = createHash("sha256")
            .update(left + "|" + right)
            .digest("hex");
        }

        if (current === merkleRoot) {
          r.pass(
            `Merkle inclusion proof VALID — entity ${merkleProof.entityId} is in the anchor tree`,
          );
        } else {
          r.fail(
            `Merkle inclusion proof INVALID — recomputed root ${current.substring(0, 16)}... ≠ expected ${merkleRoot.substring(0, 16)}...`,
          );
        }
      } catch {
        r.fail("Merkle proof verification error");
      }
    } else {
      r.warn("Merkle proof missing leafHash or path — cannot verify");
    }

    // Check anchor metadata
    if (anchor) {
      r.info(
        `Anchor: ${anchor.anchorId?.substring(0, 8) ?? "?"}... (${anchor.eventCount} events, ${anchor.entityCount} entities)`,
      );
    }

    // Check external anchor — provider-dispatched verification
    if (externalAnchor && externalAnchor.provider) {
      r.info(`External provider: ${externalAnchor.provider}`);
      r.info(`External ID: ${externalAnchor.externalId}`);
      r.info(`Verification URL: ${externalAnchor.verificationUrl}`);
      r.info(`Anchored at: ${externalAnchor.anchoredAt}`);

      // Offline cross-check: if the Rekor proof body is embedded,
      // decode it and verify the artifact hash matches SHA-256(merkleRoot)
      this.crossCheckExternalProof(r, externalAnchor, merkleRoot);
    } else {
      r.warn("No external anchor — Merkle root only internally recorded");
    }
  }

  /**
   * Provider-dispatched offline verification of embedded external proof.
   * Cross-checks the artifact hash stored in the external service's response
   * body against the Merkle root in the envelope — no network required.
   */
  private crossCheckExternalProof(
    r: ReportBuilder,
    externalAnchor: any,
    merkleRoot: string,
  ) {
    const provider = externalAnchor.provider;
    const proof = externalAnchor.proof;

    switch (provider) {
      case "sigstore-rekor":
        this.crossCheckRekor(r, proof, merkleRoot);
        break;
      // Future providers:
      // case "opentimestamps": ...
      // case "rfc3161-tsa": ...
      // case "bitcoin-op-return": ...
      default:
        if (proof) {
          r.info(
            `Unknown provider "${provider}" — cannot cross-check proof offline. Manual: ${externalAnchor.verificationUrl}`,
          );
        }
        r.pass(`External anchor present — published to ${provider}`);
    }
  }

  /**
   * Sigstore Rekor offline cross-check.
   * Decodes the base64 body from the embedded proof, extracts
   * spec.data.hash.value, and verifies it equals SHA-256(merkleRoot).
   */
  private crossCheckRekor(r: ReportBuilder, proof: any, merkleRoot: string) {
    if (!proof || !proof.body) {
      r.pass(
        `Rekor anchor present (proof body not embedded — use live verification to cross-check)`,
      );
      return;
    }

    try {
      const { createHash } = require("crypto");
      const bodyJson = JSON.parse(
        Buffer.from(proof.body, "base64").toString("utf-8"),
      );
      const anchoredHash = bodyJson?.spec?.data?.hash?.value;

      if (!anchoredHash) {
        r.warn(
          "Rekor body decoded but missing spec.data.hash.value — cannot cross-check",
        );
        return;
      }

      const expectedHash = createHash("sha256")
        .update(merkleRoot)
        .digest("hex");

      if (anchoredHash === expectedHash) {
        r.pass(
          `Rekor artifact hash MATCHES — SHA-256(merkleRoot) confirmed in embedded proof`,
        );
      } else {
        r.fail(
          `Rekor artifact hash MISMATCH — expected ${expectedHash.substring(0, 16)}..., got ${anchoredHash.substring(0, 16)}...`,
        );
      }

      if (proof.logIndex !== undefined) {
        r.info(`Rekor log index: ${proof.logIndex}`);
      }
    } catch {
      r.warn("Failed to decode Rekor proof body");
    }
  }
}
