# Phase 0 — Foundation: verification report

**Date:** 2026-07-22
**Scope:** PLAN.md §5 Phase 0 — monorepo, Docker Compose, Prisma schema + first migration, CI task
graph, design tokens, error/response envelope, seed harness.

This report follows spec §27: it states what was executed, what passed, what was _not_ executed, and
why. Nothing below is claimed as tested unless it was actually run.

---

## 1. Verification checklist

| #   | Check                       | Result                          | Evidence                                                                                                    |
| --- | --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Formatting                  | **Pass**                        | `pnpm format` — Prettier clean across the workspace                                                         |
| 2   | Linting                     | **Pass**                        | `pnpm lint` — 6 packages, 0 errors, 0 warnings                                                              |
| 3   | Type checking               | **Pass**                        | `pnpm typecheck` — 6 packages incl. a separate pass for the seed                                            |
| 4   | Unit tests                  | **Pass**                        | 128 passed / 0 failed / 0 skipped (breakdown below)                                                         |
| 5   | Integration tests           | **Not run**                     | Phase 1 scope; requires auth and a live database                                                            |
| 6   | End-to-end tests            | **Not run**                     | Phase 1 scope; no user-facing workflow exists yet                                                           |
| 7   | Mobile tests                | **Not run**                     | Phase 4 scope; app not scaffolded                                                                           |
| 8   | Accessibility checks        | **Partial**                     | 16 automated WCAG contrast assertions pass. No axe/keyboard audit — deferred to Phase 1 when real UI exists |
| 9   | Dependency security scan    | **Not run**                     | Deferred to Phase 6 (Hardening)                                                                             |
| 10  | Database migrations         | **Authored, not applied**       | See §4 — no database available on this machine                                                              |
| 11  | Seed script                 | **Authored, not executed**      | See §4 — depends on 10                                                                                      |
| 12  | Responsive layout           | **Partial**                     | Verified at desktop 1280 and 695px. No tablet/mobile sweep — Phase 1                                        |
| 13  | Light and dark mode         | **Pass**                        | Verified in-browser, both schemes, screenshots taken                                                        |
| 14  | Role permissions            | **Matrix tested, not enforced** | 18 unit tests over the matrix. Runtime guards are Phase 1                                                   |
| 15  | Audit logs                  | **Not applicable**              | Table and policy exist; the write path is Phase 1                                                           |
| 16  | File access security        | **Not applicable**              | Storage provider is Phase 3                                                                                 |
| 17  | AI enable/disable behaviour | **Not applicable**              | AI provider is Phase 3. Defaults seeded off                                                                 |
| 18  | Cost calculations           | **Pass**                        | 17 money tests incl. exact-decimal and rounding cases                                                       |
| 19  | Invoice mismatches          | **Not applicable**              | Verification engine is Phase 3                                                                              |
| 20  | QR-code workflows           | **Not applicable**              | Phase 4                                                                                                     |

## 2. Test results

```
@techpioasset/domain      55 passed   state machines, money, permission matrix
@techpioasset/ui-tokens   32 passed   token coverage, WCAG AA contrast both schemes
@techpioasset/contracts   14 passed   error catalogue, pagination, envelope, health
@techpioasset/api         22 passed   env validation, retention-policy/schema drift
@techpioasset/web          5 passed   icon registry resolution
─────────────────────────────────────
Total                    128 passed, 0 failed, 0 skipped
```

Tests worth calling out, because they encode spec rules rather than implementation detail:

- **State-machine well-formedness** walks all three transition graphs and asserts every state is
  reachable, terminal states have no outgoing edges, and no state lists itself. This caught a real
  modelling error during development (shared target arrays included the state itself).
- **`assertHumanDecisionOnly`** proves `VERIFIED` / `REJECTED` cannot be reached by an automated
  actor — spec §9's "do not allow AI to make final financial approvals automatically".
- **Auditor read-only** asserts the role holds no write grant _and_ that granting one throws, so the
  rule survives a future administrator misconfiguring it.
- **HR financial separation** asserts HR holds neither `invoices:read` nor `assets:cost:read`.
- **Retention-policy drift** parses `schema.prisma` and fails if a model gains `deletedAt` without
  being added to the soft-delete filter — the failure mode where archived rows silently reappear.
- **WCAG contrast** computes the real luminance ratio for all 8 tones in both schemes; all 16 pairs
  are ≥ 4.5:1.

## 3. What was built

| Artifact             | Detail                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo             | pnpm 11 workspaces + Turborepo, 7 projects, shared TS/ESLint/Prettier bases                                                                          |
| `packages/domain`    | Pure rules: 3 state machines (18/16/16 statuses), decimal money, 51-permission catalogue, 8-role matrix                                              |
| `packages/contracts` | Zod schemas: 22 error codes → HTTP status table, pagination, `{data, meta}` envelope, health                                                         |
| `packages/ui-tokens` | 8 semantic tones × 2 schemes, status/condition tokens for all 56 enum values                                                                         |
| Prisma schema        | 51 models → **54 tables, 27 enums, 107 indexes, 126 foreign keys**                                                                                   |
| Migration            | `20260722000000_init/migration.sql`, 1,504 lines, generated offline via `migrate diff`                                                               |
| NestJS API           | Config validation, Prisma guards, request context, response envelope, RFC 9457 filter, Zod pipe, rate limiting, helmet, CORS, Swagger, health probes |
| Seed                 | Idempotent: permissions, 8 system roles + grants, 7 categories / 84 subcategories, AI config defaults                                                |
| Next.js web          | App Router, Tailwind 4, class-driven theming, token-generated CSS variables, status badge, theme toggle                                              |
| Infrastructure       | Compose: Postgres 16, Redis 7, Azurite, Mailpit — all bound to localhost only                                                                        |
| Docs                 | README (prerequisites → production setup), `.env.example` documenting all 54 variables                                                               |

## 4. Known limitations

**The database was never started.** This machine has no Docker, no WSL, no PostgreSQL and no Redis,
and the shell is not elevated, so none could be installed. Consequences:

- The migration is **authored and syntactically valid** (`prisma validate` passes; the SQL was
  generated by Prisma itself from the schema) but has **never been applied to a real database**.
- The seed script is **written and type-checked** but **never executed**.
- `/health/ready` was verified reporting `postgres: down, redis: down` — correct behaviour, but the
  connected path is unproven.

This is the one Phase 0 exit criterion not met: _"`docker compose up` + `pnpm db:migrate` + `pnpm
seed` works from a clean clone"_. Everything except the three commands requiring live infrastructure
was verified. **Phase 1 should not begin until this is closed**, since assignment and permission work
cannot be integration-tested without it.

Other limitations:

- Demonstration accounts (spec §25) are **not** seeded. Seeding a login before password hashing
  exists would create credentials nobody can use; they land in Phase 1 with authentication.
- `docker-compose.yml` is **unverified** — Docker is not installed here. Image names, ports and
  healthchecks are conventional but have not been run.
- No integration, e2e, mobile, or dependency-audit suites exist yet. The `test:integration` and
  `test:e2e` scripts are wired but have no specs.
- The Prisma client is generated into the pnpm store rather than a local path; fine for development,
  worth revisiting when container builds are set up.

## 5. Defects found and fixed during verification

Four real problems surfaced only because the phase was actually exercised rather than assumed
working:

1. **`incremental: true` + Nest's `deleteOutDir` produced a broken build.** `nest build` reported
   success and `tsc --noEmit` was clean, but four modules were missing from `dist` and the API
   crashed at `require` time. tsc's build-info file survived outside the deleted `dist`, so it
   considered unchanged files already emitted. Fixed by relocating `tsBuildInfoFile` into `dist`.
   _This one is worth remembering: a green build is not evidence that the output runs._
2. **Shared packages pointed `main` at TypeScript source.** Bundlers coped; Node did not, so the API
   failed to boot. Packages now build to CommonJS `dist` with proper `exports`.
3. **`PrismaService.onModuleInit` crashed the process when Postgres was unavailable** — taking down
   `/health/ready`, the endpoint whose entire purpose is to report that outage. Now logs and degrades.
4. **`forRoutes('*')`** is invalid under Express 5 / path-to-regexp 8; corrected to `'{*path}'`.

Plus two modelling errors caught by the tests themselves: self-referencing state transitions, and
`rootDir` in the shared tsconfig preset resolving against the preset's own directory.

## 6. Corrections to PLAN.md

Status counts in the original plan were slightly wrong and have been corrected in code and here:
asset statuses are **18** (not 17) and verification statuses are **16** (not 15). Request statuses
were correct at 16. PLAN.md §3 also under-counted the model list; the schema implements 51 models,
including 7 the spec implies but does not name (`RefreshToken`, `InventoryTransaction`,
`WorkflowDefinition`, `WorkflowStep`, `OnboardingTemplate`, `SavedFilter`, `ScheduledReport`) plus
`AIFeatureOverride`, `OnboardingTemplateItem`, `OnboardingTask`, `PurchaseOrderLine` and
`Subcategory`.

## 7. Recommendation

Phase 0 is complete except for the live-database verification in §4. Before Phase 1 begins, one of:

1. Install Docker Desktop (needs admin + a reboot) — matches the plan exactly and is required for
   Azurite in Phase 3; or
2. Install PostgreSQL 16 and Redis natively (needs admin) — unblocks Phases 1–2, leaving the Compose
   file unverified; or
3. Proceed with Phase 1 code and defer all database verification — **not recommended**: it would mean
   writing the permission-enforcement layer with no way to integration-test it, which is precisely
   the layer that most needs proving.
