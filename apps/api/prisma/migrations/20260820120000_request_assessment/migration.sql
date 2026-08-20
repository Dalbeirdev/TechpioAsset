-- v2.25 request assessment: the commercial side of a request, entered
-- internally by Office Admin / Finance / Super Admin. The employee never
-- supplies any of it.

-- CreateTable
CREATE TABLE "request_assessments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "inventoryAvailable" BOOLEAN,
    "suitableAssetId" TEXT,
    "purchaseRequired" BOOLEAN,
    "suggestedProduct" TEXT,
    "vendorId" TEXT,
    "unitPrice" DECIMAL(14,2),
    "quantity" INTEGER,
    "taxAmount" DECIMAL(14,2),
    "shipping" DECIMAL(14,2),
    "discount" DECIMAL(14,2),
    "totalCost" DECIMAL(14,2),
    "currency" CHAR(3),
    "notes" TEXT,
    "assessedById" TEXT,
    "assessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "request_assessments_requestId_key" ON "request_assessments"("requestId");

-- CreateIndex
CREATE INDEX "request_assessments_companyId_idx" ON "request_assessments"("companyId");

-- AddForeignKey
ALTER TABLE "request_assessments" ADD CONSTRAINT "request_assessments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_assessments" ADD CONSTRAINT "request_assessments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "asset_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_assessments" ADD CONSTRAINT "request_assessments_suitableAssetId_fkey" FOREIGN KEY ("suitableAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_assessments" ADD CONSTRAINT "request_assessments_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_assessments" ADD CONSTRAINT "request_assessments_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
