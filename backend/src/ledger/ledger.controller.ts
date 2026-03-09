import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  NotFoundException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { LedgerService } from "./ledger.service";
import { PasskeysService } from "../passkeys/passkeys.service";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("Ledger")
@Controller("ledger")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly passkeysService: PasskeysService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List ledger events" })
  @ApiQuery({ name: "entityId", required: false })
  async list(@Query("entityId") entityId?: string) {
    return this.ledgerService.getEvents(entityId);
  }

  @Get("verify/:entityId")
  @ApiOperation({ summary: "Verify hash chain for an entity" })
  async verify(@Param("entityId") entityId: string) {
    return this.ledgerService.verifyChain(entityId);
  }

  /**
   * Self-contained proof bundle for a single event.
   *
   * Returns everything an external party needs to independently verify
   * that a specific user authorised a specific action — without trusting
   * the platform.  The bundle contains:
   *
   *  1. The business intent fields (eventType, entityId, actorId)
   *  2. The intentHash = SHA-256 of those fields (used as WebAuthn challenge)
   *  3. The raw clientDataJSON (browser-produced; embeds the challenge + origin)
   *  4. The authenticatorData + signature produced by the passkey
   *  5. The COSE public key (base64) of the credential
   *  6. Step-by-step independent verification algorithm
   *
   * Verification algorithm (for any external verifier):
   *  a) Recompute intentHash = SHA-256(eventType|entityId|actorId)
   *  b) Base64url-decode clientDataJSON → parse JSON → extract `challenge`
   *  c) Confirm challenge === base64url(intentHash)  ← BINDS signature to intent
   *  d) Compute clientDataHash = SHA-256(clientDataJSON bytes)
   *  e) signedData = authenticatorData || clientDataHash
   *  f) Verify signature over signedData using the COSE public key
   *     (This is the standard WebAuthn assertion verification)
   *
   * If all steps pass, the verifier knows: the holder of this credential
   * (identified by its public key) biometrically authorised exactly this
   * business action.  No platform trust required.
   */
  @Get("proof/:eventId")
  @ApiOperation({ summary: "Get self-contained cryptographic proof bundle" })
  async getProof(@Param("eventId") eventId: string) {
    const event = await this.prisma.eventLog.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    const isSigned =
      event.actorSignature !== "SYSTEM" &&
      event.actorSignature !== "MVP_PLACEHOLDER";

    return {
      eventId: event.id,
      // ── Business intent ────────────────────────────────
      intent: {
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        actorId: event.actorId,
        actorRole: event.actorRole,
        payload: event.payload,
        timestamp: event.timestamp,
      },
      // ── Cryptographic proof ────────────────────────────
      proof: isSigned
        ? {
            intentHash: event.intentHash,
            clientDataJSON: event.clientDataJSON,
            authenticatorData: event.authenticatorData,
            signature: event.actorSignature,
            publicKey: event.actorPublicKey,
            credentialId: event.credentialId,
          }
        : null,
      // ── Hash chain context ─────────────────────────────
      chain: {
        eventHash: event.eventHash,
        previousHash: event.previousHash,
        sequence: event.entitySequence,
      },
      // ── Verification instructions ──────────────────────
      verification: isSigned
        ? {
            algorithm: "WebAuthn-FIDO2-ES256",
            steps: [
              "1. Recompute intentHash = SHA-256(eventType + '|' + entityId + '|' + actorId)  — this is the business intent",
              "2. Base64url-decode the clientDataJSON field",
              "3. Parse the decoded JSON and extract the 'challenge' field",
              "4. Confirm that challenge === base64url(intentHash)  — this binds the signature to the business intent",
              "5. Compute clientDataHash = SHA-256(raw clientDataJSON bytes)",
              "6. Concatenate: signedData = authenticatorData || clientDataHash",
              "7. Verify the 'signature' over signedData using the 'publicKey' (COSE/ECDSA P-256)",
              "8. If valid, the credential holder biometrically authorised this exact action",
            ],
          }
        : {
            algorithm: "none",
            steps: [
              "This event was recorded by the system without a passkey signature.",
            ],
          },
    };
  }

  /**
   * Step 1 of the sign flow: request a WebAuthn challenge for a specific action.
   *
   * Instead of a random nonce, the challenge is the SHA-256 hash of the
   * business intent (eventType|entityId|actorId).  This means the
   * authenticator's signature cryptographically binds to the specific
   * action being authorised — making the proof self-contained.
   */
  @Post("challenge")
  @ApiOperation({ summary: "Request signing challenge for a ledger action" })
  async requestChallenge(
    @Request() req: any,
    @Body() body: { entityId: string; eventType: string },
  ) {
    const purpose = `sign:${body.eventType}:${body.entityId}`;

    // Compute a deterministic intent hash from the business action.
    // This becomes the WebAuthn challenge, binding the biometric
    // signature to this exact intent.
    const intentHash = this.ledgerService.computeIntentHash(
      body.eventType,
      body.entityId,
      req.user.id,
    );

    const options = await this.passkeysService.generateAuthOptions(
      req.user.id,
      purpose,
      intentHash,
    );
    return { purpose, intentHash, options };
  }

  /**
   * Step 2: Submit a signed event with the WebAuthn assertion.
   * Verifies the assertion, then appends the event with the real signature
   * plus the intentHash and clientDataJSON for independent verification.
   */
  @Post("events")
  @ApiOperation({ summary: "Submit a passkey-signed ledger event" })
  async submitSignedEvent(
    @Request() req: any,
    @Body()
    body: {
      purpose: string;
      assertion: any;
      entityType: string;
      entityId: string;
      eventType: string;
      payload: Record<string, unknown>;
      intentHash?: string;
    },
  ) {
    // Verify the WebAuthn assertion
    const verified = await this.passkeysService.verifyAuthResponse(
      req.user.id,
      body.purpose,
      body.assertion,
    );

    // Append the event with real signature data + self-contained proof fields
    return this.ledgerService.logEvent({
      entityType: body.entityType,
      entityId: body.entityId,
      eventType: body.eventType,
      actorId: req.user.id,
      actorRole: req.user.role,
      payload: body.payload,
      signature: verified.signature,
      authenticatorData: verified.authenticatorData,
      publicKey: verified.publicKey,
      credentialId: verified.credentialId,
      intentHash: body.intentHash,
      clientDataJSON: verified.clientDataJSON,
    });
  }
}
