-- v2.6 A3 hand-authored guards (ASCII only - shadow DB runs WIN1252).

-- Retries are bounded and never negative.
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_attempts_bounds"
  CHECK ("attempts" >= 0 AND "attempts" <= 10);

-- Tenant isolation, same permissive-until-GUC policy shape as prior releases.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['webhook_subscriptions','webhook_deliveries','scim_tokens']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;
