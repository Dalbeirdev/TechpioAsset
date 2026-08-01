# TechpioAsset — v2.3 Implementation Plan: License Management

> **Parent plan:** [IMPLEMENTATION-PLAN-v2.1.md](./IMPLEMENTATION-PLAN-v2.1.md) §3/§5 — the release map names
> **v2.3 = License Management (blueprint Phase 3, pulled early)**: "small, self-contained, and the flagship
> differentiator". Source spec: blueprint Part A (License Management Module FRD) in
> [TechpioAsset-Enterprise-ITAM-Blueprint.pdf](./TechpioAsset-Enterprise-ITAM-Blueprint.pdf).
> **Prerequisites shipped:** v2.1 (status model, RLS, RBAC scopes) and v2.2 (13 roles, custom roles, dashboards,
> approvals hardening) are live; epic #30 closed with a QA pass.

## 1. Goal

Track software licenses as first-class assets: what was bought, who consumes each seat, what it costs, and when
it renews — with the flagship rule that **an assignment beyond the purchased seat count is impossible**, not
merely discouraged. The blocked 11th seat is the demo: attempt to assign seat 11 of 10 and the API refuses
transactionally, the UI explains, the dashboard alerts, and the audit trail records the attempt.

## 2. Scope

**In (v2.3):**
- New `licenses` API module + `packages/domain/src/license.ts` (pure seat math / status / validation).
- Entities: `SoftwareLicense`, `SeatPool`, `LicenseAssignment`, `LicenseKey`, `LicenseRenewal` — plus reuse of
  the existing append-only `AuditLog` for license events (the blueprint's `LicenseAuditEvent` maps onto it).
- **Transactional hard seat-limit enforcement** (atomic conditional increment; proven under concurrency).
- Web: Licenses list + detail (seats, assignments, keys-masked, renewals), assign/revoke, dashboard tile.
- Mobile: license list + "my licenses"; the seat-limit block surfaced on mobile too.
- Scheduled sweeps: renewal/expiry alerts (90/60/30-day), utilization warnings (≥90% seats used).
- Permissions: new `licenses:*` keys wired into the catalogue, system-role matrix, and the roles admin UI
  (which picks them up automatically from `GET /roles/permissions`).

**Out (later, per release map):**
- Procurement linkage beyond `invoiceId`/`purchaseOrderNumber` references (v2.4 builds real POs).
- Discovery/agent reconciliation, metering/true-up, activation counting (v2.5+).
- Vendor self-service portal; SCIM-driven auto-reclaim (v2.6).

## 3. Data model (Prisma, additive-only migrations)

House conventions apply: `cuid()` ids, `companyId` tenant column + RLS policy, `deletedAt` soft delete on
parent entities, `createdById`/`updatedById`, and rows added to the RLS migration set + model-policy list.

| Entity | Key fields (beyond house columns) | Notes |
|---|---|---|
| `SoftwareLicense` | name, family (enum), vendorId?, subscriptionType (enum: PERPETUAL/SUBSCRIPTION/OEM/VOLUME/OPEN), edition?, purchaseDate, expiryDate?, renewalDate?, autoRenewal, **seatsPurchased int**, unitOfAssignment (enum: USER/DEVICE), costAmount? Decimal, costCurrency?, costModel (enum), invoiceId?, purchaseOrderNumber?, status (enum: ACTIVE/EXPIRING/EXPIRED/RETIRED), notes | `seats_used`/`available` are **derived** (counted from active assignments / reserved), never stored authoritatively on the license row. Cost fields obey the existing `canSeeCost` gate. |
| `SeatPool` | licenseId, name (default "Default Pool"), **seatsAllocated int**, **seatsReserved int**, departmentId? | The enforcement counter lives here. DB `CHECK (seats_reserved >= 0 AND seats_reserved <= seats_allocated)`. One auto-created default pool per license; Σ allocations ≤ seatsPurchased enforced in service. |
| `LicenseAssignment` | licenseId, seatPoolId, **userId XOR assetId** (unit of assignment), status (ACTIVE/REVOKED), assignedAt, revokedAt?, revokedById?, reason? | Partial unique index on (licenseId, userId/assetId) WHERE status='ACTIVE' — no duplicate active seats (LIC idempotency rule). |
| `LicenseKey` | licenseId, keyCiphertext, last4, note? | Stored encrypted at rest (AES-256-GCM, key from env `LICENSE_KEY_SECRET`); API returns **masked** always; a separate `licenses:keys:reveal` permission + mandatory audit row on every reveal. |
| `LicenseRenewal` | licenseId, renewedAt, previousExpiry?, newExpiry, seatsDelta int, costAmount?, notes | Renewals are the only way `seatsPurchased` changes (append-only history). |

## 4. The seat-limit rule (flagship)

Per blueprint §A.7, implemented with our Prisma + Postgres stack:

```
$transaction:
  affected = UPDATE seat_pools
                SET seats_reserved = seats_reserved + 1
              WHERE id = :poolId AND company_id = :companyId
                AND seats_reserved + 1 <= seats_allocated      -- the hard limit
  if affected = 0 → rollback → 409 SEAT_LIMIT_EXCEEDED
       payload: { available: 0, purchased, assigned }          -- honest numbers
       + AuditLog(assign_blocked) + notification + dashboard alert
  else → duplicate-active check → create LicenseAssignment (ACTIVE)
Revoke reverses: mark assignment REVOKED + guarded decrement (never below 0).
```

- Raw `UPDATE … WHERE` conditional via `$executeRaw` inside the transaction (the WHERE clause *is* the guard —
  correct under READ COMMITTED; no serializable isolation needed for a single-row conditional increment).
- New error code `SEAT_LIMIT_EXCEEDED` (409) in contracts + problem-details map.
- **Concurrency proof:** integration test fires N parallel assigns at a pool with 1 free seat and asserts
  exactly one 201 and N−1 409s, and `seats_reserved == seats_allocated` after — the race the blueprint calls out.

## 5. Permissions

New catalogue keys (auto-surfaced in the roles admin UI): `licenses:read`, `licenses:create`,
`licenses:update`, `licenses:assign`, `licenses:revoke`, `licenses:renew`, `licenses:delete`,
`licenses:keys:reveal`, `licenses:cost:read`. System-role matrix: SUPER_ADMIN all; IT_ADMIN all except
cost/keys-reveal per cost policy (cost stays Finance+SA per the standing product decision); IT_TECHNICIAN
assign/revoke/read; FINANCE read + cost + renew; PROCUREMENT_MANAGER create/update/renew/read; AUDITOR
read-only (keys always masked); EMPLOYEE none (sees own assignments via `/licenses/mine`).
SoD catalogue addition: `licenses:assign` + `licenses:keys:reveal` pair is **not** conflicting; add
`licenses:create` + `invoices:verify` (buy-and-approve) to `SOD_CONFLICTS`.

## 6. Workstreams

| WS | Deliverable | Key files |
|---|---|---|
| **L1 Domain + schema** | Prisma entities + additive migration (+ RLS policies + CHECK constraints); `packages/domain/src/license.ts` (status derivation, expiry buckets, seat math, validation) + unit tests | `apps/api/prisma/schema.prisma`, `packages/domain` |
| **L2 API module** | `licenses` module: CRUD, `/licenses/:id/assign`, `/revoke`, `/renewals`, `/keys` (masked + reveal), `/licenses/mine`; contracts (Zod); scope + cost gating; audit events | `apps/api/src/licenses/*`, `packages/contracts/src/licenses.ts` |
| **L3 Enforcement + concurrency proof** | The §4 transaction; `SEAT_LIMIT_EXCEEDED`; parallel-assign integration test; qa-pack `LIC-*` case runs | `apps/api/src/licenses/seat.service.ts`, `apps/api/test/licenses*.integration.test.ts` |
| **L4 Web UI** | Licenses list (status/expiry/utilization columns), detail (tabs: Overview / Seats / Keys / Renewals), assign+revoke flows with the "License Limit Exceeded" error surface, nav item (`licenses:read`), dashboard tile (expiring licenses / seats ≥90%) | `apps/web/src/app/(app)/licenses/*`, dashboard service tile |
| **L5 Mobile** | Licenses list + detail (read + assign/revoke for holders of the permission), "My licenses" on More; seat-limit block rendered with the same honest numbers | `apps/mobile/app/licenses*`, More menu |
| **L6 Jobs + notifications** | Renewal/expiry sweep (90/60/30-day buckets, same-day-idempotent like the alert sweep), utilization alert; notification-catalogue entries (`LICENSE_EXPIRING`, `SEAT_LIMIT_REACHED`) | `apps/api/src/scheduled/*`, notifications |

Sequencing: L1 → L2 → L3 are strictly ordered; L4/L5/L6 parallel after L3. Small PRs into a `v2.3` branch,
then one integration PR to `main` (the v2.2 cadence).

## 7. Acceptance criteria (traced to the QA pack `LIC-*`)

1. Create/read/update/retire a license with seat pools; Σ pool allocations ≤ purchased (LIC-001..006).
2. Assign to user or device per `unitOfAssignment`; duplicate active assignment refused (LIC-007..010).
3. **Seat 11 of 10 is refused with 409 `SEAT_LIMIT_EXCEEDED`**, honest numbers in the payload, audit row
   written, notification raised — and the parallel-assign race yields exactly one winner (LIC-011..014, the
   flagship). Demo on **web and mobile**.
4. Revoke frees the seat; the freed seat is immediately assignable (LIC-015..016).
5. Renewal extends expiry and/or adds seats append-only; history preserved (LIC-017..019).
6. Keys always masked; reveal requires `licenses:keys:reveal` and writes an audit row (LIC-020..022).
7. Expiry sweep produces 90/60/30 notifications once per bucket; dashboard tile counts match (LIC-023..025).
8. RBAC: role matrix enforced incl. Auditor read-only and cost gating; RLS isolates tenants (LIC-026..030).
9. Zero v1 regression: full suite green; no existing endpoint's behaviour changes (module is purely additive).

## 8. Risks & mitigations

- **Counter drift** (reserved vs. actual active assignments): nightly reconciliation query in the sweep logs a
  warning on mismatch; the counter remains authoritative for the limit, assignments for "who".
- **Key encryption secret handling:** boot-fails with a clear message if `LICENSE_KEY_SECRET` unset while key
  rows exist; documented in DEPLOY.md; never logged.
- **Race regressions:** the parallel-assign test is part of the standard suite, not a one-off.
- **Deploy discipline** (lesson from the 2026-08-01 audit): ship = merge → **rebuild containers** → verify
  from outside; mobile change ⇒ **rebuild APK**; both are in the phase-exit checklist.

## 9. Estimate & phase gate

Roughly the size of v2.2's D+E combined: ~6 PRs. Phase exit requires the standard gate — typecheck 9/9, full
unit + integration suites green (existing 598 + new LIC coverage), lint clean, the mandatory QA report
(per the standing QA policy), live demo of the blocked 11th seat on web + mobile evidence, then **STOP for
explicit approval before deploy**.
