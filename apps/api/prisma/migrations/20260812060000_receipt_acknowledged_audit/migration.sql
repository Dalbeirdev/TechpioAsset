-- v2.15: audit an employee confirming a device reached them.
--
-- Additive only. Postgres requires a new enum value to be committed before it
-- can be used, which the migration runner satisfies by running this ahead of
-- the application deploy.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RECEIPT_ACKNOWLEDGED';
