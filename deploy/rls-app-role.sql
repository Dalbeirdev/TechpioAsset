-- v2.1 Workstream B — application DB role for Row-Level Security enforcement.
--
-- The RLS policies added in 20260801000000_enable_row_level_security only take
-- effect for a role that is NOT a superuser and does NOT have BYPASSRLS. The
-- default/embedded-postgres role (`techpioasset`) is a superuser and therefore
-- bypasses RLS entirely, which is why enforcement cannot be observed with it.
--
-- Provision a dedicated non-superuser role, point the application's DATABASE_URL
-- at it, and set RLS_ENFORCE=true. Run this AS the database owner/superuser:
--
--     psql "$ADMIN_DATABASE_URL" -v app_password="'<strong-password>'" -f deploy/rls-app-role.sql
--
-- Migrations and the seed keep running as the owner/superuser; only the running
-- API connects as this role.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'techpioasset_app') THEN
    -- NOSUPERUSER + NOBYPASSRLS are the whole point: this role is subject to RLS.
    EXECUTE format('CREATE ROLE techpioasset_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_password');
  END IF;
END
$$;

-- Least-privilege DML on the current schema.
GRANT CONNECT ON DATABASE techpioasset TO techpioasset_app;
GRANT USAGE ON SCHEMA public TO techpioasset_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO techpioasset_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO techpioasset_app;

-- Future tables/sequences (created by later migrations) inherit the grants.
-- ALTER DEFAULT PRIVILEGES applies to objects created by the role that runs this;
-- run migrations as the same owner so new tables are covered.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO techpioasset_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO techpioasset_app;

-- Note: this role must NOT own the tables (owners are exempt from RLS unless the
-- table is FORCEd — which ours are — but keeping it a non-owner is belt-and-braces).
