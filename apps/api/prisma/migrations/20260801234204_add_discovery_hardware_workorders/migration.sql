-- CreateEnum
CREATE TYPE "DiscoverySource" AS ENUM ('MOCK', 'AGENT', 'INTUNE');

-- CreateEnum
CREATE TYPE "DiscoveryMatchState" AS ENUM ('MATCHED', 'PROPOSED', 'CONFLICT', 'UNMATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SmartStatus" AS ENUM ('HEALTHY', 'WARNING', 'FAILING');

-- CreateEnum
CREATE TYPE "HealthGrade" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL');

-- AlterTable
ALTER TABLE "maintenance_records" ADD COLUMN     "diagnosis" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "slaDueAt" TIMESTAMP(3),
ADD COLUMN     "technicianId" TEXT;

-- CreateTable
CREATE TABLE "hardware_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "manufacturer" TEXT,
    "modelName" TEXT,
    "cpu" TEXT,
    "cpuCores" INTEGER,
    "ramGb" DECIMAL(8,1),
    "ramSlotsUsed" INTEGER,
    "ramSlotsTotal" INTEGER,
    "storageTotalGb" DECIMAL(10,1),
    "storageFreeGb" DECIMAL(10,1),
    "smartStatus" "SmartStatus",
    "batteryHealthPct" INTEGER,
    "batteryCycleCount" INTEGER,
    "gpu" TEXT,
    "biosVersion" TEXT,
    "source" "DiscoverySource" NOT NULL,
    "lastDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hardware_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operating_system_info" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "osName" TEXT,
    "osVersion" TEXT,
    "osBuild" TEXT,
    "osSupported" BOOLEAN,
    "osActivated" BOOLEAN,
    "lastBootAt" TIMESTAMP(3),
    "diskEncrypted" BOOLEAN,
    "defenderEnabled" BOOLEAN,
    "firewallEnabled" BOOLEAN,
    "tpmPresent" BOOLEAN,
    "localAdminCount" INTEGER,
    "missingCriticalPatches" INTEGER,
    "source" "DiscoverySource" NOT NULL,
    "lastDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operating_system_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installed_software" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "publisher" TEXT,
    "installedAt" TIMESTAMP(3),
    "lastDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installed_software_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_devices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "serialNumber" TEXT,
    "hostname" TEXT,
    "source" "DiscoverySource" NOT NULL,
    "matchState" "DiscoveryMatchState" NOT NULL DEFAULT 'UNMATCHED',
    "assetId" TEXT,
    "payload" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "discovered_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_health" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "grade" "HealthGrade" NOT NULL,
    "subScores" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_schedules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "lastCreatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "maintenance_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hardware_profiles_assetId_key" ON "hardware_profiles"("assetId");

-- CreateIndex
CREATE INDEX "hardware_profiles_companyId_idx" ON "hardware_profiles"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "operating_system_info_assetId_key" ON "operating_system_info"("assetId");

-- CreateIndex
CREATE INDEX "operating_system_info_companyId_idx" ON "operating_system_info"("companyId");

-- CreateIndex
CREATE INDEX "installed_software_assetId_name_idx" ON "installed_software"("assetId", "name");

-- CreateIndex
CREATE INDEX "installed_software_companyId_idx" ON "installed_software"("companyId");

-- CreateIndex
CREATE INDEX "discovered_devices_companyId_matchState_idx" ON "discovered_devices"("companyId", "matchState");

-- CreateIndex
CREATE INDEX "discovered_devices_companyId_serialNumber_idx" ON "discovered_devices"("companyId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "asset_health_assetId_key" ON "asset_health"("assetId");

-- CreateIndex
CREATE INDEX "asset_health_companyId_grade_idx" ON "asset_health"("companyId", "grade");

-- CreateIndex
CREATE INDEX "maintenance_schedules_companyId_nextDueAt_idx" ON "maintenance_schedules"("companyId", "nextDueAt");

-- AddForeignKey
ALTER TABLE "hardware_profiles" ADD CONSTRAINT "hardware_profiles_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_system_info" ADD CONSTRAINT "operating_system_info_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installed_software" ADD CONSTRAINT "installed_software_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_devices" ADD CONSTRAINT "discovered_devices_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_health" ADD CONSTRAINT "asset_health_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-authored guards (plan section 3 invariants) -----------------------------

-- Health scores live on the 0-100 scale, always.
ALTER TABLE "asset_health" ADD CONSTRAINT "asset_health_overall_bounds"
  CHECK ("overall" >= 0 AND "overall" <= 100);

-- Preventive schedules recur at least daily.
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_interval_positive"
  CHECK ("intervalDays" >= 1);

-- A MATCHED or PROPOSED discovery row must point at an asset; an UNMATCHED one
-- must not - the state and the link can never disagree.
ALTER TABLE "discovered_devices" ADD CONSTRAINT "discovered_devices_state_link_agree"
  CHECK (
    ("matchState" IN ('MATCHED', 'PROPOSED', 'CONFLICT') AND "assetId" IS NOT NULL)
    OR ("matchState" IN ('UNMATCHED', 'IGNORED'))
  );

-- Tenant isolation, same permissive-until-GUC policy shape as prior releases.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hardware_profiles','operating_system_info','installed_software','discovered_devices','asset_health','maintenance_schedules']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;
