-- v2.15: operator-console AI provider settings. Additive.
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "endpoint" TEXT,
    "model" TEXT,
    "apiKeyEncrypted" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);
