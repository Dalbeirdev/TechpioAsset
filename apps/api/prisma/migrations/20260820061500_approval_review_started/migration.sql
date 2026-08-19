-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'REQUEST_REVIEW_STARTED';

-- AlterTable
ALTER TABLE "request_approvals" ADD COLUMN     "reviewStartedAt" TIMESTAMP(3),
ADD COLUMN     "reviewStartedById" TEXT;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_reviewStartedById_fkey" FOREIGN KEY ("reviewStartedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
