-- v2.15 Phase 2d. Additive only.
--
-- asset_transfers: a transfer is open (asset IN_TRANSIT) until the destination
-- confirms arrival; receivedAt IS NULL is the open marker.
ALTER TABLE "asset_transfers" ADD COLUMN "receivedAt" TIMESTAMP(3);
ALTER TABLE "asset_transfers" ADD COLUMN "receivedById" TEXT;
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- maintenance_records: the DAMAGE/REPAIR request a work order was raised from.
ALTER TABLE "maintenance_records" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "maintenance_records_requestId_key" ON "maintenance_records"("requestId");
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "asset_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
