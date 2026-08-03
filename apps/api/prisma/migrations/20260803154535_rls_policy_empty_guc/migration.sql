-- v2.7 R1: treat an EMPTY tenant GUC as unset (ASCII only).
--
-- Once set_config('app.tenant_id', ..., true) has run on a session, the
-- parameter's reset value becomes the empty string, not NULL - so on a reused
-- pooled connection the old "IS NULL = permissive" form silently blocked
-- every row for GUC-less work (the platform plane, background jobs). Found by
-- the rls-enforcement integration suite. NULLIF(x, '') restores the intended
-- semantics: unset OR empty = permissive, anything else = that tenant only.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename FROM pg_policies WHERE policyname = 'tenant_isolation'
  LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I.%I', r.schemaname, r.tablename);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I '
      || 'USING (NULLIF(current_setting(''app.tenant_id'', true), '''') IS NULL '
      || 'OR "companyId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (NULLIF(current_setting(''app.tenant_id'', true), '''') IS NULL '
      || 'OR "companyId" = current_setting(''app.tenant_id'', true))',
      r.schemaname, r.tablename);
  END LOOP;
END $$;
