import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PdpaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PDPA / KSA Data Protection: export all personal data for a user.
   * Returns a JSON-serialisable object containing every piece of PII
   * and related transactional data tied to the given userId.
   */
  async exportUserData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        passkeys: {
          select: {
            id: true,
            credentialId: true,
            deviceType: true,
            backedUp: true,
            createdAt: true,
            lastUsedAt: true,
          },
        },
        orgMemberships: {
          include: {
            organisation: {
              select: {
                id: true,
                name: true,
                type: true,
                jurisdiction: true,
              },
            },
          },
        },
        purchaseOrdersBuyer: {
          select: {
            id: true,
            referenceNumber: true,
            amount: true,
            currency: true,
            status: true,
            createdAt: true,
          },
        },
        purchaseOrdersSupplier: {
          select: {
            id: true,
            referenceNumber: true,
            amount: true,
            currency: true,
            status: true,
            createdAt: true,
          },
        },
        paymentLocks: {
          select: {
            id: true,
            amount: true,
            status: true,
            createdAt: true,
          },
        },
        earlyPaymentsSupplier: {
          select: {
            id: true,
            faceValue: true,
            serviceFee: true,
            netAdvance: true,
            status: true,
            createdAt: true,
          },
        },
        earlyPaymentsLP: {
          select: {
            id: true,
            faceValue: true,
            serviceFee: true,
            netAdvance: true,
            status: true,
            createdAt: true,
          },
        },
        eventLogs: {
          select: {
            id: true,
            eventType: true,
            createdAt: true,
          },
        },
        approvals: {
          select: {
            id: true,
            decision: true,
            createdAt: true,
          },
        },
        evidenceUploads: {
          select: {
            id: true,
            type: true,
            filename: true,
            createdAt: true,
          },
        },
        disputesRaised: {
          select: {
            id: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException("User not found");

    // Strip password hash from export
    const { password: _pw, ...safeUser } = user;
    return {
      exportedAt: new Date().toISOString(),
      subject: safeUser,
    };
  }

  /**
   * PDPA / KSA Data Protection: erase personal data.
   * Performs a pseudonymisation (soft delete) — replaces PII with
   * placeholders while retaining transactional records for audit.
   */
  async eraseUserData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException("User not found");

    await this.prisma.$transaction(async (tx) => {
      // Pseudonymise user record
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `erased-${userId}@deleted.local`,
          name: "ERASED",
          password: "ERASED",
          companyName: null,
          companyNumber: null,
        },
      });

      // Delete passkeys (no audit value, pure PII)
      await tx.userPasskey.deleteMany({ where: { userId } });

      // Delete any pending invitations sent by this user
      await tx.invitation.deleteMany({ where: { inviterUserId: userId } });
    });

    return {
      erased: true,
      userId,
      erasedAt: new Date().toISOString(),
    };
  }
}
