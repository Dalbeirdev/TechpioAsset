-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'WORK_ORDER_ESCALATED';

-- AlterEnum
ALTER TYPE "MaintenanceStatus" ADD VALUE 'ON_HOLD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'WORK_ORDER_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'WORK_ORDER_ESCALATED';
