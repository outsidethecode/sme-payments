import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { RedisChallengeStore } from "./redis-challenge-store";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types";

@Injectable()
export class PasskeysService {
  private readonly rpName: string;
  private readonly rpId: string;
  private readonly origin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly challengeStore: RedisChallengeStore,
  ) {
    this.rpName = this.config.get<string>(
      "WEBAUTHN_RP_NAME",
      "Programmable SME Settlement",
    );
    this.rpId = this.config.get<string>("WEBAUTHN_RP_ID", "localhost");
    this.origin = this.config.get<string>(
      "WEBAUTHN_ORIGIN",
      "http://localhost:3000",
    );
  }

  // ── Registration ────────────────────────────────────────────

  async generateRegOptions(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    // Get existing credentials for exclusion
    const existingPasskeys = await this.prisma.userPasskey.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userName: user.email,
      userDisplayName: user.name,
      userID: Buffer.from(userId),
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports as AuthenticatorTransportFuture[],
      })),
    });

    // Store challenge in Redis (or in-memory fallback)
    const key = `${userId}:registration`;
    await this.challengeStore.set(key, options.challenge);

    return options;
  }

  async verifyRegResponse(userId: string, response: RegistrationResponseJSON) {
    const key = `${userId}:registration`;
    const challenge = await this.challengeStore.getAndDelete(key);
    if (!challenge) {
      throw new BadRequestException("Challenge expired or not found");
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException("Passkey registration verification failed");
    }

    const {
      credentialID,
      credentialPublicKey,
      counter,
      credentialDeviceType,
      credentialBackedUp,
    } = verification.registrationInfo;

    // Store the credential
    const passkey = await this.prisma.userPasskey.create({
      data: {
        userId,
        credentialId: credentialID,
        publicKey: Buffer.from(credentialPublicKey),
        signCount: counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: (response.response.transports ?? []) as string[],
      },
    });

    return {
      verified: true,
      credentialId: passkey.credentialId,
      deviceType: passkey.deviceType,
    };
  }

  // ── Authentication / Signing ────────────────────────────────

  /**
   * Generate a WebAuthn authentication challenge.
   * `purpose` allows different challenge scopes (e.g., "login", "sign:PO_SENT:uuid")
   */
  async generateAuthOptions(
    userId: string,
    purpose: string = "login",
    intentHash?: string,
  ) {
    const passkeys = await this.prisma.userPasskey.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });

    if (passkeys.length === 0) {
      throw new BadRequestException(
        "No passkeys registered. Please register a passkey first.",
      );
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: "preferred",
      // If an intentHash is provided, use it as the challenge so the
      // authenticator's signature cryptographically binds to the
      // business payload (self-contained proof).
      ...(intentHash ? { challenge: intentHash } : {}),
      allowCredentials: passkeys.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports as AuthenticatorTransportFuture[],
      })),
    });

    // Store challenge keyed by purpose in Redis
    const key = `${userId}:${purpose}`;
    await this.challengeStore.set(key, options.challenge);

    return options;
  }

  /**
   * Verify a WebAuthn authentication response (assertion).
   * Returns the verified credential info for inclusion in the ledger event.
   */
  async verifyAuthResponse(
    userId: string,
    purpose: string,
    response: AuthenticationResponseJSON,
  ) {
    const key = `${userId}:${purpose}`;
    const challenge = await this.challengeStore.getAndDelete(key);
    if (!challenge) {
      throw new BadRequestException("Challenge expired or not found");
    }

    // Look up the credential
    const passkey = await this.prisma.userPasskey.findUnique({
      where: { credentialId: response.id },
    });
    if (!passkey || passkey.userId !== userId) {
      throw new BadRequestException("Credential not found for this user");
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      requireUserVerification: false,
      authenticator: {
        credentialID: passkey.credentialId,
        credentialPublicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.signCount,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
    });

    if (!verification.verified) {
      throw new BadRequestException("Passkey authentication failed");
    }

    // Update sign count
    await this.prisma.userPasskey.update({
      where: { id: passkey.id },
      data: {
        signCount: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    return {
      verified: true,
      credentialId: passkey.credentialId,
      signature: response.response.signature,
      authenticatorData: response.response.authenticatorData,
      clientDataJSON: response.response.clientDataJSON,
      publicKey: passkey.publicKey.toString("base64"),
    };
  }

  // ── Helpers ─────────────────────────────────────────────────

  async hasPasskey(userId: string): Promise<boolean> {
    const count = await this.prisma.userPasskey.count({
      where: { userId },
    });
    return count > 0;
  }

  async listPasskeys(userId: string) {
    return this.prisma.userPasskey.findMany({
      where: { userId },
      select: {
        id: true,
        credentialId: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
  }

  async deletePasskey(userId: string, passkeyId: string) {
    const passkey = await this.prisma.userPasskey.findUnique({
      where: { id: passkeyId },
    });
    if (!passkey || passkey.userId !== userId) {
      throw new NotFoundException("Passkey not found");
    }
    await this.prisma.userPasskey.delete({ where: { id: passkeyId } });
    return { deleted: true };
  }
}
