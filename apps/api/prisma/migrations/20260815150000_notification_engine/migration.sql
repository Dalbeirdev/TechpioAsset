-- v2.18: notification engine - templates, routing rules, email log.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ASSET_RETURNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ASSET_TRANSFERRED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ASSET_MISSING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'USER_CREATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'USER_DEACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DAILY_DIGEST';

CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "subject" TEXT NOT NULL,
    "heading" TEXT,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_templates_companyId_type_key" ON "email_templates"("companyId", "type");
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notification_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyPrimary" BOOLEAN NOT NULL DEFAULT true,
    "recipientRoleKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ccRoleKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "escalationRoleKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thresholds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notification_rules_companyId_type_key" ON "notification_rules"("companyId", "type");
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "toEmail" TEXT NOT NULL,
    "toUserId" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_logs_companyId_createdAt_idx" ON "email_logs"("companyId", "createdAt");
CREATE INDEX "email_logs_companyId_status_idx" ON "email_logs"("companyId", "status");
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-isolation RLS, matching every other companyId table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_templates','notification_rules','email_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true)) WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true))', t);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'techpioasset_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO techpioasset_app', t);
    END IF;
  END LOOP;
END $$;
