-- v2.9 C2 - budgets and cost centres. (ASCII only: the shadow DB runs WIN1252.)

CREATE TABLE "cost_centres" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "ownerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "cost_centres_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCentreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "committed" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cost_centres_companyId_code_key" ON "cost_centres"("companyId", "code");
CREATE INDEX "cost_centres_companyId_isActive_idx" ON "cost_centres"("companyId", "isActive");
CREATE UNIQUE INDEX "budgets_costCentreId_periodStart_periodEnd_key"
  ON "budgets"("costCentreId", "periodStart", "periodEnd");
CREATE INDEX "budgets_companyId_costCentreId_idx" ON "budgets"("companyId", "costCentreId");

ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_costCentreId_fkey"
  FOREIGN KEY ("costCentreId") REFERENCES "cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The purchase request says what it is charged to and what it is holding.
ALTER TABLE "purchase_requests" ADD COLUMN "costCentreId" TEXT;
ALTER TABLE "purchase_requests" ADD COLUMN "budgetId" TEXT;
ALTER TABLE "purchase_requests" ADD COLUMN "committedAmount" DECIMAL(14,2);
ALTER TABLE "purchase_requests" ADD COLUMN "committedAt" TIMESTAMP(3);

ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_costCentreId_fkey"
  FOREIGN KEY ("costCentreId") REFERENCES "cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_budgetId_fkey"
  FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- THE BACKSTOP. Enforcement is the guarded conditional UPDATE in the service;
-- this is what stops anything reaching the table another way. A budget that can
-- be overcommitted by a stray script is not a limit, it is a suggestion.
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_committed_within_amount"
  CHECK ("committed" >= 0 AND "committed" <= "amount");
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_amount_not_negative"
  CHECK ("amount" >= 0);
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_period_ordered"
  CHECK ("periodEnd" >= "periodStart");

-- A commitment is either live and recorded against a budget, or not held at all.
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_commitment_complete"
  CHECK (
    ("committedAmount" IS NULL AND "committedAt" IS NULL)
    OR ("committedAmount" IS NOT NULL AND "committedAt" IS NOT NULL AND "budgetId" IS NOT NULL
        AND "committedAmount" >= 0)
  );

-- Tenant isolation, same permissive-until-GUC policy shape as prior releases.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cost_centres','budgets']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;
