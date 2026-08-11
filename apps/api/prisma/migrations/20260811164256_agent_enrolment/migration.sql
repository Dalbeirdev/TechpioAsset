-- CreateTable
CREATE TABLE "agent_enrolment_tokens" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "agent_enrolment_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_agents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "hostname" TEXT,
    "serialNumber" TEXT,
    "platform" TEXT,
    "agentVersion" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "device_agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_enrolment_tokens_companyId_key" ON "agent_enrolment_tokens"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "device_agents_tokenHash_key" ON "device_agents"("tokenHash");

-- CreateIndex
CREATE INDEX "device_agents_companyId_revokedAt_idx" ON "device_agents"("companyId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_agents_companyId_machineId_key" ON "device_agents"("companyId", "machineId");

-- AddForeignKey
ALTER TABLE "device_agents" ADD CONSTRAINT "device_agents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
