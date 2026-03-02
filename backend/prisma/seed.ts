import {
  PrismaClient,
  UserRole,
  OrgType,
  OrgRole,
  Jurisdiction,
  Currency,
  OnboardingStatus,
  SupplierTier,
  Prisma,
} from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

/** Helper: upsert a user, create their Organisation + OrgMembership (skip for ADMIN) */
async function seedUserWithOrg(opts: {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  companyName: string;
  companyNumber?: string;
  balance: number;
  orgType: OrgType;
  jurisdiction: Jurisdiction;
  currency: Currency;
  shariaCompliant?: boolean;
  supplierTier?: SupplierTier;
}) {
  const user = await prisma.user.upsert({
    where: { email: opts.email },
    update: {},
    create: {
      email: opts.email,
      password: opts.password,
      name: opts.name,
      role: opts.role,
      companyName: opts.companyName,
      companyNumber: opts.companyNumber,
      balance: opts.balance,
    },
  });

  // Check if user already has an org via membership
  const existingMembership = await prisma.orgMembership.findUnique({
    where: { userId: user.id },
    include: { organisation: true },
  });

  let org;
  if (existingMembership) {
    // Reuse existing org (idempotent on re-runs)
    org = existingMembership.organisation;
  } else {
    // Create new org + membership on first run
    org = await prisma.organisation.create({
      data: {
        name: opts.companyName,
        type: opts.orgType,
        registrationNo: opts.companyNumber ?? null,
        jurisdiction: opts.jurisdiction,
        currency: opts.currency,
        shariaCompliant: opts.shariaCompliant ?? false,
        onboardingStatus: OnboardingStatus.COMPLETED,
        termsAcceptedAt: new Date(),
        bankIban:
          opts.jurisdiction === Jurisdiction.KSA
            ? `SA03800000006080${Math.random().toString().slice(2, 12)}`
            : `GB29NWBK601613${Math.random().toString().slice(2, 10)}`,
        supplierTier:
          opts.supplierTier ??
          (opts.orgType === OrgType.SUPPLIER ? SupplierTier.BASIC : null),
      },
    });

    await prisma.orgMembership.create({
      data: {
        userId: user.id,
        organisationId: org.id,
        orgRole: OrgRole.OWNER,
        isDefault: true,
      },
    });
  }

  return { user, org };
}

async function main() {
  console.log("🌱 Seeding database...\n");

  // Clean orphaned orgs from previous broken seed runs
  const orphanOrgs = await prisma.organisation.findMany({
    where: { members: { none: {} } },
    select: { id: true },
  });
  if (orphanOrgs.length > 0) {
    const orphanIds = orphanOrgs.map((o) => o.id);
    await prisma.invitation.deleteMany({
      where: { inviterOrgId: { in: orphanIds } },
    });
    await prisma.approvalRequest.deleteMany({
      where: { organisationId: { in: orphanIds } },
    });
    await prisma.policyRule.deleteMany({
      where: { organisationId: { in: orphanIds } },
    });
    await prisma.organisation.deleteMany({ where: { id: { in: orphanIds } } });
    console.log(`🧹 Cleaned ${orphanOrgs.length} orphaned organisations`);
  }

  const password = await bcrypt.hash("password123", 12);

  // ══════════════════════════════════════════════════════════════
  // UK USERS + ORGS
  // ══════════════════════════════════════════════════════════════

  // ── UK Buyers ───────────────────────────────────────────────
  const { user: buyer1, org: orgBuyer1 } = await seedUserWithOrg({
    email: "buyer@acme.co.uk",
    password,
    name: "James Thornton",
    role: UserRole.BUYER,
    companyName: "Acme Retail Ltd",
    companyNumber: "08123456",
    balance: 500_000_00, // £500,000
    orgType: OrgType.BUYER,
    jurisdiction: Jurisdiction.UK,
    currency: Currency.GBP,
  });

  const { user: buyer2, org: orgBuyer2 } = await seedUserWithOrg({
    email: "buyer@greenfield.co.uk",
    password,
    name: "Sarah Mitchell",
    role: UserRole.BUYER,
    companyName: "Greenfield Manufacturing Ltd",
    companyNumber: "09234567",
    balance: 750_000_00, // £750,000
    orgType: OrgType.BUYER,
    jurisdiction: Jurisdiction.UK,
    currency: Currency.GBP,
  });

  // ── UK Suppliers ────────────────────────────────────────────
  const { user: supplier1, org: orgSupplier1 } = await seedUserWithOrg({
    email: "supplier@swiftlogistics.co.uk",
    password,
    name: "David Okafor",
    role: UserRole.SUPPLIER,
    companyName: "Swift Logistics Ltd",
    companyNumber: "10345678",
    balance: 50_000_00, // £50,000
    orgType: OrgType.SUPPLIER,
    jurisdiction: Jurisdiction.UK,
    currency: Currency.GBP,
  });

  const { user: supplier2, org: orgSupplier2 } = await seedUserWithOrg({
    email: "supplier@brightworks.co.uk",
    password,
    name: "Fatima Hassan",
    role: UserRole.SUPPLIER,
    companyName: "Brightworks Engineering Ltd",
    companyNumber: "11456789",
    balance: 35_000_00, // £35,000
    orgType: OrgType.SUPPLIER,
    jurisdiction: Jurisdiction.UK,
    currency: Currency.GBP,
  });

  // ── UK Liquidity Partner ────────────────────────────────────
  const { user: lp, org: orgLP } = await seedUserWithOrg({
    email: "lp@capitalbridge.co.uk",
    password,
    name: "Capital Bridge Fund",
    role: UserRole.LIQUIDITY_PARTNER,
    companyName: "Capital Bridge Finance Ltd",
    companyNumber: "07012345",
    balance: 2_000_000_00, // £2,000,000
    orgType: OrgType.LIQUIDITY_PARTNER,
    jurisdiction: Jurisdiction.UK,
    currency: Currency.GBP,
  });

  // ══════════════════════════════════════════════════════════════
  // KSA USERS + ORGS (Sharia-compliant pilot)
  // ══════════════════════════════════════════════════════════════

  // ── KSA Buyer ───────────────────────────────────────────────
  const { user: ksaBuyer, org: orgKsaBuyer } = await seedUserWithOrg({
    email: "buyer@alrajhi.sa",
    password,
    name: "Ahmed Al-Rashid",
    role: UserRole.BUYER,
    companyName: "Al-Rajhi Trading Co",
    companyNumber: "1010123456",
    balance: 1_000_000_00, // 1,000,000 SAR
    orgType: OrgType.BUYER,
    jurisdiction: Jurisdiction.KSA,
    currency: Currency.SAR,
    shariaCompliant: true,
  });

  // ── KSA Supplier ────────────────────────────────────────────
  const { user: ksaSupplier, org: orgKsaSupplier } = await seedUserWithOrg({
    email: "supplier@noorsupply.sa",
    password,
    name: "Noor Al-Fahad",
    role: UserRole.SUPPLIER,
    companyName: "Noor Supply Chain",
    companyNumber: "1010234567",
    balance: 100_000_00, // 100,000 SAR
    orgType: OrgType.SUPPLIER,
    jurisdiction: Jurisdiction.KSA,
    currency: Currency.SAR,
    shariaCompliant: true,
  });

  // ── KSA Liquidity Partner ──────────────────────────────────
  const { user: ksaLP, org: orgKsaLP } = await seedUserWithOrg({
    email: "lp@tamweel.sa",
    password,
    name: "Tamweel Capital",
    role: UserRole.LIQUIDITY_PARTNER,
    companyName: "Tamweel Capital",
    companyNumber: "1010345678",
    balance: 5_000_000_00, // 5,000,000 SAR
    orgType: OrgType.LIQUIDITY_PARTNER,
    jurisdiction: Jurisdiction.KSA,
    currency: Currency.SAR,
    shariaCompliant: true,
  });

  // ══════════════════════════════════════════════════════════════
  // ADMIN (no org)
  // ══════════════════════════════════════════════════════════════
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

  // ══════════════════════════════════════════════════════════════
  // POLICY RULES
  // ══════════════════════════════════════════════════════════════

  // Helper to upsert policy rules (idempotent by name+orgId)
  async function seedPolicy(
    orgId: string,
    data: {
      ruleType: "PO_APPROVAL" | "FUNDING_LIMIT";
      name: string;
      conditions: Record<string, unknown>;
      requiredApprovals: number;
      requiredRoles: string[];
      autoApprove: boolean;
      priority: number;
    },
  ) {
    // Try to find existing by name for this org
    const existing = await prisma.policyRule.findFirst({
      where: { organisationId: orgId, name: data.name },
    });
    if (existing) return existing;
    return prisma.policyRule.create({
      data: {
        organisationId: orgId,
        ruleType: data.ruleType,
        name: data.name,
        conditions: data.conditions as Prisma.InputJsonValue,
        requiredApprovals: data.requiredApprovals,
        requiredRoles: data.requiredRoles,
        autoApprove: data.autoApprove,
        priority: data.priority,
        active: true,
      },
    });
  }

  // ── KSA Buyer PO Approval Tiers ────────────────────────────
  await seedPolicy(orgKsaBuyer.id, {
    ruleType: "PO_APPROVAL",
    name: "Auto-approve POs ≤ 50,000 SAR",
    conditions: { minAmount: 0, maxAmount: 50_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  });
  await seedPolicy(orgKsaBuyer.id, {
    ruleType: "PO_APPROVAL",
    name: "1 approver for POs 50k–200k SAR",
    conditions: { minAmount: 50_000_01, maxAmount: 200_000_00 },
    requiredApprovals: 1,
    requiredRoles: ["APPROVER"],
    autoApprove: false,
    priority: 5,
  });
  await seedPolicy(orgKsaBuyer.id, {
    ruleType: "PO_APPROVAL",
    name: "2 approvers for POs > 200k SAR",
    conditions: { minAmount: 200_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 2,
    requiredRoles: ["APPROVER", "FINANCE"],
    autoApprove: false,
    priority: 1,
  });

  // ── UK Buyer PO Approval Tiers ─────────────────────────────
  await seedPolicy(orgBuyer1.id, {
    ruleType: "PO_APPROVAL",
    name: "Auto-approve POs ≤ £10,000",
    conditions: { minAmount: 0, maxAmount: 10_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  });
  await seedPolicy(orgBuyer1.id, {
    ruleType: "PO_APPROVAL",
    name: "1 approver for POs £10k–£50k",
    conditions: { minAmount: 10_000_01, maxAmount: 50_000_00 },
    requiredApprovals: 1,
    requiredRoles: ["APPROVER"],
    autoApprove: false,
    priority: 5,
  });
  await seedPolicy(orgBuyer1.id, {
    ruleType: "PO_APPROVAL",
    name: "2 approvers for POs > £50k",
    conditions: { minAmount: 50_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 2,
    requiredRoles: ["APPROVER", "FINANCE"],
    autoApprove: false,
    priority: 1,
  });

  // ── KSA LP Funding Limits ──────────────────────────────────
  await seedPolicy(orgKsaLP.id, {
    ruleType: "FUNDING_LIMIT",
    name: "Tamweel Capital exposure limits",
    conditions: {
      maxExposureTotal: 5_000_000_00, // 5M SAR
      maxExposurePerBuyer: 0.4, // 40% concentration
      maxExposurePerSupplier: 0.3, // 30% concentration
      maxTenorDays: 90,
      feeBps: 250, // ujrah fee
    },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 1,
  });

  // ── UK LP Funding Limits ───────────────────────────────────
  await seedPolicy(orgLP.id, {
    ruleType: "FUNDING_LIMIT",
    name: "Capital Bridge exposure limits",
    conditions: {
      maxExposureTotal: 2_000_000_00, // £2M
      maxExposurePerBuyer: 0.4, // 40% concentration
      maxExposurePerSupplier: 0.3, // 30% concentration
      maxTenorDays: 90,
      feeBps: 200, // lower fee for UK market
    },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 1,
  });

  // ── Summary ─────────────────────────────────────────────────
  console.log("✅ Seeded UK users + organisations:");
  console.log(`   Buyer 1:    ${buyer1.email}  → ${orgBuyer1.name} (UK/GBP)`);
  console.log(`   Buyer 2:    ${buyer2.email}  → ${orgBuyer2.name} (UK/GBP)`);
  console.log(
    `   Supplier 1: ${supplier1.email}  → ${orgSupplier1.name} (UK/GBP)`,
  );
  console.log(
    `   Supplier 2: ${supplier2.email}  → ${orgSupplier2.name} (UK/GBP)`,
  );
  console.log(`   LP:         ${lp.email}  → ${orgLP.name} (UK/GBP)`);
  console.log("");
  console.log("✅ Seeded KSA users + organisations (Sharia-compliant):");
  console.log(
    `   Buyer:      ${ksaBuyer.email}  → ${orgKsaBuyer.name} (KSA/SAR)`,
  );
  console.log(
    `   Supplier:   ${ksaSupplier.email}  → ${orgKsaSupplier.name} (KSA/SAR)`,
  );
  console.log(`   LP:         ${ksaLP.email}  → ${orgKsaLP.name} (KSA/SAR)`);
  console.log("");
  console.log(`✅ Admin:      ${admin.email}`);
  console.log("");
  console.log("✅ Seeded policy rules:");
  console.log(
    "   KSA Buyer:  3 PO approval tiers (auto ≤50k, 1 approver ≤200k, 2 approvers >200k SAR)",
  );
  console.log(
    "   UK Buyer 1: 3 PO approval tiers (auto ≤£10k, 1 approver ≤£50k, 2 approvers >£50k)",
  );
  console.log(
    "   KSA LP:     Funding limits (5M SAR total, 40% buyer, 30% supplier, 90d tenor, 250bps)",
  );
  console.log(
    "   UK LP:      Funding limits (£2M total, 40% buyer, 30% supplier, 90d tenor, 200bps)",
  );
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
