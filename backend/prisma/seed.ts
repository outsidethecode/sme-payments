import { PrismaClient, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  const password = await bcrypt.hash("password123", 12);

  // ── Buyers ──────────────────────────────────────────────────
  const buyer1 = await prisma.user.upsert({
    where: { email: "buyer@acme.co.uk" },
    update: {},
    create: {
      email: "buyer@acme.co.uk",
      password,
      name: "James Thornton",
      role: UserRole.BUYER,
      companyName: "Acme Retail Ltd",
      companyNumber: "08123456",
      balance: 500_000_00, // £500,000
    },
  });

  const buyer2 = await prisma.user.upsert({
    where: { email: "buyer@greenfield.co.uk" },
    update: {},
    create: {
      email: "buyer@greenfield.co.uk",
      password,
      name: "Sarah Mitchell",
      role: UserRole.BUYER,
      companyName: "Greenfield Manufacturing Ltd",
      companyNumber: "09234567",
      balance: 750_000_00, // £750,000
    },
  });

  // ── Suppliers ───────────────────────────────────────────────
  const supplier1 = await prisma.user.upsert({
    where: { email: "supplier@swiftlogistics.co.uk" },
    update: {},
    create: {
      email: "supplier@swiftlogistics.co.uk",
      password,
      name: "David Okafor",
      role: UserRole.SUPPLIER,
      companyName: "Swift Logistics Ltd",
      companyNumber: "10345678",
      balance: 50_000_00, // £50,000
    },
  });

  const supplier2 = await prisma.user.upsert({
    where: { email: "supplier@brightworks.co.uk" },
    update: {},
    create: {
      email: "supplier@brightworks.co.uk",
      password,
      name: "Fatima Hassan",
      role: UserRole.SUPPLIER,
      companyName: "Brightworks Engineering Ltd",
      companyNumber: "11456789",
      balance: 35_000_00, // £35,000
    },
  });

  // ── Liquidity Partner ───────────────────────────────────────
  const lp = await prisma.user.upsert({
    where: { email: "lp@capitalbridge.co.uk" },
    update: {},
    create: {
      email: "lp@capitalbridge.co.uk",
      password,
      name: "Capital Bridge Fund",
      role: UserRole.LIQUIDITY_PARTNER,
      companyName: "Capital Bridge Finance Ltd",
      companyNumber: "07012345",
      balance: 2_000_000_00, // £2,000,000
    },
  });

  // ── Admin ───────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: "admin@platform.co.uk" },
    update: {},
    create: {
      email: "admin@platform.co.uk",
      password,
      name: "Platform Admin",
      role: UserRole.ADMIN,
      companyName: "Programmable SME Settlement",
      balance: 0,
    },
  });

  console.log("✅ Seeded users:");
  console.log(`   Buyer 1:    ${buyer1.email} (${buyer1.companyName})`);
  console.log(`   Buyer 2:    ${buyer2.email} (${buyer2.companyName})`);
  console.log(`   Supplier 1: ${supplier1.email} (${supplier1.companyName})`);
  console.log(`   Supplier 2: ${supplier2.email} (${supplier2.companyName})`);
  console.log(`   LP:         ${lp.email} (${lp.companyName})`);
  console.log(`   Admin:      ${admin.email}`);
  console.log("");
  console.log("   All passwords: password123");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
