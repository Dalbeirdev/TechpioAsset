-- The threshold each step was configured with when the chain was built,
-- snapshotted on the approval row so changing a workflow later cannot
-- silently re-decide a request already in flight.
ALTER TABLE "request_approvals" ADD COLUMN     "costThreshold" DECIMAL(14,2);
