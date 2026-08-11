-- CreateIndex
CREATE INDEX "asset_requests_companyId_createdAt_idx" ON "asset_requests"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "assets_companyId_assignedUserId_createdAt_idx" ON "assets"("companyId", "assignedUserId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_assetRequestId_deletedAt_idx" ON "attachments"("assetRequestId", "deletedAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
