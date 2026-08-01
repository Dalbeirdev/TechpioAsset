-- CreateEnum
CREATE TYPE "LicenseFamily" AS ENUM ('PRODUCTIVITY_SUITE', 'OPERATING_SYSTEM', 'SECURITY', 'DEVELOPER_TOOLS', 'DESIGN_CREATIVE', 'SAAS', 'DATABASE_SERVER', 'OTHER');

-- CreateEnum
CREATE TYPE "LicenseSubscriptionType" AS ENUM ('PERPETUAL', 'SUBSCRIPTION', 'OEM', 'VOLUME', 'OPEN');

-- CreateEnum
CREATE TYPE "LicenseUnit" AS ENUM ('USER', 'DEVICE');

-- CreateEnum
CREATE TYPE "LicenseCostModel" AS ENUM ('PER_SEAT', 'FLAT', 'PER_CPU', 'PER_CORE');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'EXPIRED', 'RETIRED');

-- CreateEnum
CREATE TYPE "LicenseAssignmentStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "software_licenses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "family" "LicenseFamily" NOT NULL,
    "vendorId" TEXT,
    "subscriptionType" "LicenseSubscriptionType" NOT NULL,
    "edition" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "autoRenewal" BOOLEAN NOT NULL DEFAULT false,
    "seatsPurchased" INTEGER NOT NULL,
    "unitOfAssignment" "LicenseUnit" NOT NULL,
    "costAmount" DECIMAL(14,2),
    "costCurrency" CHAR(3),
    "costModel" "LicenseCostModel" NOT NULL DEFAULT 'PER_SEAT',
    "invoiceId" TEXT,
    "purchaseOrderNumber" TEXT,
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "software_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_pools" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seatsAllocated" INTEGER NOT NULL,
    "seatsReserved" INTEGER NOT NULL DEFAULT 0,
    "departmentId" TEXT,
    "costCenter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "seat_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "seatPoolId" TEXT NOT NULL,
    "userId" TEXT,
    "assetId" TEXT,
    "status" "LicenseAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "reason" TEXT,

    CONSTRAINT "license_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_keys" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "keyCiphertext" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "license_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_renewals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousExpiry" TIMESTAMP(3),
    "newExpiry" TIMESTAMP(3),
    "seatsDelta" INTEGER NOT NULL DEFAULT 0,
    "costAmount" DECIMAL(14,2),
    "costCurrency" CHAR(3),
    "notes" TEXT,
    "createdById" TEXT,

    CONSTRAINT "license_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "software_licenses_companyId_status_idx" ON "software_licenses"("companyId", "status");

-- CreateIndex
CREATE INDEX "software_licenses_companyId_expiryDate_idx" ON "software_licenses"("companyId", "expiryDate");

-- CreateIndex
CREATE INDEX "software_licenses_deletedAt_idx" ON "software_licenses"("deletedAt");

-- CreateIndex
CREATE INDEX "seat_pools_companyId_idx" ON "seat_pools"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "seat_pools_licenseId_name_key" ON "seat_pools"("licenseId", "name");

-- CreateIndex
CREATE INDEX "license_assignments_licenseId_status_idx" ON "license_assignments"("licenseId", "status");

-- CreateIndex
CREATE INDEX "license_assignments_companyId_userId_idx" ON "license_assignments"("companyId", "userId");

-- CreateIndex
CREATE INDEX "license_assignments_companyId_assetId_idx" ON "license_assignments"("companyId", "assetId");

-- CreateIndex
CREATE INDEX "license_keys_licenseId_idx" ON "license_keys"("licenseId");

-- CreateIndex
CREATE INDEX "license_renewals_licenseId_renewedAt_idx" ON "license_renewals"("licenseId", "renewedAt");

-- AddForeignKey
ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_pools" ADD CONSTRAINT "seat_pools_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "software_licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_pools" ADD CONSTRAINT "seat_pools_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_assignments" ADD CONSTRAINT "license_assignments_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "software_licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_assignments" ADD CONSTRAINT "license_assignments_seatPoolId_fkey" FOREIGN KEY ("seatPoolId") REFERENCES "seat_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_assignments" ADD CONSTRAINT "license_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_assignments" ADD CONSTRAINT "license_assignments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_keys" ADD CONSTRAINT "license_keys_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "software_licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_renewals" ADD CONSTRAINT "license_renewals_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "software_licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-authored guards (blueprint section A.7 / plan sections 3-4) -----------

-- Seat counters can never go negative or exceed the pool's allocation. The
-- application's atomic conditional increment is the primary guard; this CHECK
-- is the last line of defence.
ALTER TABLE "seat_pools" ADD CONSTRAINT "seat_pools_reserved_within_allocation"
  CHECK ("seatsReserved" >= 0 AND "seatsReserved" <= "seatsAllocated");
ALTER TABLE "seat_pools" ADD CONSTRAINT "seat_pools_allocation_non_negative"
  CHECK ("seatsAllocated" >= 0);
ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_seats_non_negative"
  CHECK ("seatsPurchased" >= 0);

-- An assignment names exactly one principal: a user XOR an asset.
ALTER TABLE "license_assignments" ADD CONSTRAINT "license_assignments_one_principal"
  CHECK (("userId" IS NOT NULL) <> ("assetId" IS NOT NULL));

-- No duplicate ACTIVE seat for the same principal on the same license.
CREATE UNIQUE INDEX "license_assignments_active_user_unique"
  ON "license_assignments" ("licenseId", "userId")
  WHERE "status" = 'ACTIVE' AND "userId" IS NOT NULL;
CREATE UNIQUE INDEX "license_assignments_active_asset_unique"
  ON "license_assignments" ("licenseId", "assetId")
  WHERE "status" = 'ACTIVE' AND "assetId" IS NOT NULL;

-- Tenant isolation, same policy shape as 20260801000000_enable_row_level_security:
-- permissive while app.tenant_id is unset, enforcing once the GUC is set.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['software_licenses','seat_pools','license_assignments','license_keys','license_renewals']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;
