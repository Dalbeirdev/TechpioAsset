-- Vendor catalog (v2.42): vendor offers, their images, review decisions
-- and the snapshot taken when an offer is selected.
--
-- Purely additive: 4 new tables, 3 new enums, their indexes and foreign
-- keys. Nothing existing is dropped or altered. An unrelated pre-existing
-- drift on notification_rules defaults was deliberately excluded - it does
-- not belong in a feature migration.

-- CreateEnum
CREATE TYPE "VendorProductCondition" AS ENUM ('NEW', 'REFURBISHED', 'OPEN_BOX', 'OTHER');

-- CreateEnum
CREATE TYPE "VendorProductStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'EXPIRING_SOON', 'OUT_OF_STOCK', 'EXPIRED', 'PAUSED', 'REJECTED', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "VendorProductReviewDecision" AS ENUM ('APPROVED', 'REJECTED', 'RETURNED_TO_VENDOR', 'CORRECTION_REQUESTED');


-- CreateTable
CREATE TABLE "vendor_products" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "brand" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "vendorSku" TEXT,
    "mpn" TEXT,
    "description" TEXT,
    "condition" "VendorProductCondition" NOT NULL DEFAULT 'NEW',
    "specs" JSONB,
    "youtubeVideoId" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "gstPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "installationCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "landedCost" DECIMAL(14,2) NOT NULL,
    "minOrderQuantity" INTEGER NOT NULL DEFAULT 1,
    "availableQuantity" INTEGER NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "leadTimeDays" INTEGER,
    "warrantyMonths" INTEGER,
    "availableFrom" TIMESTAMP(3) NOT NULL,
    "availableUntil" TIMESTAMP(3) NOT NULL,
    "status" "VendorProductStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vendor_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_product_images" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorProductId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,

    CONSTRAINT "vendor_product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_product_reviews" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorProductId" TEXT NOT NULL,
    "decision" "VendorProductReviewDecision" NOT NULL,
    "comments" TEXT,
    "reviewedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_selections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorProductId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "purchaseRequestId" TEXT,
    "assetRequestId" TEXT,
    "quantity" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "gstPercent" DECIMAL(5,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL,
    "shippingCost" DECIMAL(14,2) NOT NULL,
    "installationCost" DECIMAL(14,2) NOT NULL,
    "otherCharges" DECIMAL(14,2) NOT NULL,
    "landedCost" DECIMAL(14,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "productName" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "specsSnapshot" JSONB,
    "warrantyMonths" INTEGER,
    "availableUntil" TIMESTAMP(3) NOT NULL,
    "primaryImageStorageKey" TEXT,
    "selectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deselectedAt" TIMESTAMP(3),
    "deselectedById" TEXT,

    CONSTRAINT "procurement_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_products_companyId_status_idx" ON "vendor_products"("companyId", "status");

-- CreateIndex
CREATE INDEX "vendor_products_companyId_vendorId_idx" ON "vendor_products"("companyId", "vendorId");

-- CreateIndex
CREATE INDEX "vendor_products_companyId_categoryId_status_idx" ON "vendor_products"("companyId", "categoryId", "status");

-- CreateIndex
CREATE INDEX "vendor_products_companyId_availableUntil_idx" ON "vendor_products"("companyId", "availableUntil");

-- CreateIndex
CREATE INDEX "vendor_product_images_companyId_vendorProductId_idx" ON "vendor_product_images"("companyId", "vendorProductId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_product_images_vendorProductId_sortOrder_key" ON "vendor_product_images"("vendorProductId", "sortOrder");

-- CreateIndex
CREATE INDEX "vendor_product_reviews_companyId_vendorProductId_idx" ON "vendor_product_reviews"("companyId", "vendorProductId");

-- CreateIndex
CREATE INDEX "procurement_selections_companyId_vendorProductId_idx" ON "procurement_selections"("companyId", "vendorProductId");

-- CreateIndex
CREATE INDEX "procurement_selections_companyId_purchaseRequestId_idx" ON "procurement_selections"("companyId", "purchaseRequestId");

-- CreateIndex
CREATE INDEX "procurement_selections_companyId_assetRequestId_idx" ON "procurement_selections"("companyId", "assetRequestId");

-- AddForeignKey
ALTER TABLE "vendor_products" ADD CONSTRAINT "vendor_products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_products" ADD CONSTRAINT "vendor_products_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_products" ADD CONSTRAINT "vendor_products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_products" ADD CONSTRAINT "vendor_products_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_product_images" ADD CONSTRAINT "vendor_product_images_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_product_images" ADD CONSTRAINT "vendor_product_images_vendorProductId_fkey" FOREIGN KEY ("vendorProductId") REFERENCES "vendor_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_product_reviews" ADD CONSTRAINT "vendor_product_reviews_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_product_reviews" ADD CONSTRAINT "vendor_product_reviews_vendorProductId_fkey" FOREIGN KEY ("vendorProductId") REFERENCES "vendor_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_product_reviews" ADD CONSTRAINT "vendor_product_reviews_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_selections" ADD CONSTRAINT "procurement_selections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_selections" ADD CONSTRAINT "procurement_selections_vendorProductId_fkey" FOREIGN KEY ("vendorProductId") REFERENCES "vendor_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_selections" ADD CONSTRAINT "procurement_selections_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_selections" ADD CONSTRAINT "procurement_selections_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_selections" ADD CONSTRAINT "procurement_selections_assetRequestId_fkey" FOREIGN KEY ("assetRequestId") REFERENCES "asset_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_selections" ADD CONSTRAINT "procurement_selections_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

