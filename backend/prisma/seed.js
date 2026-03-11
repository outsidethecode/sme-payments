"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcrypt"));
const prisma = new client_1.PrismaClient();
/** Helper: upsert a user, create their Organisation + OrgMembership (skip for ADMIN) */
async function seedUserWithOrg(opts) {
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
    }
    else {
        // Create new org + membership on first run
        org = await prisma.organisation.create({
            data: {
                name: opts.companyName,
                type: opts.orgType,
                registrationNo: opts.companyNumber ?? null,
                jurisdiction: opts.jurisdiction,
                currency: opts.currency,
                shariaCompliant: opts.shariaCompliant ?? false,
                onboardingStatus: client_1.OnboardingStatus.COMPLETED,
                termsAcceptedAt: new Date(),
                bankIban: opts.jurisdiction === client_1.Jurisdiction.KSA
                    ? `SA03800000006080${Math.random().toString().slice(2, 12)}`
                    : `GB29NWBK601613${Math.random().toString().slice(2, 10)}`,
                supplierTier: opts.supplierTier ??
                    (opts.orgType === client_1.OrgType.SUPPLIER ? client_1.SupplierTier.BASIC : null),
            },
        });
        await prisma.orgMembership.create({
            data: {
                userId: user.id,
                organisationId: org.id,
                orgRole: client_1.OrgRole.OWNER,
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
        role: client_1.UserRole.BUYER,
        companyName: "Acme Retail Ltd",
        companyNumber: "08123456",
        balance: 50000000, // £500,000
        orgType: client_1.OrgType.BUYER,
        jurisdiction: client_1.Jurisdiction.UK,
        currency: client_1.Currency.GBP,
    });
    const { user: buyer2, org: orgBuyer2 } = await seedUserWithOrg({
        email: "buyer@greenfield.co.uk",
        password,
        name: "Sarah Mitchell",
        role: client_1.UserRole.BUYER,
        companyName: "Greenfield Manufacturing Ltd",
        companyNumber: "09234567",
        balance: 75000000, // £750,000
        orgType: client_1.OrgType.BUYER,
        jurisdiction: client_1.Jurisdiction.UK,
        currency: client_1.Currency.GBP,
    });
    // ── UK Suppliers ────────────────────────────────────────────
    const { user: supplier1, org: orgSupplier1 } = await seedUserWithOrg({
        email: "supplier@swiftlogistics.co.uk",
        password,
        name: "David Okafor",
        role: client_1.UserRole.SUPPLIER,
        companyName: "Swift Logistics Ltd",
        companyNumber: "10345678",
        balance: 5000000, // £50,000
        orgType: client_1.OrgType.SUPPLIER,
        jurisdiction: client_1.Jurisdiction.UK,
        currency: client_1.Currency.GBP,
    });
    const { user: supplier2, org: orgSupplier2 } = await seedUserWithOrg({
        email: "supplier@brightworks.co.uk",
        password,
        name: "Fatima Hassan",
        role: client_1.UserRole.SUPPLIER,
        companyName: "Brightworks Engineering Ltd",
        companyNumber: "11456789",
        balance: 3500000, // £35,000
        orgType: client_1.OrgType.SUPPLIER,
        jurisdiction: client_1.Jurisdiction.UK,
        currency: client_1.Currency.GBP,
    });
    // ── UK Liquidity Partner ────────────────────────────────────
    const { user: lp, org: orgLP } = await seedUserWithOrg({
        email: "lp@capitalbridge.co.uk",
        password,
        name: "Capital Bridge Fund",
        role: client_1.UserRole.LIQUIDITY_PARTNER,
        companyName: "Capital Bridge Finance Ltd",
        companyNumber: "07012345",
        balance: 200000000, // £2,000,000
        orgType: client_1.OrgType.LIQUIDITY_PARTNER,
        jurisdiction: client_1.Jurisdiction.UK,
        currency: client_1.Currency.GBP,
    });
    // ══════════════════════════════════════════════════════════════
    // KSA USERS + ORGS (Sharia-compliant pilot)
    // ══════════════════════════════════════════════════════════════
    // ── KSA Buyer ───────────────────────────────────────────────
    const { user: ksaBuyer, org: orgKsaBuyer } = await seedUserWithOrg({
        email: "buyer@alrajhi.sa",
        password,
        name: "Ahmed Al-Rashid",
        role: client_1.UserRole.BUYER,
        companyName: "Al-Rajhi Trading Co",
        companyNumber: "1010123456",
        balance: 100000000, // 1,000,000 SAR
        orgType: client_1.OrgType.BUYER,
        jurisdiction: client_1.Jurisdiction.KSA,
        currency: client_1.Currency.SAR,
        shariaCompliant: true,
    });
    // ── KSA Supplier ────────────────────────────────────────────
    const { user: ksaSupplier, org: orgKsaSupplier } = await seedUserWithOrg({
        email: "supplier@noorsupply.sa",
        password,
        name: "Noor Al-Fahad",
        role: client_1.UserRole.SUPPLIER,
        companyName: "Noor Supply Chain",
        companyNumber: "1010234567",
        balance: 10000000, // 100,000 SAR
        orgType: client_1.OrgType.SUPPLIER,
        jurisdiction: client_1.Jurisdiction.KSA,
        currency: client_1.Currency.SAR,
        shariaCompliant: true,
    });
    // ── KSA Liquidity Partner ──────────────────────────────────
    const { user: ksaLP, org: orgKsaLP } = await seedUserWithOrg({
        email: "lp@tamweel.sa",
        password,
        name: "Tamweel Capital",
        role: client_1.UserRole.LIQUIDITY_PARTNER,
        companyName: "Tamweel Capital",
        companyNumber: "1010345678",
        balance: 500000000, // 5,000,000 SAR
        orgType: client_1.OrgType.LIQUIDITY_PARTNER,
        jurisdiction: client_1.Jurisdiction.KSA,
        currency: client_1.Currency.SAR,
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
            role: client_1.UserRole.ADMIN,
            companyName: "Programmable SME Settlement",
            balance: 0,
        },
    });
    // ══════════════════════════════════════════════════════════════
    // POLICY RULES
    // ══════════════════════════════════════════════════════════════
    // Helper to upsert policy rules (idempotent by name+orgId)
    async function seedPolicy(orgId, data) {
        // Try to find existing by name for this org
        const existing = await prisma.policyRule.findFirst({
            where: { organisationId: orgId, name: data.name },
        });
        if (existing)
            return existing;
        return prisma.policyRule.create({
            data: {
                organisationId: orgId,
                ruleType: data.ruleType,
                name: data.name,
                conditions: data.conditions,
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
        conditions: { minAmount: 0, maxAmount: 5000000 },
        requiredApprovals: 0,
        requiredRoles: [],
        autoApprove: true,
        priority: 10,
    });
    await seedPolicy(orgKsaBuyer.id, {
        ruleType: "PO_APPROVAL",
        name: "1 approver for POs 50k–200k SAR",
        conditions: { minAmount: 5000001, maxAmount: 20000000 },
        requiredApprovals: 1,
        requiredRoles: ["APPROVER"],
        autoApprove: false,
        priority: 5,
    });
    await seedPolicy(orgKsaBuyer.id, {
        ruleType: "PO_APPROVAL",
        name: "2 approvers for POs > 200k SAR",
        conditions: { minAmount: 20000001, maxAmount: 99999999999 },
        requiredApprovals: 2,
        requiredRoles: ["APPROVER", "FINANCE"],
        autoApprove: false,
        priority: 1,
    });
    // ── UK Buyer PO Approval Tiers ─────────────────────────────
    await seedPolicy(orgBuyer1.id, {
        ruleType: "PO_APPROVAL",
        name: "Auto-approve POs ≤ £10,000",
        conditions: { minAmount: 0, maxAmount: 1000000 },
        requiredApprovals: 0,
        requiredRoles: [],
        autoApprove: true,
        priority: 10,
    });
    await seedPolicy(orgBuyer1.id, {
        ruleType: "PO_APPROVAL",
        name: "1 approver for POs £10k–£50k",
        conditions: { minAmount: 1000001, maxAmount: 5000000 },
        requiredApprovals: 1,
        requiredRoles: ["APPROVER"],
        autoApprove: false,
        priority: 5,
    });
    await seedPolicy(orgBuyer1.id, {
        ruleType: "PO_APPROVAL",
        name: "2 approvers for POs > £50k",
        conditions: { minAmount: 5000001, maxAmount: 99999999999 },
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
            maxExposureTotal: 500000000, // 5M SAR
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
            maxExposureTotal: 200000000, // £2M
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
    console.log(`   Supplier 1: ${supplier1.email}  → ${orgSupplier1.name} (UK/GBP)`);
    console.log(`   Supplier 2: ${supplier2.email}  → ${orgSupplier2.name} (UK/GBP)`);
    console.log(`   LP:         ${lp.email}  → ${orgLP.name} (UK/GBP)`);
    console.log("");
    console.log("✅ Seeded KSA users + organisations (Sharia-compliant):");
    console.log(`   Buyer:      ${ksaBuyer.email}  → ${orgKsaBuyer.name} (KSA/SAR)`);
    console.log(`   Supplier:   ${ksaSupplier.email}  → ${orgKsaSupplier.name} (KSA/SAR)`);
    console.log(`   LP:         ${ksaLP.email}  → ${orgKsaLP.name} (KSA/SAR)`);
    console.log("");
    console.log(`✅ Admin:      ${admin.email}`);
    console.log("");
    console.log("✅ Seeded policy rules:");
    console.log("   KSA Buyer:  3 PO approval tiers (auto ≤50k, 1 approver ≤200k, 2 approvers >200k SAR)");
    console.log("   UK Buyer 1: 3 PO approval tiers (auto ≤£10k, 1 approver ≤£50k, 2 approvers >£50k)");
    console.log("   KSA LP:     Funding limits (5M SAR total, 40% buyer, 30% supplier, 90d tenor, 250bps)");
    console.log("   UK LP:      Funding limits (£2M total, 40% buyer, 30% supplier, 90d tenor, 200bps)");
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
