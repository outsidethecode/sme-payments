import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    email: string;
    password: string;
    name: string;
    companyName: string;
    companyNumber?: string;
    role: string;
  }) {
    return this.prisma.user.create({
      data: {
        email: data.email,
        password: data.password,
        name: data.name,
        companyName: data.companyName,
        companyNumber: data.companyNumber,
        role: data.role as any,
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByRole(role: string) {
    return this.prisma.user.findMany({
      where: { role: role as any },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyName: true,
        companyNumber: true,
        balance: true,
        createdAt: true,
      },
    });
  }

  /**
   * Returns one representative contact per supplier organisation.
   * Prefers the OWNER; falls back to earliest member.
   * Deduplicates by org name (keeps the earliest-created org).
   * Excludes orphan users with no org membership.
   */
  async getSupplierContacts() {
    const orgs = await this.prisma.organisation.findMany({
      where: { type: "SUPPLIER" },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                companyName: true,
                companyNumber: true,
                balance: true,
                createdAt: true,
              },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    });

    // Deduplicate by org name — keep the first (earliest-created) org per name
    const seen = new Set<string>();
    return orgs
      .filter((org) => {
        const key = org.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((org) => {
        const owner = org.members.find((m) => m.orgRole === "OWNER");
        const representative = owner || org.members[0];
        if (!representative) return null;
        return {
          ...representative.user,
          organisationId: org.id,
          organisationName: org.name,
        };
      })
      .filter(Boolean);
  }

  async updateBalance(userId: string, amountDelta: number) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { balance: { increment: amountDelta } },
    });
  }

  async getBalance(userId: string): Promise<number> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true },
    });
    return user.balance;
  }
}
