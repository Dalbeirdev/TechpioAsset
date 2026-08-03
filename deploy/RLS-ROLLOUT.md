# RLS enforcement — production rollout (v2.7 R1)

Row-Level Security has been installed (policies + FORCE on every `companyId` table) since
v2.1, but it only *bites* for a non-superuser role. This runbook turns it on in production.
Staged, reversible at every step.

## What changes

- The **running API** connects as `techpioasset_app` (non-superuser, `NOBYPASSRLS`).
- `RLS_ENFORCE=true` makes every authenticated request run inside a transaction with
  `app.tenant_id` set, so the policies scope all of its queries — a database backstop
  under the app-layer filters.
- **Migrations and the seed keep running as the owner role** (`techpioasset`) — only the
  API's `DATABASE_URL` changes.
- The platform plane is unaffected: its routes carry `@SkipRls()` and the policies treat an
  unset/empty GUC as permissive (the `rls_policy_empty_guc` migration — an empty string
  reset value would otherwise block reused pooled connections; found and pinned by
  `test/rls-enforcement.integration.test.ts`).

## Preconditions

- v2.7 deployed (contains the `rls_policy_empty_guc` migration and the `@SkipRls` plane).
- A fresh backup (`deploy/backup-db.sh`).

## Steps

1. **Create the app role** (as the DB owner, inside the postgres container):

   ```bash
   docker compose -f docker-compose.vps.yml --env-file .env.prod exec -T postgres \
     psql -U techpioasset -d techpioasset \
     -v app_password="'<generate-a-strong-password>'" \
     -f /dev/stdin < deploy/rls-app-role.sql
   ```

2. **Verify the role is RLS-subject** (both must be `f`):

   ```sql
   SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'techpioasset_app';
   ```

3. **Switch the API's connection** in `.env.prod` — change ONLY the API `DATABASE_URL`
   user/password to `techpioasset_app:<password>`. Keep the owner URL at hand for
   migrations (the api container's migrate-on-start step needs the owner; if migrate and
   serve share one URL today, split them first: run `prisma migrate deploy` manually as the
   owner before switching, or add a `MIGRATE_DATABASE_URL`).

4. **Canary with enforcement off**: restart the api container, confirm `/health/ready`
   shows postgres up and the app serves normally (the role's grants are the only change).

5. **Enforce**: set `RLS_ENFORCE=true` in `.env.prod`, restart the api container.

6. **Verify outside-in**: log in, list assets, open one, open `/analytics` (aggregates run
   inside tenant transactions), and — if the platform plane is enabled — `/platform/tenants`
   must still list every tenant.

## Rollback

Any step: revert `DATABASE_URL` to the owner role and/or `RLS_ENFORCE=false`, restart the
api container. The policies themselves are permissive without the GUC and harmless without
enforcement — exactly the state production ran in from v2.2 through v2.6.

## Proof references

- `apps/api/test/rls-enforcement.integration.test.ts` — database-level: unfiltered
  cross-tenant queries return zero foreign rows; cross-tenant writes die on `WITH CHECK`;
  the empty-GUC regression; the superuser bypass demonstrated (why this rollout exists).
- `apps/api/test/rls-app.integration.test.ts` + `vitest.rls.config.ts` — the whole app
  booted as `techpioasset_app` with `RLS_ENFORCE=true`: identical behaviour for correct
  code, foreign rows invisible, platform plane intact
  (`pnpm --filter @techpioasset/api test:integration:rls`).
