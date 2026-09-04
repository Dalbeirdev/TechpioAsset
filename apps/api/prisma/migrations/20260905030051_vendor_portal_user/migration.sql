-- Vendor portal identity (v2.42): links an external supplier user to the one
-- vendor whose rows it may touch. Nullable, so every existing internal user
-- is unaffected. RESTRICT on delete: a vendor with portal users cannot be
-- removed out from under them.


-- AlterTable
ALTER TABLE "users" ADD COLUMN     "vendorId" TEXT;

-- CreateIndex
CREATE INDEX "users_companyId_vendorId_idx" ON "users"("companyId", "vendorId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

