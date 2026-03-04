import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ProofGeneratorService } from "./proof-generator.service";
import { ProofVerifierService } from "./proof-verifier.service";
import { PrismaService } from "../prisma/prisma.service";
import type { ProofBundle } from "./proof-bundle.schema";

@ApiTags("Proofs")
@Controller("proofs")
export class ProofsController {
  constructor(
    private readonly generator: ProofGeneratorService,
    private readonly verifier: ProofVerifierService,
    private readonly prisma: PrismaService,
  ) {}

  // ══════════════════════════════════════════════════════════
  // AUTHENTICATED — Generate proof bundles
  // ══════════════════════════════════════════════════════════

  /**
   * Generate a standalone proof bundle for a single ledger event.
   *
   * The bundle is a self-contained JSON document that any external party
   * can independently verify without trusting the platform.
   */
  @Get("event/:eventId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Generate standalone proof bundle for an event" })
  async getEventProof(@Param("eventId") eventId: string) {
    return this.generator.generateProof(eventId);
  }

  /**
   * Generate proof bundles for all events of an entity (e.g., full PO lifecycle).
   *
   * Returns an array of proof bundles with chain linkage verification.
   */
  @Get("entity/:entityId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Generate proof bundles for all entity events" })
  async getEntityProofs(@Param("entityId") entityId: string) {
    return this.generator.generateEntityProofs(entityId);
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC — Verification (no authentication required)
  // ══════════════════════════════════════════════════════════

  /**
   * Verify a proof bundle.
   *
   * This endpoint is intentionally PUBLIC — any external party can submit
   * a proof bundle for independent verification. The service performs:
   *
   * 1. Bundle structure validation
   * 2. Intent hash recomputation
   * 3. Challenge binding verification (clientDataJSON → intentHash)
   * 4. Payload hash verification
   * 5. Public key resolution & cross-check (from credential registry)
   * 6. WebAuthn ECDSA P-256 signature verification
   * 7. Hash chain integrity verification
   *
   * Returns a detailed per-step pass/fail result.
   */
  @Post("verify")
  @ApiOperation({ summary: "Verify a proof bundle (public, no auth required)" })
  async verifyProof(@Body() bundle: ProofBundle) {
    // Optionally resolve the public key from the credential registry
    // to cross-check against the bundle
    let resolvedPublicKey: string | undefined;

    if (
      bundle.credential?.credentialId &&
      bundle.credential.credentialId !== "SYSTEM"
    ) {
      const passkey = await this.prisma.userPasskey.findUnique({
        where: { credentialId: bundle.credential.credentialId },
        select: { publicKey: true },
      });
      if (passkey) {
        resolvedPublicKey = passkey.publicKey.toString("base64");
      }
    }

    return this.verifier.verify(bundle, resolvedPublicKey);
  }

  /**
   * Verify a proof bundle in offline mode (no registry lookup).
   *
   * Uses only the materials embedded in the bundle — does not contact
   * the credential registry. This is for fully disconnected verification.
   */
  @Post("verify/offline")
  @ApiOperation({
    summary: "Verify a proof bundle offline (no registry lookup)",
  })
  async verifyProofOffline(@Body() bundle: ProofBundle) {
    return this.verifier.verify(bundle);
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC — Credential & Identity Registry
  // ══════════════════════════════════════════════════════════

  /**
   * Public credential registry — resolve a credential's public key.
   *
   * Any external verifier can call this to independently confirm that
   * a given credential ID maps to a specific public key, without needing
   * to trust the proof bundle.
   */
  @Get("registry/credentials/:credentialId")
  @ApiOperation({
    summary: "Lookup credential public key (public registry, no auth required)",
  })
  async lookupCredential(@Param("credentialId") credentialId: string) {
    const passkey = await this.prisma.userPasskey.findUnique({
      where: { credentialId },
      select: {
        credentialId: true,
        publicKey: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        userId: true,
      },
    });

    if (!passkey) {
      throw new NotFoundException("Credential not found in registry");
    }

    return {
      credentialId: passkey.credentialId,
      publicKeyBase64: passkey.publicKey.toString("base64"),
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      registeredAt: passkey.createdAt.toISOString(),
      boundToUser: passkey.userId,
    };
  }

  /**
   * Public identity registry — resolve a signer's verified identity.
   *
   * Returns the platform-attested identity of a user (name, email, role,
   * organisation). An external verifier can use this to confirm that
   * the signer in a proof bundle is who they claim to be.
   */
  @Get("identity/signers/:userId")
  @ApiOperation({
    summary: "Lookup signer identity (public registry, no auth required)",
  })
  async lookupSigner(@Param("userId") userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        orgMemberships: {
          include: {
            organisation: {
              select: {
                id: true,
                name: true,
                type: true,
                jurisdiction: true,
                registrationNo: true,
                kybVerifiedAt: true,
              },
            },
          },
          take: 1,
        },
        passkeys: {
          select: {
            credentialId: true,
            deviceType: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("Signer not found in registry");
    }

    const org = user.orgMemberships[0]?.organisation ?? null;

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organisation: org
        ? {
            id: org.id,
            name: org.name,
            type: org.type,
            jurisdiction: org.jurisdiction,
            registrationNo: org.registrationNo,
            kybVerified: !!org.kybVerifiedAt,
          }
        : null,
      credentials: user.passkeys.map((pk) => ({
        credentialId: pk.credentialId,
        deviceType: pk.deviceType,
        registeredAt: pk.createdAt.toISOString(),
      })),
    };
  }
}
