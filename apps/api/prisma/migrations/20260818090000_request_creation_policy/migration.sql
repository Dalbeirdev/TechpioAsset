-- v2.22: who may raise a request.
--
-- The permission alone could not answer this. requests:create belongs to the
-- Registered Employee system role, and system roles are deliberately immutable
-- (an auditor must be able to trust what a role name means), so there was no
-- way to turn request-raising off - and no way to make an exception for one
-- person without minting a bespoke role for them.
CREATE TYPE "RequestCreationPolicy" AS ENUM ('EVERYONE', 'ADMINS_ONLY');

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "requestPolicy" "RequestCreationPolicy" NOT NULL DEFAULT 'EVERYONE';

-- NULL means "follow the company policy"; true and false are per-person
-- exceptions in either direction.
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "canRaiseRequests" BOOLEAN;
