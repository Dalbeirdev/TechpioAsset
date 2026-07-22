# TechpioAsset

**Manage Assets. Control Costs. Simplify Operations.**

Enterprise asset-management platform covering IT equipment, furniture, kitchen and pantry stock,
office supplies, invoices, employee requests, assignments, returns, maintenance, costs and audit
history.

> **Status: Phase 0 (Foundation) complete.** Authentication, dashboards and asset management arrive
> in Phase 1. See [PLAN.md](./PLAN.md) for the full seven-phase plan and
> [docs/phase-0-report.md](./docs/phase-0-report.md) for what is verified versus outstanding.

---

## Prerequisites

| Tool           | Version  | Notes                                         |
| -------------- | -------- | --------------------------------------------- |
| Node.js        | >= 20.11 | Developed against 24.x                        |
| pnpm           | >= 10    | `npm install -g pnpm`                         |
| Docker Desktop | latest   | Provides Postgres, Redis, Azurite and Mailpit |

Docker is only needed for the backing services. If you cannot run Docker, install PostgreSQL 16 and
Redis 7 natively and point `DATABASE_URL` / `REDIS_URL` at them — nothing else changes.

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

## Local development

```bash
pnpm dev
```

| Surface                     | URL                                |
| --------------------------- | ---------------------------------- |
| Web                         | http://localhost:3000              |
| API                         | http://localhost:3001              |
| API documentation (Swagger) | http://localhost:3001/api/docs     |
| Health — liveness           | http://localhost:3001/health/live  |
| Health — readiness          | http://localhost:3001/health/ready |
| Mail catcher                | http://localhost:8025              |

Run a single app with `pnpm --filter @techpioasset/web dev` or `--filter @techpioasset/api dev`.

## Commands

| Command                 | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `pnpm verify`           | format check → lint → typecheck → tests. Run before every commit. |
| `pnpm build`            | Build all packages and apps                                       |
| `pnpm lint`             | ESLint across the workspace                                       |
| `pnpm typecheck`        | TypeScript, no emit                                               |
| `pnpm test`             | Unit tests                                                        |
| `pnpm test:integration` | API integration tests (requires a database)                       |
| `pnpm test:e2e`         | Playwright end-to-end suite (Phase 1 onward)                      |
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
  the domain layer throws `AutomatedApprovalError` otherwise.
- **Mock providers announce themselves.** Storage, AI, mail and push all sit behind interfaces. When
  a mock is active, `/health/ready` reports `mocked` and responses carry `meta.simulated` — a
  simulated result is never presented as a real one.

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
