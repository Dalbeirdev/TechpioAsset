-- A short route for damage (v2.27).
--
-- DAMAGE had no definition of its own, so it fell to the catch-all: reporting a
-- broken laptop travelled the same six steps as asking for a brand new one -
-- manager, HR, IT, stock, costing, Finance.
--
-- Manager review and HR confirmation are dropped for the same reason: this
-- device was already authorised once. HR confirms employment before someone is
-- issued equipment, and they already have it; a manager authorises new spend
-- for a report, and restoring already-approved kit is not a new want. Control
-- over money is not lost - it sits with the Finance threshold, which is the
-- step that actually governs spending.
--
-- Usually two steps in practice: if there is a spare on the shelf, the
-- inventory check answers yes and both the costing and Finance stand aside.
--
-- Written per company and guarded, so it is safe on a tenant that already has
-- one and safe to run twice.

INSERT INTO "workflow_definitions" ("id", "companyId", "key", "name", "description", "requestType", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."id",
  'damage',
  'Damage report',
  'Kit that is already issued and has broken. IT decides repair or replace, stock is checked, and only a purchase reaches Finance.',
  'DAMAGE',
  true,
  now(),
  now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "workflow_definitions" d
  WHERE d."companyId" = c."id" AND d."requestType" = 'DAMAGE'
);

-- Steps. approverRoleId resolves per company, so a tenant missing one of these
-- roles still gets the step - it routes to nobody and the API's existing
-- fallback tells the user-managers, rather than the step vanishing silently.

INSERT INTO "workflow_steps" ("id", "workflowDefinitionId", "stepOrder", "name", "kind", "approverType", "approverRoleId", "costThreshold", "isSkippable", "slaHours", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text, d."id", s."ord", s."name", s."kind"::"WorkflowStepKind", 'ROLE'::"ApproverType",
  (SELECT r."id" FROM "roles" r WHERE r."companyId" = d."companyId" AND r."key" = s."roleKey" LIMIT 1),
  s."threshold", s."skippable", s."sla", now(), now()
FROM "workflow_definitions" d
CROSS JOIN (VALUES
  (1, 'IT review',        'APPROVAL',        'IT_ADMIN',     NULL::numeric(14,2), false, 24),
  (2, 'Inventory check',  'INVENTORY_CHECK', 'OFFICE_ADMIN', NULL::numeric(14,2), false, 48),
  (3, 'Cost assessment',  'COST_ASSESSMENT', 'OFFICE_ADMIN', NULL::numeric(14,2), false, 48),
  (4, 'Finance approval', 'APPROVAL',        'FINANCE',      250.00,              true,  48)
) AS s("ord", "name", "kind", "roleKey", "threshold", "skippable", "sla")
WHERE d."key" = 'damage'
  AND d."requestType" = 'DAMAGE'
  AND NOT EXISTS (
    SELECT 1 FROM "workflow_steps" w
    WHERE w."workflowDefinitionId" = d."id" AND w."stepOrder" = s."ord"
  );
