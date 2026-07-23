# TechpioAsset

**Manage Assets. Control Costs. Simplify Operations.**

Enterprise asset-management platform covering IT equipment, furniture, kitchen and pantry stock,
office supplies, invoices, employee requests, assignments, returns, maintenance, costs and audit
history.

> **Status: all six phases complete.** The full platform — assets, requests, invoices/AI, mobile
> sync, maintenance/warranty/depreciation, permission-gated reports, and Phase 6 hardening — is built
> and tested: **448 automated tests** (296 unit + 152 integration), an adversarial security suite
> (IDOR, file validation, rate limits, log redaction), a WCAG-AA-proven palette, a measured latency
> profile, and a dependency tree with no known-vulnerable runtime package. Two gaps are environmental,
> not code, and documented honestly: the Phase 4 mobile app **could not be run on a device/emulator
> here** (Windows, no Android SDK/iOS), and E2E + live screen-reader passes belong in CI. Plan:
> [PLAN.md](./PLAN.md). Reports:
> [Phase 0](./docs/phase-0-report.md) · [Phase 1](./docs/phase-1-report.md) ·
> [Phase 2](./docs/phase-2-report.md) · [Phase 3](./docs/phase-3-report.md) ·
> [Phase 4](./docs/phase-4-report.md) · [Phase 5](./docs/phase-5-report.md) ·
> [Phase 6](./docs/phase-6-report.md).

---

## Prerequisites

| Tool           | Version  | Notes                                         |
| -------------- | -------- | --------------------------------------------- |
| Node.js        | >= 20.11 | Developed against 24.x                        |
| pnpm           | >= 10    | `npm install -g pnpm`                         |
| Docker Desktop | latest   | Provides Postgres, Redis, Azurite and Mailpit |

Docker is only needed for the backing services. **If you cannot run Docker**, see
[Running without Docker](#running-without-docker) — a real PostgreSQL server can be started from
user-space binaries with no administrator rights.

## Installation

```bash
pnpm install
```

## Environment setup

```bash
cp .env.example .env
```

Every variable the application reads is documented in [.env.example](./.env.example). The defaults
run entirely against local mock providers — no Azure, SMTP or push credentials required.

Generate real secrets before any deployment:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Database setup

```bash
pnpm infra:up
pnpm db:migrate:deploy
pnpm seed
```

`infra:up` starts Postgres, Redis, Azurite and Mailpit. `db:migrate:deploy` applies the migrations in
[apps/api/prisma/migrations](./apps/api/prisma/migrations). `seed` loads the permission catalogue, the
eight system roles with their grants, and the full category tree from spec section 4. The seed is
idempotent — re-running it changes nothing.

### Running without Docker

Docker Desktop needs administrator rights and, on Windows, WSL2. Where that is not available, the
repository ships a user-space PostgreSQL server — real PostgreSQL binaries, not an emulation — run as
an ordinary process:

```bash
pnpm db:local
```

That creates a cluster in `apps/api/.local-db` (git-ignored), starts it on the port from
`DATABASE_URL`, and holds the foreground until Ctrl+C. `pnpm db:local:stop` stops a detached one.
Then run `db:migrate:deploy` and `seed` exactly as above.

Caveats worth knowing:

- **Postgres only.** Redis has no equivalent user-space path on Windows. Nothing in Phase 1 needs it —
  rate limiting uses in-memory storage — and `/health/ready` reports it as non-critical until Phase 2
  introduces background jobs.
- The `embedded-postgres` package is a **`devDependency`, pinned to an exact version**, and is never
  loaded by the application. Production uses Compose or a managed instance.
- Compose remains the primary path. Use this only when Docker is genuinely unavailable.

## Local development

```bash
pnpm dev
```

> Stop the API dev server before running a full `pnpm build`. `nest build` deletes `dist` while
> `nest start --watch` is serving out of it, which crashes the running process.

| Surface                     | URL                                |
| --------------------------- | ---------------------------------- |
| Web                         | http://localhost:3000              |
| API                         | http://localhost:3001              |
| API documentation (Swagger) | http://localhost:3001/api/docs     |
| Health — liveness           | http://localhost:3001/health/live  |
| Health — readiness          | http://localhost:3001/health/ready |
| Mail catcher                | http://localhost:8025              |

Run a single app with `pnpm --filter @techpioasset/web dev` or `--filter @techpioasset/api dev`.

### Demonstration accounts

The seed creates one account per role. **Every one shares the same password**, which is why the seed
refuses to run with `NODE_ENV=production` and the API refuses to boot with a development JWT secret.

| Email                       | Role                 | Sees                                        |
| --------------------------- | -------------------- | ------------------------------------------- |
| `admin@techpioasset.dev`    | Super Admin          | Everything, all 48 permissions              |
| `it@techpioasset.dev`       | IT Administrator     | Full estate, IT lifecycle                   |
| `hr@techpioasset.dev`       | HR                   | People and assets, **no costs or invoices** |
| `office@techpioasset.dev`   | Office Administrator | Furniture, kitchen, stock                   |
| `finance@techpioasset.dev`  | Finance              | Costs, invoices, vendors                    |
| `manager@techpioasset.dev`  | Manager              | Own and direct reports' assets only         |
| `auditor@techpioasset.dev`  | Auditor              | Read-only across the estate                 |
| `employee@techpioasset.dev` | Employee             | **Only their own 3 assets**, no costs       |

Password for all of them: `TechpioDemo!2026`

Set `SEED_DEMO=false` to load reference data without them.

## Commands

| Command                 | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `pnpm verify`           | format check → lint → typecheck → tests. Run before every commit. |
| `pnpm build`            | Build all packages and apps                                       |
| `pnpm lint`             | ESLint across the workspace                                       |
| `pnpm typecheck`        | TypeScript, no emit                                               |
| `pnpm test`             | Unit tests                                                        |
| `pnpm test:integration` | API integration tests (requires a database)                       |
| `pnpm test:e2e`         | Playwright end-to-end suite (Phase 6)                             |
| `pnpm format`           | Prettier write                                                    |

### Database commands

| Command                  | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `pnpm db:migrate`        | Create and apply a migration in development                |
| `pnpm db:migrate:deploy` | Apply pending migrations (CI and production)               |
| `pnpm db:generate`       | Regenerate the Prisma client                               |
| `pnpm db:reset`          | Drop, re-migrate and re-seed. **Destroys all local data.** |
| `pnpm db:studio`         | Prisma Studio                                              |
| `pnpm seed`              | Load reference data                                        |

## Repository layout

```
apps/
  api/       NestJS REST API, Prisma schema, migrations, seed
  web/       Next.js App Router web client
  mobile/    Expo React Native client            (Phase 4)
packages/
  contracts/ Zod schemas and types shared by API, web and mobile
  domain/    Pure business rules - state machines, money, permissions
  ui-tokens/ Status colours, icons and tone palettes shared by web and mobile
  config/    Shared TypeScript, ESLint and Prettier bases
e2e/         Playwright suite                     (Phase 1)
docs/        Architecture, RBAC matrix, phase reports
```

## Architecture notes

- **Tenancy.** Every tenant-owned row carries `companyId`. Transfers between legal entities are a
  first-class feature, so multi-company support is structural rather than retrofitted.
- **Permissions, not roles.** Guards check `assets:assign`; nothing branches on a role name. Roles are
  reconfigurable at runtime by a Super Admin, so role-name checks would break on the first edit.
- **Employee isolation is enforced in the repository layer**, not the controller, so it holds for
  reports and exports as well as screens.
- **Money is `Decimal(14,2)`, never a float.** Invoice verification must be exact, and a lint rule
  blocks `parseFloat` to keep it that way.
- **Status transitions are data-driven state machines** — 18 asset, 16 request and 16 verification
  statuses, each with an exhaustively tested transition table.
- **AI never approves anything.** `VERIFIED` and `REJECTED` require an authenticated human reviewer;
  the domain layer throws `AutomatedApprovalError` otherwise. AI only _extracts_ — every financial
  and quantity check runs in a pure, exhaustively-tested deterministic engine, never AI.
- **AI-off means no outbound call.** Every upload passes through the AI gate before a provider is
  touched; with AI disabled, uploads and manual entry still work and verification still runs. An
  integration test spies the provider and asserts zero calls.
- **Invoice documents are never public.** Stored under opaque keys, served only via signed, expiring,
  permission-checked URLs. Uploads are validated by magic bytes, not the declared MIME type.
- **Mock providers announce themselves.** Storage, AI, mail, push and the job queue all sit behind
  interfaces. When a mock is active, `/health/ready` reports `mocked` and responses carry
  `meta.simulated` — a simulated result is never presented as a real one. Simulated email is written
  to `.local-mail` as openable `.eml` files rather than discarded.
- **Approval chains are data.** Workflow definitions, steps, approvers and cost thresholds live in
  the database and are read at runtime, so a Super Admin can reconfigure routing without a deploy.
  Exactly one step is `PENDING` at a time; later steps queue as `WAITING`.
- **Background jobs run in-process by default.** No Redis needed for development. Set
  `QUEUE_PROVIDER=bullmq` for a durable queue — in-process jobs do not survive a restart.
- **Offline sync is idempotent by construction.** The mobile app queues changes under a
  client-generated ULID; the server recognises a replay by it, so a phone on a flaky connection can
  retry its whole queue without double-counting. The decision logic is pure and exhaustively tested
  in `packages/domain`.

## External service setup

All four integrations run against local mocks by default. Switch to production by changing one
variable and supplying credentials.

### Azure AI Document Intelligence

```env
AI_PROVIDER=azure
AZURE_DOC_INTELLIGENCE_ENDPOINT=https://<resource>.cognitiveservices.azure.com/
AZURE_DOC_INTELLIGENCE_KEY=<key>
```

Create a Document Intelligence resource in the Azure portal and copy endpoint and key. `AI_ENABLED`
is the master switch; per-company, per-office, per-role and per-feature control lives in the Super
Admin AI configuration page. With AI disabled, uploads and manual invoice entry keep working and no
document is sent anywhere.

### Storage

```env
STORAGE_PROVIDER=azure
AZURE_STORAGE_CONNECTION_STRING=<connection-string>
```

Or `STORAGE_PROVIDER=s3` with `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
Containers must be private; documents are served only through short-lived signed URLs.

### Email

```env
MAIL_PROVIDER=smtp
SMTP_HOST=<host>
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=<user>
SMTP_PASSWORD=<password>
```

### Push notifications

```env
PUSH_PROVIDER=expo
EXPO_ACCESS_TOKEN=<token>
```

## Security

- Permission checks run in the API, never only in the UI.
- Role and permission values submitted by a client are ignored.
- Documents are never exposed through a public URL.
- Audit records are append-only and have no update or delete route.
- Financial records, assignment history and audit rows cannot be deleted through the ORM at all.
- Secrets come from the environment; the application refuses to start with a development secret when
  `NODE_ENV=production`.

## Licence

Proprietary. All rights reserved.
