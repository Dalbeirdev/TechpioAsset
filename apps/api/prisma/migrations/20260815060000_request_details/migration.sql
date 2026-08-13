-- v2.17: structured context from the dynamic request form.
ALTER TABLE "asset_requests" ADD COLUMN "details" JSONB;
