/**
 * v2.7 R1 — provisions the non-superuser `techpioasset_app` role in the LOCAL
 * database, mirroring deploy/rls-app-role.sql (which remains the production
 * path, run by an operator with a strong password). Idempotent; test-only
 * password, local embedded Postgres only.
 */

export const RLS_APP_PASSWORD = 'rls-lane-local-only';
export const RLS_APP_URL = `postgresql://techpioasset_app:${RLS_APP_PASSWORD}@localhost:5432/techpioasset?schema=public`;

interface RawClient {
  $executeRawUnsafe(sql: string): Promise<unknown>;
}

export async function provisionRlsRole(admin: RawClient): Promise<void> {
  await admin.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'techpioasset_app') THEN
        CREATE ROLE techpioasset_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
          PASSWORD '${RLS_APP_PASSWORD}';
      ELSE
        ALTER ROLE techpioasset_app WITH LOGIN NOSUPERUSER NOBYPASSRLS
          PASSWORD '${RLS_APP_PASSWORD}';
      END IF;
    END
    $$;
  `);
  await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE techpioasset TO techpioasset_app`);
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO techpioasset_app`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO techpioasset_app`,
  );
  await admin.$executeRawUnsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO techpioasset_app`,
  );
}
