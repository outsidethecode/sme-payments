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
