-- CreateEnum
CREATE TYPE "WorkflowStepKind" AS ENUM ('APPROVAL', 'INVENTORY_CHECK', 'COST_ASSESSMENT');

-- AlterTable
ALTER TABLE "request_approvals" ADD COLUMN     "kind" "WorkflowStepKind" NOT NULL DEFAULT 'APPROVAL';

-- AlterTable
ALTER TABLE "workflow_steps" ADD COLUMN     "kind" "WorkflowStepKind" NOT NULL DEFAULT 'APPROVAL';

