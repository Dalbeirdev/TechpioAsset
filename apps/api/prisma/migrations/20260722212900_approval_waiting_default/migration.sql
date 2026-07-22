-- AlterTable
--
-- Second half of the WAITING enum change: the value was committed by the
-- preceding migration and can now be referenced as a default.
--
-- Existing rows are left alone deliberately. Any approval already sitting at
-- PENDING belongs to a live request, and rewriting those to WAITING would
-- silently remove them from their approver's inbox.
ALTER TABLE "request_approvals" ALTER COLUMN "decision" SET DEFAULT 'WAITING';
