import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS as P,
  ALL_PERMISSIONS,
  SYSTEM_ROLES,
  ROLE_PERMISSIONS,
  ROLE_DEFAULT_SCOPE,
  READ_ONLY_ROLES,
  isReadOnlyPermission,
  assertGrantAllowed,
  roleHasPermission,
  resolvePermissions,
  resolveScope,
  ReadOnlyRoleViolationError,
  type Permission,
} from './permissions';

describe('permission catalogue', () => {
  it('has no duplicate permission strings', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('uses resource:action shape throughout', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission, `${permission} is not resource:action`).toMatch(
        /^[a-z-]+:[a-z-]+(:[a-z-]+)?$/,
      );
    }
  });

  it('grants every role only catalogued permissions', () => {
    const known = new Set<Permission>(ALL_PERMISSIONS);
    for (const role of SYSTEM_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(known.has(permission), `${role} grants unknown ${permission}`).toBe(true);
      }
    }
  });

  it('defines a scope for every role', () => {
    for (const role of SYSTEM_ROLES) {
      expect(ROLE_DEFAULT_SCOPE[role], `${role} has no default scope`).toBeDefined();
    }
  });
});

describe('Super Admin', () => {
  it('holds every permission (spec section 3: full system access)', () => {
    expect([...ROLE_PERMISSIONS.SUPER_ADMIN].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('is the only role that may configure AI, roles or workflows', () => {
    for (const permission of [
      P.AI_CONFIGURE,
      P.ROLES_MANAGE,
      P.PERMISSIONS_MANAGE,
      P.WORKFLOWS_CONFIGURE,
      P.SETTINGS_MANAGE,
      P.USERS_MANAGE,
      P.CATEGORIES_MANAGE,
    ]) {
      const holders = SYSTEM_ROLES.filter((r) => roleHasPermission(r, permission));
      expect(holders, `${permission} escaped Super Admin`).toEqual(['SUPER_ADMIN']);
    }
  });
});

describe('Auditor is structurally read-only (spec section 3)', () => {
  it('holds no write permission', () => {
    for (const permission of ROLE_PERMISSIONS.AUDITOR) {
      expect(isReadOnlyPermission(permission), `${permission} is a write grant`).toBe(true);
    }
  });

  it('refuses a write grant even if an administrator configures one', () => {
    expect(() => assertGrantAllowed('AUDITOR', P.ASSETS_ASSIGN)).toThrow(
      ReadOnlyRoleViolationError,
    );
    expect(() => assertGrantAllowed('AUDITOR', P.INVOICES_VERIFY)).toThrow(
      ReadOnlyRoleViolationError,
    );
    expect(() => assertGrantAllowed('AUDITOR', P.ASSETS_READ)).not.toThrow();
  });

  it('is the only read-only role', () => {
    expect(READ_ONLY_ROLES).toEqual(['AUDITOR']);
  });
});

describe('HR financial separation (spec section 3)', () => {
  it('cannot read invoices or asset cost by default', () => {
    expect(roleHasPermission('HR', P.INVOICES_READ)).toBe(false);
    expect(roleHasPermission('HR', P.ASSETS_COST_READ)).toBe(false);
  });

  it('can still run the people workflows it owns', () => {
    expect(roleHasPermission('HR', P.EMPLOYEES_CREATE)).toBe(true);
    expect(roleHasPermission('HR', P.ONBOARDING_MANAGE)).toBe(true);
    expect(roleHasPermission('HR', P.OFFBOARDING_MANAGE)).toBe(true);
    expect(roleHasPermission('HR', P.REQUESTS_CREATE_ON_BEHALF)).toBe(true);
  });
});

describe('Employee isolation (spec section 3)', () => {
  it('is scoped to OWN', () => {
    expect(ROLE_DEFAULT_SCOPE.EMPLOYEE).toBe('OWN');
  });

  it('cannot read costs, invoices, other employees or audit logs', () => {
    for (const permission of [
      P.ASSETS_COST_READ,
      P.INVOICES_READ,
      P.EMPLOYEES_READ,
      P.AUDIT_READ,
      P.REPORTS_READ,
    ]) {
      expect(roleHasPermission('EMPLOYEE', permission), `EMPLOYEE holds ${permission}`).toBe(false);
    }
  });

  it('cannot assign or approve anything', () => {
    expect(roleHasPermission('EMPLOYEE', P.ASSETS_ASSIGN)).toBe(false);
    expect(roleHasPermission('EMPLOYEE', P.REQUESTS_APPROVE)).toBe(false);
  });
});

describe('Finance is the only invoice verifier (spec section 9: human approval)', () => {
  it('holds invoices:verify alongside Super Admin only', () => {
    const holders = SYSTEM_ROLES.filter((r) => roleHasPermission(r, P.INVOICES_VERIFY));
    expect(holders.sort()).toEqual(['FINANCE', 'SUPER_ADMIN']);
  });
});

describe('resolvePermissions / resolveScope', () => {
  it('unions permissions across roles', () => {
    const resolved = resolvePermissions(['EMPLOYEE', 'MANAGER']);
    expect(resolved.has(P.REQUESTS_APPROVE)).toBe(true);
    expect(resolved.has(P.MAINTENANCE_REQUEST)).toBe(true);
    expect(resolved.has(P.AI_CONFIGURE)).toBe(false);
  });

  it('widens scope to the most permissive role held', () => {
    expect(resolveScope(['EMPLOYEE'])).toBe('OWN');
    expect(resolveScope(['EMPLOYEE', 'MANAGER'])).toBe('DIRECT_REPORTS');
    expect(resolveScope(['EMPLOYEE', 'MANAGER', 'FINANCE'])).toBe('ALL');
  });

  it('returns OWN for a user with no roles', () => {
    expect(resolveScope([])).toBe('OWN');
    expect(resolvePermissions([]).size).toBe(0);
  });
});
