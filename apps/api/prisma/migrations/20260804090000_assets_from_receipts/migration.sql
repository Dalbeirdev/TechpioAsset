-- v2.9 C1 — assets are born from goods receipts.
--
-- The receipt line plus the unit's position within it is the asset's origin AND
-- its identity. The unique index is the idempotency backstop: a replayed or
-- retried receipt cannot create the same unit twice, even if the application
-- layer forgets to check. Both columns are NULL for every asset created any
-- other way, and Postgres treats NULLs as distinct, so those rows coexist.

ALTER TABLE "assets" ADD COLUMN "sourceGrnLineId" TEXT;
ALTER TABLE "assets" ADD COLUMN "sourceUnitIndex" INTEGER;

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_sourceGrnLineId_fkey"
  FOREIGN KEY ("sourceGrnLineId") REFERENCES "goods_receipt_lines"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "assets_sourceGrnLineId_sourceUnitIndex_key"
  ON "assets"("sourceGrnLineId", "sourceUnitIndex");

-- A unit index without a line (or the reverse) would be a half-recorded origin.
ALTER TABLE "assets"
  ADD CONSTRAINT "assets_receipt_origin_complete"
  CHECK (("sourceGrnLineId" IS NULL) = ("sourceUnitIndex" IS NULL));
