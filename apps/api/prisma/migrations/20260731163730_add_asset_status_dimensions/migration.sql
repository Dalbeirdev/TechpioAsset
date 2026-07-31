-- CreateEnum
CREATE TYPE "LifecycleState" AS ENUM ('PLANNED', 'IN_PROCUREMENT', 'IN_STOCK', 'DEPLOYED', 'IN_MAINTENANCE', 'RETIRED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "AvailabilityState" AS ENUM ('AVAILABLE', 'RESERVED', 'ASSIGNED', 'IN_TRANSIT', 'IN_REPAIR', 'LOST');

-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('OWNED', 'LEASED', 'RENTED', 'BYOD', 'LOANER');

-- AlterEnum
ALTER TYPE "AssetCondition" ADD VALUE 'END_OF_LIFE';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "availabilityState" "AvailabilityState",
ADD COLUMN     "lifecycleState" "LifecycleState",
ADD COLUMN     "ownershipType" "OwnershipType";

-- CreateIndex
CREATE INDEX "assets_companyId_lifecycleState_availabilityState_idx" ON "assets"("companyId", "lifecycleState", "availabilityState");
