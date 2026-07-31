-- CreateTable
CREATE TABLE "approval_delegations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "delegatorId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "reason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_delegations_companyId_delegateId_idx" ON "approval_delegations"("companyId", "delegateId");

-- CreateIndex
CREATE INDEX "approval_delegations_companyId_delegatorId_idx" ON "approval_delegations"("companyId", "delegatorId");

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
