-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_ESCALATED';

-- AlterTable
ALTER TABLE "request_approvals" ADD COLUMN     "escalatedAt" TIMESTAMP(3);
