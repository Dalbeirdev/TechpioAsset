-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PR_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'PR_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'PR_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'PO_ISSUED';
ALTER TYPE "AuditAction" ADD VALUE 'PO_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'GRN_RECEIVED';
