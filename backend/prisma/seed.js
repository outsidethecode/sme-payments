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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@prisma/client");
var bcrypt = __importStar(require("bcrypt"));
var prisma = new client_1.PrismaClient();
/** Helper: upsert a user, create their Organisation + OrgMembership (skip for ADMIN) */
function seedUserWithOrg(opts) {
    return __awaiter(this, void 0, void 0, function () {
        var user, org;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, prisma.user.upsert({
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
                    })];
                case 1:
                    user = _c.sent();
                    return [4 /*yield*/, prisma.organisation.upsert({
                            where: { id: user.id }, // will miss on first run → insert
                            update: {},
                            create: {
                                name: opts.companyName,
                                type: opts.orgType,
                                registrationNo: (_a = opts.companyNumber) !== null && _a !== void 0 ? _a : null,
                                jurisdiction: opts.jurisdiction,
                                currency: opts.currency,
                                shariaCompliant: (_b = opts.shariaCompliant) !== null && _b !== void 0 ? _b : false,
                            },
                        })];
                case 2:
                    org = _c.sent();
                    // Link user → org as OWNER (upsert via unique userId)
                    return [4 /*yield*/, prisma.orgMembership.upsert({
                            where: { userId: user.id },
                            update: {},
                            create: {
                                userId: user.id,
                                organisationId: org.id,
                                orgRole: client_1.OrgRole.OWNER,
                                isDefault: true,
                            },
                        })];
                case 3:
                    // Link user → org as OWNER (upsert via unique userId)
                    _c.sent();
                    return [2 /*return*/, { user: user, org: org }];
            }
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var password, _a, buyer1, orgBuyer1, _b, buyer2, orgBuyer2, _c, supplier1, orgSupplier1, _d, supplier2, orgSupplier2, _e, lp, orgLP, _f, ksaBuyer, orgKsaBuyer, _g, ksaSupplier, orgKsaSupplier, _h, ksaLP, orgKsaLP, admin;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    console.log("🌱 Seeding database...\n");
                    return [4 /*yield*/, bcrypt.hash("password123", 12)];
                case 1:
                    password = _j.sent();
                    return [4 /*yield*/, seedUserWithOrg({
                            email: "buyer@acme.co.uk",
                            password: password,
                            name: "James Thornton",
                            role: client_1.UserRole.BUYER,
                            companyName: "Acme Retail Ltd",
                            companyNumber: "08123456",
                            balance: 50000000, // £500,000
                            orgType: client_1.OrgType.BUYER,
                            jurisdiction: client_1.Jurisdiction.UK,
                            currency: client_1.Currency.GBP,
                        })];
                case 2:
                    _a = _j.sent(), buyer1 = _a.user, orgBuyer1 = _a.org;
                    return [4 /*yield*/, seedUserWithOrg({
                            email: "buyer@greenfield.co.uk",
                            password: password,
                            name: "Sarah Mitchell",
                            role: client_1.UserRole.BUYER,
                            companyName: "Greenfield Manufacturing Ltd",
                            companyNumber: "09234567",
                            balance: 75000000, // £750,000
                            orgType: client_1.OrgType.BUYER,
                            jurisdiction: client_1.Jurisdiction.UK,
                            currency: client_1.Currency.GBP,
                        })];
                case 3:
                    _b = _j.sent(), buyer2 = _b.user, orgBuyer2 = _b.org;
                    return [4 /*yield*/, seedUserWithOrg({
                            email: "supplier@swiftlogistics.co.uk",
                            password: password,
                            name: "David Okafor",
                            role: client_1.UserRole.SUPPLIER,
                            companyName: "Swift Logistics Ltd",
                            companyNumber: "10345678",
                            balance: 5000000, // £50,000
                            orgType: client_1.OrgType.SUPPLIER,
                            jurisdiction: client_1.Jurisdiction.UK,
                            currency: client_1.Currency.GBP,
                        })];
                case 4:
                    _c = _j.sent(), supplier1 = _c.user, orgSupplier1 = _c.org;
                    return [4 /*yield*/, seedUserWithOrg({
                            email: "supplier@brightworks.co.uk",
                            password: password,
                            name: "Fatima Hassan",
                            role: client_1.UserRole.SUPPLIER,
                            companyName: "Brightworks Engineering Ltd",
                            companyNumber: "11456789",
                            balance: 3500000, // £35,000
                            orgType: client_1.OrgType.SUPPLIER,
                            jurisdiction: client_1.Jurisdiction.UK,
                            currency: client_1.Currency.GBP,
                        })];
                case 5:
                    _d = _j.sent(), supplier2 = _d.user, orgSupplier2 = _d.org;
                    return [4 /*yield*/, seedUserWithOrg({
                            email: "lp@capitalbridge.co.uk",
                            password: password,
                            name: "Capital Bridge Fund",
                            role: client_1.UserRole.LIQUIDITY_PARTNER,
                            companyName: "Capital Bridge Finance Ltd",
                            companyNumber: "07012345",
                            balance: 200000000, // £2,000,000
                            orgType: client_1.OrgType.LIQUIDITY_PARTNER,
                            jurisdiction: client_1.Jurisdiction.UK,
                            currency: client_1.Currency.GBP,
                        })];
                case 6:
                    _e = _j.sent(), lp = _e.user, orgLP = _e.org;
                    return [4 /*yield*/, seedUserWithOrg({
                            email: "buyer@alrajhi.sa",
                            password: password,
                            name: "Ahmed Al-Rashid",
                            role: client_1.UserRole.BUYER,
                            companyName: "Al-Rajhi Trading Co",
                            companyNumber: "1010123456",
                            balance: 100000000, // 1,000,000 SAR
                            orgType: client_1.OrgType.BUYER,
                            jurisdiction: client_1.Jurisdiction.KSA,
                            currency: client_1.Currency.SAR,
                            shariaCompliant: true,
                        })];
                case 7:
                    _f = _j.sent(), ksaBuyer = _f.user, orgKsaBuyer = _f.org;
                    return [4 /*yield*/, seedUserWithOrg({
                            email: "supplier@noorsupply.sa",
                            password: password,
                            name: "Noor Al-Fahad",
                            role: client_1.UserRole.SUPPLIER,
                            companyName: "Noor Supply Chain",
                            companyNumber: "1010234567",
                            balance: 10000000, // 100,000 SAR
                            orgType: client_1.OrgType.SUPPLIER,
                            jurisdiction: client_1.Jurisdiction.KSA,
                            currency: client_1.Currency.SAR,
                            shariaCompliant: true,
                        })];
                case 8:
                    _g = _j.sent(), ksaSupplier = _g.user, orgKsaSupplier = _g.org;
                    return [4 /*yield*/, seedUserWithOrg({
                            email: "lp@tamweel.sa",
                            password: password,
                            name: "Tamweel Capital",
                            role: client_1.UserRole.LIQUIDITY_PARTNER,
                            companyName: "Tamweel Capital",
                            companyNumber: "1010345678",
                            balance: 500000000, // 5,000,000 SAR
                            orgType: client_1.OrgType.LIQUIDITY_PARTNER,
                            jurisdiction: client_1.Jurisdiction.KSA,
                            currency: client_1.Currency.SAR,
                            shariaCompliant: true,
                        })];
                case 9:
                    _h = _j.sent(), ksaLP = _h.user, orgKsaLP = _h.org;
                    return [4 /*yield*/, prisma.user.upsert({
                            where: { email: "admin@platform.co.uk" },
                            update: {},
                            create: {
                                email: "admin@platform.co.uk",
                                password: password,
                                name: "Platform Admin",
                                role: client_1.UserRole.ADMIN,
                                companyName: "Programmable SME Settlement",
                                balance: 0,
                            },
                        })];
                case 10:
                    admin = _j.sent();
                    // ── Summary ─────────────────────────────────────────────────
                    console.log("✅ Seeded UK users + organisations:");
                    console.log("   Buyer 1:    ".concat(buyer1.email, "  \u2192 ").concat(orgBuyer1.name, " (UK/GBP)"));
                    console.log("   Buyer 2:    ".concat(buyer2.email, "  \u2192 ").concat(orgBuyer2.name, " (UK/GBP)"));
                    console.log("   Supplier 1: ".concat(supplier1.email, "  \u2192 ").concat(orgSupplier1.name, " (UK/GBP)"));
                    console.log("   Supplier 2: ".concat(supplier2.email, "  \u2192 ").concat(orgSupplier2.name, " (UK/GBP)"));
                    console.log("   LP:         ".concat(lp.email, "  \u2192 ").concat(orgLP.name, " (UK/GBP)"));
                    console.log("");
                    console.log("✅ Seeded KSA users + organisations (Sharia-compliant):");
                    console.log("   Buyer:      ".concat(ksaBuyer.email, "  \u2192 ").concat(orgKsaBuyer.name, " (KSA/SAR)"));
                    console.log("   Supplier:   ".concat(ksaSupplier.email, "  \u2192 ").concat(orgKsaSupplier.name, " (KSA/SAR)"));
                    console.log("   LP:         ".concat(ksaLP.email, "  \u2192 ").concat(orgKsaLP.name, " (KSA/SAR)"));
                    console.log("");
                    console.log("\u2705 Admin:      ".concat(admin.email));
                    console.log("");
                    console.log("   All passwords: password123");
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .catch(function (e) {
    console.error("❌ Seed failed:", e);
    process.exit(1);
})
    .finally(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
