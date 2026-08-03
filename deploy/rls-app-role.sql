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
--     psql "$ADMIN_DATABASE_URL" -v app_password="<strong-password>" -f deploy/rls-app-role.sql
--
-- Pass the password RAW - do NOT wrap it in single quotes. The script uses
-- psql's :'app_password' form, which adds the quoting itself; passing it
-- pre-quoted stores a password that literally contains the quote characters
-- (found in production during the v2.7 rollout: auth then fails for the app
-- while a 127.0.0.1 `trust` rule in pg_hba makes local psql tests pass anyway,
-- which is a very convincing way to be wrong).
--
-- Migrations and the seed keep running as the owner/superuser; only the running
-- API connects as this role.

\set ON_ERROR_STOP on

-- NOTE (v2.7): psql does NOT substitute :'variables' inside dollar-quoted
-- blocks, so the original DO $$ ... $$ form sent the literal `:'app_password'`
-- to the server and failed with a syntax error. Discovered the first time this
-- script was actually executed, during the production RLS rollout. The
-- conditional below keeps it idempotent using psql's own \if, where
-- interpolation works.

SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'techpioasset_app') AS need_create \gset

\if :need_create
  -- NOSUPERUSER + NOBYPASSRLS are the whole point: this role is subject to RLS.
  CREATE ROLE techpioasset_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
\else
  -- Re-running rotates the password and re-asserts the RLS-subject flags.
  ALTER ROLE techpioasset_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_password';
\endif

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
