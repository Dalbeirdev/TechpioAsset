-- v2.1 Workstream B: tenant-isolation Row-Level Security backstop.
-- Permissive while app.tenant_id is unset (current behaviour preserved); enforces
-- once the per-request GUC is set. FORCE so the table owner is subject too.

ALTER TABLE "ai_configurations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_configurations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ai_configurations";
CREATE POLICY tenant_isolation ON "ai_configurations"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "ai_usage_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage_records" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ai_usage_records";
CREATE POLICY tenant_isolation ON "ai_usage_records"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "asset_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "asset_requests";
CREATE POLICY tenant_isolation ON "asset_requests"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assets";
CREATE POLICY tenant_isolation ON "assets"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "attachments";
CREATE POLICY tenant_isolation ON "attachments"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_logs";
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "categories";
CREATE POLICY tenant_isolation ON "categories"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "departments";
CREATE POLICY tenant_isolation ON "departments"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "inventory_items";
CREATE POLICY tenant_isolation ON "inventory_items"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "invoices";
CREATE POLICY tenant_isolation ON "invoices"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notifications";
CREATE POLICY tenant_isolation ON "notifications"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "offices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "offices";
CREATE POLICY tenant_isolation ON "offices"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "onboarding_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_tasks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "onboarding_tasks";
CREATE POLICY tenant_isolation ON "onboarding_tasks"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "onboarding_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "onboarding_templates";
CREATE POLICY tenant_isolation ON "onboarding_templates"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "physical_inventory_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "physical_inventory_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "physical_inventory_sessions";
CREATE POLICY tenant_isolation ON "physical_inventory_sessions"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "purchase_orders";
CREATE POLICY tenant_isolation ON "purchase_orders"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "roles";
CREATE POLICY tenant_isolation ON "roles"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "saved_filters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_filters" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "saved_filters";
CREATE POLICY tenant_isolation ON "saved_filters"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "scheduled_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_reports" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "scheduled_reports";
CREATE POLICY tenant_isolation ON "scheduled_reports"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "users";
CREATE POLICY tenant_isolation ON "users"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "vendors";
CREATE POLICY tenant_isolation ON "vendors"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

ALTER TABLE "workflow_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_definitions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_definitions";
CREATE POLICY tenant_isolation ON "workflow_definitions"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));
