-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'LICENSE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'LICENSE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'LICENSE_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'LICENSE_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'LICENSE_RENEWED';
ALTER TYPE "AuditAction" ADD VALUE 'LICENSE_KEY_REVEALED';
ALTER TYPE "AuditAction" ADD VALUE 'LICENSE_ASSIGN_BLOCKED';
