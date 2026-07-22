-- CreateIndex
CREATE INDEX "request_approvals_approverRoleId_decision_idx" ON "request_approvals"("approverRoleId", "decision");

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_approverRoleId_fkey" FOREIGN KEY ("approverRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
