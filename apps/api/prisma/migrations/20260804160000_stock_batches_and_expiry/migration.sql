-- v2.9 C4 - lot tracking and expiry. (ASCII only: the shadow DB runs WIN1252.)

ALTER TYPE "NotificationType" ADD VALUE 'STOCK_EXPIRING';
ALTER TYPE "AuditAction" ADD VALUE 'STOCK_BATCH_RECEIVED';
ALTER TYPE "AuditAction" ADD VALUE 'STOCK_EXPIRED_ISSUED';

-- Off by default: most kit has no shelf life, and turning lot tracking on for
-- everything would make every existing receipt suddenly incomplete.
ALTER TABLE "inventory_items" ADD COLUMN "batchTracked" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "stock_batches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" DATE,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceGrnLineId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_batches_inventoryItemId_stockLocationId_batchNumber_key"
  ON "stock_batches"("inventoryItemId", "stockLocationId", "batchNumber");
CREATE INDEX "stock_batches_companyId_expiryDate_idx" ON "stock_batches"("companyId", "expiryDate");

ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_stockLocationId_fkey"
  FOREIGN KEY ("stockLocationId") REFERENCES "stock_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD COLUMN "stockBatchId" TEXT;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockBatchId_fkey"
  FOREIGN KEY ("stockBatchId") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- THE BACKSTOP. Enforcement is the guarded conditional UPDATE in the service;
-- this is what stops a batch being driven negative by anything else. A lot
-- holding minus three of something is not a number, it is a bug with a value.
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_quantity_not_negative"
  CHECK ("quantity" >= 0);

-- Tenant isolation, same permissive-until-GUC policy shape as prior releases.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_batches']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;
