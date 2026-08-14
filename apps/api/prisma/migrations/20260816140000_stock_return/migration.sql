-- v2.21: a consumable handed back is not an "adjustment" - it is a return, and
-- the ledger should say so. InventoryTransactionReason already had RETURN;
-- StockMovementType did not. Safe inside the migration transaction because
-- nothing in this file writes the new value.
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'RETURN';
