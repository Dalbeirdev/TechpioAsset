-- Sort names the way people read them (v2.27).
--
-- The database is C-collated, which orders by byte value: every capital letter
-- sorts before every lowercase one. Sorting the asset list by name put DELL
-- above "Del latitude", and sorting by holder put every ALL-CAPS name from the
-- import above every normally-cased one. Correct by the rule the database was
-- given, and wrong by every expectation of an alphabetical list.
--
-- Fixed per column rather than per database: changing a database's collation
-- means recreating it, and only a handful of columns are ever ordered as text.
--
-- `und-x-icu` is the ICU root locale - language-neutral, which matters here
-- because the data already holds Japanese and Cyrillic names alongside Latin
-- ones, and pinning to en-US would order those by an English rulebook.
--
-- It is DETERMINISTIC, which is the property that makes this safe:
--   * LIKE and pattern matching still work. A non-deterministic collation - the
--     kind that makes 'a' and 'A' genuinely equal - is rejected by Postgres for
--     LIKE, and the asset search uses exactly that.
--   * Equality and uniqueness keep byte semantics, so nothing that was distinct
--     becomes a duplicate.
-- It changes ordering only, which is all that was wrong.
--
-- None of these columns carries an index or constraint, so nothing is rebuilt.
-- Prisma does not model collation, so this lives only here and is invisible to
-- the schema file; a future migration that recreates one of these columns would
-- silently drop back to C.

ALTER TABLE "assets"        ALTER COLUMN "name"      TYPE text COLLATE "und-x-icu";
ALTER TABLE "categories"    ALTER COLUMN "name"      TYPE text COLLATE "und-x-icu";
ALTER TABLE "departments"   ALTER COLUMN "name"      TYPE text COLLATE "und-x-icu";
ALTER TABLE "user_profiles" ALTER COLUMN "firstName" TYPE text COLLATE "und-x-icu";
ALTER TABLE "user_profiles" ALTER COLUMN "lastName"  TYPE text COLLATE "und-x-icu";
