-- v2.20 asset types & specifications.
--
-- Identity first: MAC address and IMEI become real columns with per-company
-- unique indexes, so the database itself refuses to register the same phone or
-- machine twice. Postgres treats NULLs as distinct, so existing assets (and
-- every quantity-tracked item) coexist happily without one.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "macAddress" TEXT;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "imei" TEXT;

-- Specification lives in JSON: the field list per type will keep growing and
-- none of it needs an index, so adding one later must not need a migration.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "specs" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "assets_companyId_macAddress_key"
  ON "assets" ("companyId", "macAddress");
CREATE UNIQUE INDEX IF NOT EXISTS "assets_companyId_imei_key"
  ON "assets" ("companyId", "imei");

-- The Category -> Type chain shipped with no types defined in production, which
-- left the Type box permanently disabled. Seed the catalogue for every existing
-- company. Keys match the reference seed, so a tenant that already has these
-- types keeps its rows and simply gains the missing ones.
INSERT INTO "subcategories" ("id", "categoryId", "key", "name", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."id",
  t.key,
  t.name,
  t.ord,
  true,
  now(),
  now()
FROM "categories" c
CROSS JOIN (VALUES
    ('laptop', 'Laptop', 'it-assets', 10),
    ('desktop', 'Desktop', 'it-assets', 20),
    ('monitor', 'Monitor / Screen', 'it-assets', 30),
    ('mobile-phone', 'Mobile Phone', 'it-assets', 40),
    ('tablet', 'Tablet', 'it-assets', 50),
    ('keyboard', 'Keyboard', 'it-assets', 60),
    ('mouse', 'Mouse', 'it-assets', 70),
    ('headset', 'Headset', 'it-assets', 80),
    ('docking-station', 'Docking Station', 'it-assets', 90),
    ('printer', 'Printer', 'it-assets', 100),
    ('network-switch', 'Network Switch', 'it-assets', 110),
    ('firewall', 'Firewall', 'it-assets', 120),
    ('ups', 'UPS / Power Backup', 'it-assets', 130),
    ('external-storage', 'External storage', 'it-assets', 140),
    ('projector', 'Projector', 'it-assets', 150),
    ('cable', 'Cable', 'it-assets', 160),
    ('charger', 'Charger', 'it-assets', 170),
    ('adapter', 'Adapter', 'it-assets', 180),
    ('scanner', 'Scanner', 'it-assets', 190),
    ('server', 'Server', 'it-assets', 200),
    ('wireless-access-point', 'Wireless access point', 'it-assets', 210)
) AS t(key, name, category_key, ord)
WHERE c."key" = t.category_key AND c."deletedAt" IS NULL
ON CONFLICT ("categoryId", "key") DO NOTHING;
