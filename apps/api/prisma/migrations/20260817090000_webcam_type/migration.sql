-- v2.21: webcams turned up in the imported accessory columns and had no type,
-- so those rows had nowhere to land. Same idempotent shape as the first seed.
INSERT INTO "subcategories" ("id", "categoryId", "key", "name", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", 'webcam', 'Webcam', 220, true, now(), now()
FROM "categories" c
WHERE c."key" = 'it-assets' AND c."deletedAt" IS NULL
ON CONFLICT ("categoryId", "key") DO NOTHING;
