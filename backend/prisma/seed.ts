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
      ruleType:
        | "PO_APPROVAL"
        | "PO_ORDER_LIMITS"
        | "FUNDING_LIMIT"
        | "ESCROW_FUNDING"
        | "SUPPLIER_ACCEPTANCE"
        | "SETTLEMENT"
        | "EARLY_PAYMENT"
        | "LP_FUNDING"
        | "DELIVERY_VERIFICATION";
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

  // ── KSA Buyer PO Order Limits ──────────────────────────────
  await seedPolicy(orgKsaBuyer.id, {
    ruleType: "PO_ORDER_LIMITS",
    name: "KSA PO order limits (SAR)",
    conditions: { minAmount: 1_875_00, maxAmount: 93_750_000 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 1,
  });

  // ── KSA Buyer Escrow Funding Rules ─────────────────────────
  await seedPolicy(orgKsaBuyer.id, {
    ruleType: "ESCROW_FUNDING",
    name: "Auto-approve escrow ≤ 100,000 SAR",
    conditions: { minAmount: 0, maxAmount: 100_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  });
  await seedPolicy(orgKsaBuyer.id, {
    ruleType: "ESCROW_FUNDING",
    name: "Large escrow funding approval (SAR)",
    conditions: { minAmount: 100_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE"],
    autoApprove: false,
    priority: 5,
  });

  // ── KSA Buyer Settlement Rules ─────────────────────────────
  await seedPolicy(orgKsaBuyer.id, {
    ruleType: "SETTLEMENT",
    name: "Auto-settle ≤ 200,000 SAR",
    conditions: { minAmount: 0, maxAmount: 200_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  });
  await seedPolicy(orgKsaBuyer.id, {
    ruleType: "SETTLEMENT",
    name: "Large settlement approval (SAR)",
    conditions: { minAmount: 200_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE", "OWNER"],
    autoApprove: false,
    priority: 5,
  });

  // ── UK Buyer PO Order Limits ───────────────────────────────
  await seedPolicy(orgBuyer1.id, {
    ruleType: "PO_ORDER_LIMITS",
    name: "UK PO order limits (GBP)",
    conditions: { minAmount: 500_00, maxAmount: 250_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
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

  // ── UK Buyer Escrow Funding Rules ──────────────────────────
  await seedPolicy(orgBuyer1.id, {
    ruleType: "ESCROW_FUNDING",
    name: "Auto-approve escrow ≤ £25,000",
    conditions: { minAmount: 0, maxAmount: 25_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  });
  await seedPolicy(orgBuyer1.id, {
    ruleType: "ESCROW_FUNDING",
    name: "Large escrow funding approval",
    conditions: { minAmount: 25_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE"],
    autoApprove: false,
    priority: 5,
  });

  // ── UK Buyer Settlement Rules ──────────────────────────────
  await seedPolicy(orgBuyer1.id, {
    ruleType: "SETTLEMENT",
    name: "Auto-settle ≤ £50,000",
    conditions: { minAmount: 0, maxAmount: 50_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  });
  await seedPolicy(orgBuyer1.id, {
    ruleType: "SETTLEMENT",
    name: "Large settlement approval",
    conditions: { minAmount: 50_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE", "OWNER"],
    autoApprove: false,
    priority: 5,
  });

  // ── UK Buyer Delivery Verification ─────────────────────────
  await seedPolicy(orgBuyer1.id, {
    ruleType: "DELIVERY_VERIFICATION",
    name: "Auto-verify delivery ≤ £50,000",
    conditions: { minAmount: 0, maxAmount: 50_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  });
  await seedPolicy(orgBuyer1.id, {
    ruleType: "DELIVERY_VERIFICATION",
    name: "Large delivery verification",
    conditions: { minAmount: 50_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE"],
    autoApprove: false,
    priority: 5,
  });

  // ── UK Supplier Policy Rules ───────────────────────────────
  await seedPolicy(orgSupplier1.id, {
    ruleType: "SUPPLIER_ACCEPTANCE",
    name: "Auto-accept POs ≤ £20,000",
    conditions: { minAmount: 0, maxAmount: 20_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  });
  await seedPolicy(orgSupplier1.id, {
    ruleType: "SUPPLIER_ACCEPTANCE",
    name: "Large PO acceptance approval",
    conditions: { minAmount: 20_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["APPROVER", "OWNER"],
    autoApprove: false,
    priority: 5,
  });
  await seedPolicy(orgSupplier1.id, {
    ruleType: "EARLY_PAYMENT",
    name: "Auto-approve early pay ≤ £15,000",
    conditions: { minAmount: 0, maxAmount: 15_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  });
  await seedPolicy(orgSupplier1.id, {
    ruleType: "EARLY_PAYMENT",
    name: "Large early pay approval",
    conditions: { minAmount: 15_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 1,
    requiredRoles: ["FINANCE"],
    autoApprove: false,
    priority: 5,
  });

  // ── UK LP Funding Tiers ────────────────────────────────────
  await seedPolicy(orgLP.id, {
    ruleType: "LP_FUNDING",
    name: "Auto-fund ≤ £25,000",
    conditions: { minAmount: 0, maxAmount: 25_000_00 },
    requiredApprovals: 0,
    requiredRoles: [],
    autoApprove: true,
    priority: 10,
  });
  await seedPolicy(orgLP.id, {
    ruleType: "LP_FUNDING",
    name: "Large LP funding approval",
    conditions: { minAmount: 25_000_01, maxAmount: 100_000_00 },
    requiredApprovals: 1,
    requiredRoles: ["APPROVER"],
    autoApprove: false,
    priority: 5,
  });
  await seedPolicy(orgLP.id, {
    ruleType: "LP_FUNDING",
    name: "Major LP commitment (2 approvers)",
    conditions: { minAmount: 100_000_01, maxAmount: 999_999_999_99 },
    requiredApprovals: 2,
    requiredRoles: ["APPROVER", "FINANCE"],
    autoApprove: false,
    priority: 1,
  });

  // ══════════════════════════════════════════════════════════════
  // TEAM MEMBERS — APPROVER + FINANCE for testing
  // ══════════════════════════════════════════════════════════════

  // Helper: add team member if not already in org
  async function seedTeamMember(opts: {
    email: string;
    name: string;
    role: UserRole;
    orgId: string;
    orgRole: OrgRole;
  }) {
    const user = await prisma.user.upsert({
      where: { email: opts.email },
      update: {},
      create: {
        email: opts.email,
        password,
        name: opts.name,
        role: opts.role,
        companyName: "Team Member",
        balance: 0,
      },
    });
    const existing = await prisma.orgMembership.findUnique({
      where: { userId: user.id },
    });
    if (!existing) {
      await prisma.orgMembership.create({
        data: {
          userId: user.id,
          organisationId: opts.orgId,
          orgRole: opts.orgRole,
          isDefault: true,
        },
      });
    }
    return user;
  }

  // UK Buyer 1 team
  const buyer1Approver = await seedTeamMember({
    email: "approver@acme.co.uk",
    name: "Emma Thornton",
    role: UserRole.BUYER,
    orgId: orgBuyer1.id,
    orgRole: OrgRole.APPROVER,
  });
  const buyer1Finance = await seedTeamMember({
    email: "finance@acme.co.uk",
    name: "Robert Chen",
    role: UserRole.BUYER,
    orgId: orgBuyer1.id,
    orgRole: OrgRole.FINANCE,
  });

  // UK Supplier 1 team
  const supplier1Approver = await seedTeamMember({
    email: "approver@swiftlogistics.co.uk",
    name: "Linda Patel",
    role: UserRole.SUPPLIER,
    orgId: orgSupplier1.id,
    orgRole: OrgRole.APPROVER,
  });
  const supplier1Finance = await seedTeamMember({
    email: "finance@swiftlogistics.co.uk",
    name: "Mark Williams",
    role: UserRole.SUPPLIER,
    orgId: orgSupplier1.id,
    orgRole: OrgRole.FINANCE,
  });

  // UK LP team
  const lpApprover = await seedTeamMember({
    email: "approver@capitalbridge.co.uk",
    name: "Victoria Adams",
    role: UserRole.LIQUIDITY_PARTNER,
    orgId: orgLP.id,
    orgRole: OrgRole.APPROVER,
  });
  const lpFinance = await seedTeamMember({
    email: "finance@capitalbridge.co.uk",
    name: "Charles Wright",
    role: UserRole.LIQUIDITY_PARTNER,
    orgId: orgLP.id,
    orgRole: OrgRole.FINANCE,
  });

  // ── Escrow Accounts ─────────────────────────────────────────
  const escrowGBP = await prisma.escrowAccount.upsert({
    where: { country_currency: { country: "GB", currency: "GBP" } },
    update: {},
    create: {
      label: "UK GBP Escrow (Simulated)",
      bank: "Barclays (Simulated)",
      iban: "GB29BARC20035394427492",
      country: "GB",
      currency: "GBP",
      balanceMinor: 0,
      active: true,
    },
  });
  const escrowSAR = await prisma.escrowAccount.upsert({
    where: { country_currency: { country: "SA", currency: "SAR" } },
    update: {},
    create: {
      label: "KSA SAR Escrow (Simulated)",
      bank: "Al Rajhi Bank (Simulated)",
      iban: "SA0380000000608010167519",
      country: "SA",
      currency: "SAR",
      balanceMinor: 0,
      active: true,
    },
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
  console.log("✅ Team members (APPROVER / FINANCE):");
  console.log(
    `   Buyer 1:    ${buyer1Approver.email} (APPROVER), ${buyer1Finance.email} (FINANCE)`,
  );
  console.log(
    `   Supplier 1: ${supplier1Approver.email} (APPROVER), ${supplier1Finance.email} (FINANCE)`,
  );
  console.log(
    `   LP:         ${lpApprover.email} (APPROVER), ${lpFinance.email} (FINANCE)`,
  );
  console.log("");
  console.log("✅ Escrow accounts:");
  console.log(`   GBP: ${escrowGBP.label} (${escrowGBP.id})`);
  console.log(`   SAR: ${escrowSAR.label} (${escrowSAR.id})`);
  console.log("");
  console.log("✅ Seeded policy rules:");
  console.log(
    "   KSA Buyer:  3 PO approval tiers + ESCROW_FUNDING (2 tiers), SETTLEMENT (2 tiers)",
  );
  console.log(
    "   UK Buyer 1: 3 PO approval tiers (auto ≤£10k, 1 approver ≤£50k, 2 approvers >£50k)",
  );
  console.log(
    "   UK Buyer 1: ESCROW_FUNDING (2 tiers), SETTLEMENT (2 tiers), DELIVERY_VERIFICATION (2 tiers)",
  );
  console.log(
    "   UK Supplier 1: SUPPLIER_ACCEPTANCE (2 tiers), EARLY_PAYMENT (2 tiers)",
  );
  console.log("   UK LP:      LP_FUNDING (3 tiers), FUNDING_LIMIT");
  console.log(
    "   KSA LP:     Funding limits (5M SAR total, 40% buyer, 30% supplier, 90d tenor, 250bps)",
  );
  console.log(
    "   UK LP:      Funding limits (£2M total, 40% buyer, 30% supplier, 90d tenor, 200bps)",
  );
  console.log(
    "   KSA Buyer:  PO order limits (min SAR 1,875 / max SAR 937,500)",
  );
  console.log("   UK Buyer 1: PO order limits (min £500 / max £250,000)");
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
