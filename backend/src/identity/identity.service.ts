import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createHash } from "crypto";
import {
  IdentityProvider,
  IdentityInitiateResult,
  IdentityVerificationResult,
  IDENTITY_PROVIDER,
} from "./identity-provider.interface";

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    @Inject(IDENTITY_PROVIDER)
    private readonly provider: IdentityProvider,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Initiate identity verification for a user.
   * Returns a transaction ID and random number for the user to confirm.
   */
  async initiate(
    userId: string,
    nationalId: string,
  ): Promise<IdentityInitiateResult> {
    // Check if user already verified
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { identityVerifiedAt: true },
    });

    if (user?.identityVerifiedAt) {
      throw new BadRequestException("Identity already verified");
    }

    // Check for duplicate national ID (prevent same person, multiple accounts)
    const idHash = this.hashNationalId(nationalId);
    const existing = await this.prisma.user.findUnique({
      where: { nationalIdHash: idHash },
      select: { id: true },
    });

    if (existing && existing.id !== userId) {
      throw new ConflictException(
        "This national ID is already registered with another account",
      );
    }

    this.logger.log(`Initiating identity verification for user ${userId}`);
    return this.provider.initiate(nationalId);
  }

  /**
   * Check the status of a pending identity verification.
   * If verified, persists the result to the User model.
   */
  async checkStatus(
    userId: string,
    transactionId: string,
    nationalId: string,
  ): Promise<IdentityVerificationResult> {
    const result = await this.provider.checkStatus(transactionId);

    if (result.verified) {
      const idHash = this.hashNationalId(nationalId);

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          nationalIdHash: idHash,
          identityProvider: result.provider,
          identityVerifiedAt: result.verifiedAt ?? new Date(),
          identityVerifiedName: result.fullNameEn || result.fullNameAr || null,
          identityData: result.rawResponse ?? {
            provider: result.provider,
            nationalIdMasked: result.nationalIdMasked,
            fullNameAr: result.fullNameAr,
            fullNameEn: result.fullNameEn,
            dateOfBirth: result.dateOfBirth,
            nationality: result.nationality,
            transactionId: result.transactionId,
            verifiedAt: result.verifiedAt?.toISOString(),
          },
        },
      });

      this.logger.log(
        `Identity verified for user ${userId} via ${result.provider}`,
      );
    }

    return result;
  }

  /**
   * Get identity verification status for a user.
   */
  async getVerificationStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        identityProvider: true,
        identityVerifiedAt: true,
        identityVerifiedName: true,
      },
    });

    return {
      verified: !!user?.identityVerifiedAt,
      provider: user?.identityProvider ?? null,
      verifiedAt: user?.identityVerifiedAt ?? null,
      verifiedName: user?.identityVerifiedName ?? null,
    };
  }

  /**
   * SHA-256 hash of national ID for uniqueness check without storing raw ID.
   */
  private hashNationalId(nationalId: string): string {
    return createHash("sha256").update(nationalId.trim()).digest("hex");
  }
}
