# TechpioAsset — Design & Implementation Plan

> _Manage Assets. Control Costs. Simplify Operations._

Derived from `TechpioAsset Design and Development Plan.pdf` (41 pp). This document covers the five
items the spec requires before implementation begins: architecture, folder structure, database
model, role-and-permission matrix, and phased implementation plan.

---

## 0. Decisions made (spec gaps filled)

The spec says to make reasonable decisions rather than ask. These are the non-obvious ones:

| #   | Decision                                                                                                                             | Rationale                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **pnpm workspaces + Turborepo** monorepo                                                                                             | Spec asks for a monorepo; Turbo gives cached task graphs across api/web/mobile without Nx ceremony.                                                                                 |
| D2  | **Company-scoped multi-tenancy from day one** (`companyId` on every tenant-owned row, enforced in a Prisma extension, not per-query) | The spec's data model includes `Company`, and "transfers between legal entities" implies >1 entity. Retrofitting tenancy later is the single most expensive mistake available here. |
| D3  | **Permissions are the atom; roles are bags of permissions**                                                                          | Spec says "configurable roles and granular permissions". Guards check `assets:assign`, never `role === 'IT'`.                                                                       |
| D4  | **Access tokens 15 min in memory + refresh token rotation in httpOnly, SameSite=Lax cookie** (web); SecureStore (mobile)             | Meets refresh rotation + secure logout + session expiry without localStorage token theft.                                                                                           |
| D5  | **Money as `Decimal(14,2)` + explicit `currency`; never float**                                                                      | All deterministic invoice math must be exact. Computed in `decimal.js` on the API.                                                                                                  |
| D6  | **Storage/AI/email/push behind provider interfaces with local mock implementations**                                                 | Section 28. Mocks return `simulated: true` and are surfaced in the UI — never silently faked.                                                                                       |
| D7  | **State machines for asset status, request status, invoice verification status** — transitions are data, not `if` chains             | 17 asset statuses × 16 request statuses × 15 verification statuses is unmaintainable otherwise, and it makes the transition unit tests trivial.                                     |
| D8  | **QR encodes an opaque ULID → authenticated deep link**, never asset data                                                            | Spec: do not expose sensitive info via public QR URL.                                                                                                                               |
| D9  | **Audit log written by a Prisma middleware/extension on a whitelist of models**, append-only table, no API update/delete route       | Spec: audit records not editable through the app.                                                                                                                                   |
| D10 | **Soft delete via `deletedAt` + global Prisma filter**; financial/audit/assignment rows have no delete path at all                   | Section 22.                                                                                                                                                                         |
| D11 | Build root: **`E:\TechpioAsset\`**                                                                                                   | Where the plan lives. Confirm if you want it elsewhere.                                                                                                                             |
| D12 | Mobile app scaffolded in Phase 1 (auth + shell only), features land in Phase 4                                                       | Keeps the shared API contract honest from the start without stalling web delivery.                                                                                                  |

---

## 1. Architecture

```
┌────────────────┐     ┌────────────────┐
│  Next.js web   │     │ Expo mobile    │
│  (App Router)  │     │ (RN, iOS/And.) │
└───────┬────────┘     └───────┬────────┘
        │  REST + JSON, Bearer access token
        └──────────────┬───────────────┘
                       ▼
             ┌────────────────────┐
             │   NestJS API       │  Swagger/OpenAPI
             │  guards: JWT →     │  Zod/class-validator DTOs
             │  Tenant → Perms    │  problem+json errors, requestId
             └──┬──────┬──────┬───┘
                │      │      │
    ┌───────────┘      │      └────────────┐
    ▼                  ▼                   ▼
┌─────────┐   ┌──────────────┐   ┌──────────────────┐
│Postgres │   │ Redis        │   │ Object storage   │
│ Prisma  │   │ cache,       │   │ Azurite/MinIO dev│
│         │   │ BullMQ jobs, │   │ Blob/S3 prod     │
│         │   │ rate limit   │   │ private + signed │
└─────────┘   └──────┬───────┘   └──────────────────┘
                     ▼
        ┌────────────────────────────┐
        │ Workers (same image)       │
        │ invoice-extract, notify,   │
        │ report-export, scheduled   │
        └────────────┬───────────────┘
                     ▼
        ┌────────────────────────────┐
        │ Provider interfaces        │
        │ AiDocumentProvider ────────┼─→ Azure Doc Intelligence │ Mock
        │ StorageProvider ───────────┼─→ Azure Blob │ S3 │ Local
        │ MailProvider ──────────────┼─→ SMTP │ Mock (writes .eml)
        │ PushProvider ──────────────┼─→ Expo Push │ Mock
        └────────────────────────────┘
```

**Layering rule inside the API:** `controller → service → repository (Prisma)`. Controllers hold no
business logic; services never see `req`. Deterministic invoice verification lives in a pure
`packages/domain` module with zero I/O so it can be unit-tested exhaustively.

**Request pipeline:** `helmet → cors → requestId → rate-limit → JwtAuthGuard → TenantGuard →
PermissionsGuard → ZodValidationPipe → controller → AuditInterceptor → ProblemDetailsFilter`.

**Stack**

| Layer  | Choice                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web    | Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, Lucide, React Hook Form + Zod, TanStack Query, Recharts, next-themes                                  |
| Mobile | Expo SDK 52, RN, TypeScript, expo-camera, expo-secure-store, expo-notifications, WatermelonDB (offline queue)                                                   |
| API    | NestJS 11, Prisma 6, PostgreSQL 16, Redis 7, BullMQ, Passport JWT, Swagger                                                                                      |
| Shared | `packages/domain` (pure rules), `packages/contracts` (Zod schemas → shared TS types), `packages/ui-tokens`                                                      |
| Test   | Vitest (unit), Jest + Supertest + Testcontainers (API integration), Testing Library (component), Playwright (e2e), Maestro (mobile), axe-core (a11y), k6 (perf) |
| Dev    | Docker Compose: postgres, redis, azurite, mailpit                                                                                                               |

---

## 2. Folder structure

```
TechpioAsset/
├─ apps/
│  ├─ api/                       # NestJS
│  │  ├─ prisma/{schema.prisma,migrations/,seed/}
│  │  └─ src/
│  │     ├─ common/              # guards, interceptors, filters, decorators, pipes
│  │     ├─ modules/
│  │     │  ├─ auth/ users/ profiles/ roles/ permissions/
│  │     │  ├─ companies/ offices/ departments/ locations/
│  │     │  ├─ categories/ assets/ inventory/
│  │     │  ├─ assignments/ returns/ transfers/ maintenance/ warranty/
│  │     │  ├─ vendors/ purchase-orders/ invoices/
│  │     │  ├─ invoice-extraction/ invoice-verification/
│  │     │  ├─ requests/ approvals/ workflows/ onboarding/
│  │     │  ├─ notifications/ reports/ audit/ ai-config/ qr/
│  │     │  ├─ physical-inventory/ mobile-sync/
│  │     │  └─ health/
│  │     ├─ providers/{storage,ai,mail,push}/  # interface + azure|s3|local|mock
│  │     ├─ jobs/                # BullMQ processors
│  │     └─ main.ts
│  ├─ web/                       # Next.js
│  │  └─ src/
│  │     ├─ app/(auth)/          # login, forgot, verify, mfa
│  │     ├─ app/(app)/           # dashboard, assets, inventory, requests,
│  │     │                       # invoices, invoices/[id]/review, maintenance,
│  │     │                       # employees, onboarding, reports, audit,
│  │     │                       # settings/{ai,roles,categories,workflows},
│  │     │                       # profile, my-assets, my-requests
│  │     ├─ components/{ui,assets,invoices,requests,charts,layout}
│  │     ├─ lib/{api-client,auth,permissions,format}
│  │     └─ hooks/
│  └─ mobile/                    # Expo
│     └─ src/{screens,components,offline,api,storage}
├─ packages/
│  ├─ contracts/                 # Zod schemas + inferred DTO types (API ↔ web ↔ mobile)
│  ├─ domain/                    # pure: invoice math, matching, state machines, depreciation
│  ├─ ui-tokens/                 # status colors/icons, shared Tailwind preset
│  └─ config/                    # eslint, tsconfig, prettier bases
├─ e2e/                          # Playwright specs + fixtures
├─ docs/                         # architecture, rbac-matrix, ai-config, security, api, runbook
├─ docker-compose.yml
├─ turbo.json  pnpm-workspace.yaml  .env.example  README.md
```

---

## 3. Database model

All 44 spec-required models. Every tenant-owned table carries `companyId`, `createdAt`, `updatedAt`,
`createdById`, `updatedById`; soft-deletable tables add `deletedAt`; contended rows add `version` (int,
optimistic lock).

**Identity & access**

- `User` — email (unique per company), passwordHash (argon2id), emailVerifiedAt, mfaSecret, mfaEnabledAt, status, failedLoginCount, lockedUntil
- `UserProfile` — firstName, lastName, avatarKey, phone, jobTitle, departmentId, managerId, employeeNumber, hireDate, terminationDate
- `Role` (isSystem), `Permission` (`resource:action`), `RolePermission`, `UserRole`
- `RefreshToken` — hashed token, family, rotatedAt, revokedAt, ip, userAgent _(added; rotation needs it)_

**Org**

- `Company` → `Office` → `Building` → `Floor` → `Room`; `Department` (self-nesting, managerId)

**Catalog**

- `Category` (icon, sortOrder, isActive, trackingType default) → `Subcategory`

**Assets**

- `Asset` — assetTag (unique/company), name, categoryId, subcategoryId, brand, model, **serialNumber (unique/company, partial index where not null)**, mpn, barcode, qrToken (ULID, unique), purchaseDate, purchaseCost, currency, currentValue, depreciationMethod, usefulLifeMonths, salvageValue, vendorId, invoiceLineId, poNumber, warrantyStart/End, expectedReplacementDate, officeId/buildingId/floorId/roomId, departmentId, assignedUserId, assignmentDate, condition, status, notes, duplicateExceptionReason
- `InventoryItem` — quantity-tracked twin: sku, unit, quantityOnHand, minStock, reorderLevel, unitCost, avgCost, lastPurchaseDate, storageLocationId
- `InventoryTransaction` — signed qty movements, reason, ref _(added; running balances need an audit trail)_
- `AssetAssignment` — assetId, userId, assignedById, assignedAt, expectedReturnAt, conditionOut, acknowledgedAt, acknowledgementSignature, returnedAt
- `AssetReturn` — assignmentId, returnedAt, receivedById, conditionIn, missingAccessories, damageNotes, resultingStatus, photos
- `AssetTransfer` — from/to user, from/to location, from/to department, from/to company, reason, approvedById, transferredAt
- `AssetConditionLog`, `MaintenanceRecord` (type, vendorId, scheduledAt, completedAt, cost, downtimeHours, warrantyClaimId, recommendation), `Warranty`, `DisposalRecord` (method, proceeds, approvedById, reason)

**Procurement & invoices**

- `Vendor`, `PurchaseOrder`, `PurchaseOrderLine`
- `Invoice` — vendorId, invoiceNumber (unique/company), invoiceDate, currency, subtotal, discount, tax, shipping, otherCharges, total, paymentStatus, paymentMethod, poNumber, verificationStatus, reviewerId, reviewedAt, reviewNotes
- `InvoiceLine` — description, normalizedDescription, quantity, unitPrice, lineTotal, serialNumbers[], warrantyMonths, suggestedCategoryId
- `InvoiceDocument` — storageKey, mimeType, sizeBytes, **sha256 (unique/company → duplicate-file detection)**, pageCount, uploadedById, scanStatus
- `InvoiceExtraction` — provider, model, rawPayload (Json), fieldConfidences (Json), status, startedAt, completedAt, durationMs, costUsd, errorDetail
- `InvoiceVerification` — checkResults (Json), issues (Json), decision, decidedById, decidedAt, notes
- `AssetInvoiceLink` — asset ↔ invoiceLine, matchConfidence, matchMethod (auto|manual), qtyDelta, costDelta

**Requests & workflow**

- `AssetRequest` — requestNumber, type, priority, status, requesterId, onBehalfOfId, managerId, officeId, departmentId, businessReason, requiredBy, replacesAssetId, estimatedCost
- `RequestItem` — categoryId, subcategoryId, description, quantity, preferredSpec, estimatedCost, fulfilledAssetId
- `RequestApproval` — step, approverRoleId/approverId, decision, decidedAt, comment, slaDueAt
- `RequestComment`
- `WorkflowDefinition` / `WorkflowStep` — configurable approver chain + cost thresholds + bypass rules _(added; "Super Admins configure workflow steps" requires storage)_
- `OnboardingTemplate` / `OnboardingTemplateItem`, `OnboardingTask` _(added; "configurable onboarding template")_

**Platform**

- `Notification`, `NotificationPreference`, `Attachment` (polymorphic: entityType+entityId, storageKey, sha256)
- `AIConfiguration` (global + per-office/role overrides, feature→mode map, confidenceThreshold, monthlyBudget, monthlyLimit, alertThreshold, retentionDays, pausedAt)
- `AIUsageRecord`, `AuditLog` (append-only: actorId, action, entityType, entityId, before Json, after Json, ip, userAgent, reason, correlationId)
- `PhysicalInventorySession`, `PhysicalInventoryScan` (offline-synced, clientGeneratedId unique → idempotent replay)
- `SavedFilter`, `ScheduledReport` _(added; §18 requires both)_

**Key constraints/indexes:** unique `(companyId, assetTag)`, `(companyId, serialNumber) WHERE serialNumber IS NOT NULL`, `(companyId, invoiceNumber)`, `(companyId, sha256)`, `qrToken`; composite indexes on `(companyId, status)`, `(companyId, categoryId)`, `(companyId, assignedUserId)`, `(companyId, warrantyEndDate)`, `AuditLog(companyId, entityType, entityId, createdAt)`; GIN trigram index for global search.

---

## 4. Role & permission matrix

Permissions are `resource:action`. `own` scope = restricted to the actor's own records; `reports` =
restricted to direct reports; `dept` = own department.

| Permission                                                      | Super Admin |    IT Admin    |                  HR                  |   Office Admin    |   Finance    |     Manager      |   Employee   | Auditor |
| --------------------------------------------------------------- | :---------: | :------------: | :----------------------------------: | :---------------: | :----------: | :--------------: | :----------: | :-----: |
| `assets:read`                                                   |     all     |      all       |        assigned-to-employees         |        all        |     all      |       dept       |   **own**    |   all   |
| `assets:create` / `:update`                                     |     ✅      | IT categories  |                  —                   | non-IT categories |      —       |        —         |      —       |    —    |
| `assets:assign` / `:return`                                     |     ✅      |       IT       |             _if granted_             |      non-IT       |      —       |        —         |      —       |    —    |
| `assets:transfer`                                               |     ✅      |       IT       |                  —                   |      non-IT       |      —       |        —         |      —       |    —    |
| `assets:dispose` (approve)                                      |     ✅      |  request only  |                  —                   |   request only    |      —       |        —         |      —       |    —    |
| `assets:cost:read`                                              |     ✅      |       ✅       | ❌ _(unless `finance:view` granted)_ |        ✅         |      ✅      | dept, if granted |      —       |   ✅    |
| `inventory:read` / `:adjust`                                    |     ✅      | IT consumables |                 read                 |        ✅         |     read     |        —         |      —       |  read   |
| `invoices:read`                                                 |     ✅      |  IT invoices   |                  ❌                  |    own uploads    |      ✅      |        —         |      —       |   ✅    |
| `invoices:upload`                                               |     ✅      |       ✅       |                  —                   |        ✅         |      ✅      |        —         |      —       |    —    |
| `invoices:verify`                                               |     ✅      |       —        |                  —                   |         —         |      ✅      |        —         |      —       |    —    |
| `invoices:correct-extraction`                                   |     ✅      |       ✅       |                  —                   |        ✅         |      ✅      |        —         |      —       |    —    |
| `requests:create`                                               |     ✅      |       ✅       |            ✅ + on behalf            |        ✅         |      ✅      |        ✅        |      ✅      |    —    |
| `requests:read`                                                 |     all     |   IT-related   |                 all                  |  office-related   |  cost-gated  |   **reports**    |   **own**    |   all   |
| `requests:approve`                                              |     ✅      |    IT step     |               HR step                |    Office step    | Finance step |   Manager step   |      —       |    —    |
| `employees:create` / `:import`                                  |     ✅      |       —        |                  ✅                  |         —         |      —       |        —         |      —       |    —    |
| `onboarding:*` / `offboarding:*`                                |     ✅      |     fulfil     |             ✅ initiate              |      fulfil       |      —       |        —         |      —       |  read   |
| `maintenance:create` / `:update`                                |     ✅      |       ✅       |                  —                   |        ✅         |      —       |        —         | request only |  read   |
| `vendors:*` / `purchase-orders:*`                               |     ✅      |      read      |                  —                   |       read        |      ✅      |        —         |      —       |  read   |
| `reports:read`                                                  |     ✅      |       IT       |             HR, no cost              |      office       |  financial   |       dept       |      —       |   ✅    |
| `reports:export`                                                |     ✅      |       ✅       |                  ✅                  |        ✅         |      ✅      |        —         |      —       |   ✅    |
| `users:manage` / `roles:manage` / `permissions:manage`          |     ✅      |       —        |                  —                   |         —         |      —       |        —         |      —       |    —    |
| `ai:configure`                                                  |     ✅      |       —        |                  —                   |         —         |      —       |        —         |      —       |    —    |
| `ai:review-results`                                             |     ✅      |       ✅       |                  —                   |        ✅         |      ✅      |        —         |      —       |  read   |
| `workflows:configure` / `categories:manage` / `settings:manage` |     ✅      |       —        |                  —                   |         —         |      —       |        —         |      —       |    —    |
| `audit:read`                                                    |     ✅      |   own module   |                  —                   |    own module     |  financial   |        —         |      —       |   ✅    |
| `qr:generate` / `:print`                                        |     ✅      |       ✅       |                  —                   |        ✅         |      —       |        —         |      —       |    —    |

**Auditor** holds only `*:read` — enforced by a hard deny-list on the role, not merely by omission.
**Employee isolation** is enforced in the repository layer (`assignedUserId = actor.id`), so it holds
for every endpoint including reports and exports, not just the UI.

---

## 5. Implementation plan

Each phase ends with: format → lint → typecheck → unit → integration → e2e → a11y → audit-log
verification, and an honest written report. **No phase starts before the previous one is verified.**

| Phase                         | Scope                                                                                                                                                                                                                                                               | Exit criteria                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Foundation**            | Monorepo, Docker Compose, Prisma schema + first migration, CI task graph, design tokens, error/response envelope, seed harness                                                                                                                                      | `docker compose up` + `pnpm db:migrate` + `pnpm seed` works from clean clone; health endpoint green                                         |
| **1 — Core**                  | Auth (login, reset, verify, MFA, refresh rotation, logout), users/profiles/avatars, roles & permissions, companies/offices/departments/rooms, categories, assets CRUD, inventory, assignment & return, role dashboards, app shell + profile menu, mobile auth shell | All 8 seeded roles log in; permission matrix verified by integration tests; employee cannot read another's asset (403)                      |
| **2 — Requests**              | Request module + dynamic configurable workflows, approvals, onboarding/offboarding with completion gate, notifications (in-app, email, prefs)                                                                                                                       | Laptop request traverses Employee→Manager→HR→IT→Finance→assigned→receipt-confirmed in e2e; offboarding blocked while an asset is unresolved |
| **3 — Invoices & AI**         | Upload + storage + hashing, invoice/PO records, asset↔line links, AI provider abstraction, Azure Doc Intelligence, **deterministic verification engine**, split-screen review UI, AI config page + audit                                                            | Quantity/cost/duplicate/missing-asset mismatches all detected by unit tests; AI-off proves zero outbound provider calls (spy assertion)     |
| **4 — Mobile**                | Expo app: assets, requests, QR/barcode scan, camera invoice capture, offline scan queue + conflict-safe sync, push                                                                                                                                                  | Offline scans queue and reconcile idempotently; QR opens the authorized record and 403s for unauthorized users                              |
| **5 — Lifecycle & reporting** | Maintenance, warranty alerts (30/60/90), depreciation, advanced reports, saved filters, scheduled exports, Teams/Slack hooks                                                                                                                                        | Depreciation + warranty math unit-tested; scheduled export delivers                                                                         |
| **6 — Hardening**             | Security test suite (IDOR, file validation, rate limits, log redaction), WCAG 2.1 AA pass, k6 performance, dependency audit, docs & final verification report                                                                                                       | §27 checklist all green; §31 acceptance criteria each mapped to a passing test                                                              |

**Testing posture throughout:** deterministic financial logic gets exhaustive unit tests in
`packages/domain`; every permission cell in §4 gets an integration test asserting both allow _and_
deny; the 20 e2e workflows in spec §26 are written as named Playwright specs and tracked to green.
Mocked or unverified features are reported as such — never claimed as tested.

---

## Open items for you

1. **Build root** — proceeding with `E:\TechpioAsset\` unless you say otherwise.
2. **Azure credentials** — Doc Intelligence, Blob Storage, Entra ID. Absent them, Phase 3 ships
   against the mock provider with the real integration code in place and clearly marked.
3. **Currency & locale** — defaulting to a configurable per-company base currency, no FX conversion.
4. **Depreciation method** — defaulting to straight-line with configurable useful life.
