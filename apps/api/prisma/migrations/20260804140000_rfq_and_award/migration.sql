-- v2.9 C3 - RFQ and award. (ASCII only: the shadow DB runs WIN1252.)

CREATE TYPE "QuoteRequestStatus" AS ENUM ('SENT', 'AWARDED', 'CANCELLED');
CREATE TYPE "QuoteStatus" AS ENUM ('INVITED', 'RECEIVED', 'DECLINED', 'AWARDED', 'LOST');

ALTER TYPE "AuditAction" ADD VALUE 'RFQ_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'RFQ_QUOTE_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'RFQ_AWARDED';
ALTER TYPE "AuditAction" ADD VALUE 'RFQ_CANCELLED';

CREATE TABLE "quote_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rfqNumber" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'SENT',
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "awardedQuoteId" TEXT,
    "awardReason" TEXT,
    "awardedById" TEXT,
    "awardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'INVITED',
    "reference" TEXT,
    "currency" CHAR(3),
    "subtotal" DECIMAL(14,2),
    "total" DECIMAL(14,2),
    "leadTimeDays" INTEGER,
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3),
    "convertedPoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_lines" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "purchaseRequestLineId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quote_requests_companyId_rfqNumber_key" ON "quote_requests"("companyId", "rfqNumber");
CREATE UNIQUE INDEX "quote_requests_awardedQuoteId_key" ON "quote_requests"("awardedQuoteId");
CREATE INDEX "quote_requests_companyId_status_idx" ON "quote_requests"("companyId", "status");
CREATE UNIQUE INDEX "quotes_quoteRequestId_vendorId_key" ON "quotes"("quoteRequestId", "vendorId");
CREATE INDEX "quotes_companyId_status_idx" ON "quotes"("companyId", "status");
CREATE UNIQUE INDEX "quote_lines_quoteId_lineNumber_key" ON "quote_lines"("quoteId", "lineNumber");

ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_purchaseRequestId_fkey"
  FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_awardedQuoteId_fkey"
  FOREIGN KEY ("awardedQuoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_quoteRequestId_fkey"
  FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_convertedPoId_fkey"
  FOREIGN KEY ("convertedPoId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_purchaseRequestLineId_fkey"
  FOREIGN KEY ("purchaseRequestLineId") REFERENCES "purchase_request_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- THE BACKSTOP for the release's third invariant: a losing quote can never
-- become a purchase order. Only a quote the database agrees is AWARDED may
-- carry the order it produced.
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_only_awarded_converts"
  CHECK ("convertedPoId" IS NULL OR "status" = 'AWARDED');

-- An award is complete or absent: no half-recorded decision, and never a
-- reasonless one, because "why this vendor?" is the whole point of the record.
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_award_complete"
  CHECK (
    ("awardedQuoteId" IS NULL AND "awardedAt" IS NULL AND "awardReason" IS NULL)
    OR ("awardedQuoteId" IS NOT NULL AND "awardedAt" IS NOT NULL AND "awardReason" IS NOT NULL)
  );

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_totals_not_negative"
  CHECK (("subtotal" IS NULL OR "subtotal" >= 0) AND ("total" IS NULL OR "total" >= 0));
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_amounts_not_negative"
  CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "lineTotal" >= 0);

-- Tenant isolation, same permissive-until-GUC policy shape as prior releases.
-- quote_lines has no companyId of its own; it is reachable only through its
-- quote, which is protected, and cascades with it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quote_requests','quotes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL OR "companyId" = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;
