-- v2.17: uncatalogued request items + admin-curated catalog items.

ALTER TABLE "request_items" ADD COLUMN "isUncatalogued" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "request_items" ADD COLUMN "manufacturer" TEXT;
ALTER TABLE "request_items" ADD COLUMN "model" TEXT;
ALTER TABLE "request_items" ADD COLUMN "referenceUrl" TEXT;

CREATE TABLE "catalog_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_items_companyId_name_key" ON "catalog_items"("companyId", "name");

ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant-isolation RLS, same backstop pattern as every companyId table.
ALTER TABLE "catalog_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "catalog_items";
CREATE POLICY tenant_isolation ON "catalog_items"
  USING (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR "companyId" = current_setting('app.tenant_id', true));

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'techpioasset_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog_items" TO techpioasset_app;
  END IF;
END $$;
