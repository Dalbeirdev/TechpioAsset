-- v2.25 - the assessment stages become part of the standard chain.
--
-- New tenants already get them from the workflow templates. This brings the
-- catch-all definition of every EXISTING company up to the same shape, because
-- a process that only applies to companies onboarded after a certain Tuesday
-- is not a default - it is an accident of timing.
--
-- Deliberately narrow. Only the catch-all workflow (requestType IS NULL), which
-- is the chain most request types fall to. Workflows a company has configured
-- for itself are left exactly as they are: overriding somebody's own
-- configuration in a migration is not a default, it is a reversal.
--
-- Idempotent: a definition that already has an assessment stage is skipped, so
-- re-running changes nothing.
DO $$
DECLARE
  def       RECORD;
  role_id   TEXT;
  insert_at INT;
BEGIN
  FOR def IN
    SELECT wd.id, wd."companyId"
    FROM workflow_definitions wd
    WHERE wd."requestType" IS NULL
      AND wd."isActive" = true
      AND NOT EXISTS (
        SELECT 1 FROM workflow_steps s
        WHERE s."workflowDefinitionId" = wd.id AND s.kind <> 'APPROVAL'
      )
  LOOP
    SELECT id INTO role_id
    FROM roles
    WHERE "companyId" = def."companyId" AND key = 'OFFICE_ADMIN'
    LIMIT 1;

    -- No office administrator to do the work: leave the chain alone rather
    -- than create two steps nobody can complete.
    CONTINUE WHEN role_id IS NULL;

    -- Immediately before the first thresholded step, whose answer these stages
    -- exist to supply; with no thresholded step, at the end.
    SELECT COALESCE(
             MIN("stepOrder") FILTER (WHERE "costThreshold" IS NOT NULL),
             MAX("stepOrder") + 1,
             1
           )
      INTO insert_at
      FROM workflow_steps
     WHERE "workflowDefinitionId" = def.id;

    -- Park the existing steps so the numbering space is free: (definition,
    -- stepOrder) is unique, so there is no room to insert in place.
    UPDATE workflow_steps
       SET "stepOrder" = "stepOrder" + 1000
     WHERE "workflowDefinitionId" = def.id;

    INSERT INTO workflow_steps
      (id, "workflowDefinitionId", "stepOrder", name, "approverType", "approverRoleId",
       kind, "slaHours", "isSkippable", "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid()::text, def.id, insert_at,     'Inventory check', 'ROLE', role_id,
       'INVENTORY_CHECK', 48, false, now(), now()),
      (gen_random_uuid()::text, def.id, insert_at + 1, 'Cost assessment', 'ROLE', role_id,
       'COST_ASSESSMENT', 48, false, now(), now());

    -- Renumber 1..n.
    --
    -- Both new stages have to land in the gap immediately BEFORE the parked
    -- step they were inserted at, and in their own order. Sorting them by their
    -- literal stepOrder does not do that: the second one (insert_at + 1) sorts
    -- past the parked step at insert_at, which puts Cost assessment after
    -- Finance approval - caught rehearsing this against a copy of production.
    WITH ordered AS (
      SELECT id,
             row_number() OVER (
               ORDER BY CASE
                          WHEN "stepOrder" > 1000 THEN ("stepOrder" - 1000)::numeric + 0.5
                          WHEN kind = 'INVENTORY_CHECK' THEN insert_at::numeric - 0.2
                          ELSE insert_at::numeric - 0.1
                        END
             ) AS position
        FROM workflow_steps
       WHERE "workflowDefinitionId" = def.id
    )
    UPDATE workflow_steps s
       SET "stepOrder" = ordered.position + 2000
      FROM ordered
     WHERE s.id = ordered.id;

    UPDATE workflow_steps
       SET "stepOrder" = "stepOrder" - 2000
     WHERE "workflowDefinitionId" = def.id;
  END LOOP;
END $$;
