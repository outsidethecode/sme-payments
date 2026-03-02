# Phase 0 — Multi-Tenancy Foundation & Governance Model

**Status:** Ready to implement
**Decisions confirmed:** Single org per user, scalable for N suppliers + N LPs, KSA seed data with SAR, companyName/companyNumber deprecated on User (moved to Organisation), frontend tests deferred to Phase 2.

---

## 0.1 Test Infrastructure (prerequisite)

### Backend (Jest + Supertest)

**Install:**
```
npm i -D @nestjs/testing jest ts-jest @types/jest supertest @types/supertest
```

**Config:**
- `jest.config.ts` with `ts-jest` preset, `@shared/*` path mapping
- Scripts: `test`, `test:watch`, `test:cov`, `test:e2e`

**Convention:**
- `*.spec.ts` next to source files → unit tests
- `test/*.e2e-spec.ts` → integration/e2e tests

**Frontend:**
- Deferred to Phase 2 (onboarding UI)

---

## 0.2 New Database Models

### Organisation

```
id              UUID PK
name            String          "Acme Retail Ltd"
type            OrgType         BUYER | SUPPLIER | LIQUIDITY_PARTNER
registrationNo  String?         CR number / company number
jurisdiction    Jurisdiction    UK | KSA
currency        Currency        GBP | SAR
shariaCompliant Boolean         default false
status          OrgStatus       PENDING | ACTIVE | SUSPENDED
metadata        Json?           flexible config bag
createdAt       DateTime
updatedAt       DateTime
```

### OrgMembership

```
id              UUID PK
userId          UUID FK → User
organisationId  UUID FK → Organisation
orgRole         OrgRole         OWNER | APPROVER | FINANCE | MEMBER
isDefault       Boolean         true (for v1, always true — single org)
joinedAt        DateTime
```

### Constraints

- Unique on `(userId)` — enforces single org per user in v1
- Unique on `(userId, organisationId)` — no duplicate memberships

### Updated User

- Keep `role` (UserRole) — derived from org type at registration, or set explicitly for ADMIN
- `companyName` and `companyNumber` → marked optional (deprecated), moved to Organisation
- Add relation to OrgMembership

### New Enums

| Enum | Values |
|------|--------|
| `OrgType` | `BUYER`, `SUPPLIER`, `LIQUIDITY_PARTNER` |
| `OrgRole` | `OWNER`, `APPROVER`, `FINANCE`, `MEMBER` |
| `Jurisdiction` | `UK`, `KSA` |
| `Currency` | `GBP`, `SAR` |
| `OrgStatus` | `PENDING`, `ACTIVE`, `SUSPENDED` |

---

## 0.3 Backend Changes

### New module: `organisations/`

**OrganisationsService:**
- CRUD for orgs
- Add/remove members
- Get org by user
- Enforce single-org constraint

**OrganisationsController:**

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| `POST` | `/organisations` | JWT | Create org (during registration or standalone) |
| `GET` | `/organisations/me` | JWT | Get current user's org |
| `GET` | `/organisations/:id` | JWT | Get org detail (admin or own org) |
| `GET` | `/organisations` | JWT + ADMIN | List all orgs |
| `PATCH` | `/organisations/:id` | JWT | Update org settings (owner/admin) |
| `POST` | `/organisations/:id/members` | JWT | Invite/add member |
| `GET` | `/organisations/:id/members` | JWT | List members |

### Updated AuthService

- `register()` now creates Organisation + OrgMembership (OWNER) alongside User
- Registration accepts: `jurisdiction`, `registrationNo`, `currency` (defaults based on jurisdiction)
- New endpoint: `POST /auth/register-lp` — requires platform admin invite token
- JWT payload adds: `organisationId`, `orgRole`

### Updated JwtStrategy

- `req.user` now includes: `organisationId`, `orgRole`, `jurisdiction`, `currency`

### Updated services (backwards compatible)

| Service | Change |
|---------|--------|
| `PurchaseOrdersService` | POs scoped to buyer's org. Supplier lookup validates they're in a SUPPLIER org. |
| `EarlyPaymentsService` | No flow change. LP filtering becomes org-aware. |
| `PaymentLocksService` | No change — already filtered by PO ownership. |
| `LedgerService` | Events include `organisationId` in payload. |
| `AdminService` | Stats can be filtered by jurisdiction. |
| `UsersService` | User lookup becomes org-aware. |

**Key principle:** All existing endpoints keep working. Org context is additive, not breaking.

---

## 0.4 Frontend Changes (minimal)

- Registration form: add jurisdiction selector (UK/KSA), company registration number
- Dashboard header: show org name instead of company name
- Admin page: org list view
- `auth-context.tsx`: store org info from JWT/me endpoint
- All existing pages continue working — org context is transparent

---

## 0.5 Seed Data

### Organisations

| Name | Type | Jurisdiction | Currency | Sharia |
|------|------|-------------|----------|--------|
| Acme Retail Ltd | BUYER | UK | GBP | No |
| Greenfield Manufacturing Ltd | BUYER | UK | GBP | No |
| Swift Logistics Ltd | SUPPLIER | UK | GBP | No |
| Brightworks Engineering Ltd | SUPPLIER | UK | GBP | No |
| Capital Bridge Finance Ltd | LIQUIDITY_PARTNER | UK | GBP | No |
| Programmable SME Settlement | (Platform) | UK | GBP | No |
| Al-Rajhi Trading Co | BUYER | KSA | SAR | Yes |
| Noor Supply Chain | SUPPLIER | KSA | SAR | Yes |
| Tamweel Capital | LIQUIDITY_PARTNER | KSA | SAR | Yes |

### KSA Users (new)

| Email | Role | Company | Balance |
|-------|------|---------|---------|
| `buyer@alrajhi.sa` | BUYER | Al-Rajhi Trading Co | 1,000,000 SAR |
| `supplier@noorsupply.sa` | SUPPLIER | Noor Supply Chain | 100,000 SAR |
| `lp@tamweel.sa` | LIQUIDITY_PARTNER | Tamweel Capital | 5,000,000 SAR |

Each user linked to their org via OrgMembership with OWNER role.

---

## 0.6 Tests

### Unit Tests

| File | What it tests |
|------|--------------|
| `organisations.service.spec.ts` | Create org, add member, enforce single-org constraint, get org by user, update org |
| `auth.service.spec.ts` | Register creates org + membership, login returns org context, LP registration with invite token |
| `purchase-orders.service.spec.ts` | PO creation validates org type, org-scoped listing |

### Integration Tests (e2e)

| File | What it tests |
|------|--------------|
| `organisations.e2e-spec.ts` | Full CRUD lifecycle via HTTP, member management |
| `auth.e2e-spec.ts` | Register → login → me returns org info, role protection |

---

## Implementation Order

1. Install test dependencies + create jest config
2. Prisma schema migration (new models + enums + updated User)
3. `OrganisationsModule` (service + controller + unit tests)
4. Update `AuthModule` (register flow + JWT payload + unit tests)
5. Update existing services for org-awareness
6. Update seed data (UK + KSA orgs)
7. Frontend updates (registration form, dashboard, auth context)
8. Integration tests (e2e specs)
