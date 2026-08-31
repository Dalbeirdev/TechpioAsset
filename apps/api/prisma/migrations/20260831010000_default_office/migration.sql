-- A default site per company (v2.28).
--
-- Handover paperwork carries a location, and 154 of 158 assets in production
-- have none - so the column printed blank on almost every row. A blank there
-- does not read as "not recorded", it reads as "we have lost track of this
-- equipment", which for a company operating from one building is alarming and
-- untrue.
--
-- Set by a Super Admin rather than inferred. "The office with the most assets"
-- would have worked today and silently moved the default the first time a
-- second site grew.

ALTER TABLE "offices" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- At most one default per company. A partial index rather than a plain unique
-- constraint, because every company has many non-default offices and those must
-- not collide with each other.
CREATE UNIQUE INDEX "offices_one_default_per_company"
  ON "offices" ("companyId")
  WHERE "isDefault" AND "deletedAt" IS NULL;

-- Adopt a default only where the data already says which site it is: either the
-- company has exactly one office, or exactly one of its offices holds any
-- equipment. Both are statements about where the kit demonstrably is, not
-- guesses.
--
-- In production this resolves to Mohali. Chennai exists as a record but holds
-- nothing, so "the only office with assets" is unambiguous - which is why the
-- rule is written on assets held rather than on office count alone, where two
-- sites would have produced no default at all.
--
-- A company genuinely split across two active sites gets a blank until a Super
-- Admin chooses. That is the honest outcome: picking for them would put a guess
-- onto handover paperwork.
WITH resolved AS (
  SELECT o."companyId", min(o.id) AS office_id
  FROM "offices" o
  WHERE o."deletedAt" IS NULL
  GROUP BY o."companyId"
  HAVING count(*) = 1

  UNION

  SELECT o."companyId", min(o.id) AS office_id
  FROM "offices" o
  WHERE o."deletedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "assets" a
      WHERE a."officeId" = o.id AND a."deletedAt" IS NULL
    )
  GROUP BY o."companyId"
  HAVING count(*) = 1
)
UPDATE "offices" o
SET "isDefault" = true
FROM resolved r
WHERE o.id = r.office_id
  -- Guard the partial unique index: if both arms of the UNION resolved for one
  -- company they name the same office, but a company must never get two.
  AND NOT EXISTS (
    SELECT 1 FROM "offices" d
    WHERE d."companyId" = o."companyId" AND d."isDefault" AND d."deletedAt" IS NULL
  );
