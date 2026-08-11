-- v2.15: disposal flow. assets:dispose moves from "Super Admin only" to
-- Finance as well - disposal is a financial act (proceeds, write-offs).
--
-- Grants are DB rows resolved at login, so a matrix change in the domain
-- package reaches existing tenants only through data. Idempotent: the
-- composite PK makes a re-run a no-op.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.key = 'FINANCE'
  AND r."isSystem" = true
  AND p.key = 'assets:dispose'
ON CONFLICT DO NOTHING;
