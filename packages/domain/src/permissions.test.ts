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
  resolveEffectiveScope,
  permissionModule,
  permissionMatches,
  grantsSatisfy,
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

  it('shares tenant-admin permissions only with the Company Admin (tenant owner)', () => {
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
      expect([...holders].sort(), `${permission} escaped the admin roles`).toEqual([
        'COMPANY_ADMIN',
        'SUPER_ADMIN',
      ]);
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
  it('holds invoices:verify alongside the Super Admin and Company Admin only', () => {
    const holders = SYSTEM_ROLES.filter((r) => roleHasPermission(r, P.INVOICES_VERIFY));
    expect([...holders].sort()).toEqual(['COMPANY_ADMIN', 'FINANCE', 'SUPER_ADMIN']);
  });
});

describe('resolvePermissions / resolveScope', () => {
  it('unions permissions across roles', () => {
    const resolved = resolvePermissions(['EMPLOYEE', 'MANAGER']);
    expect(resolved.has(P.REQUESTS_APPROVE)).toBe(true);
    // From EMPLOYEE's side of the union (v2.12: the dead maintenance:request
    // grant was removed from EMPLOYEE - no endpoint ever enforced it).
    expect(resolved.has(P.REQUESTS_CANCEL)).toBe(true);
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

describe('resolveEffectiveScope (v2.1 per-assignment override)', () => {
  it('uses the role default when no override is given', () => {
    expect(resolveEffectiveScope([{ roleKey: 'MANAGER' }])).toBe('DIRECT_REPORTS');
    expect(resolveEffectiveScope([{ roleKey: 'EMPLOYEE' }])).toBe('OWN');
    expect(resolveEffectiveScope([{ roleKey: 'IT_ADMIN' }])).toBe('ALL');
  });

  it('a per-assignment override widens or narrows that assignment', () => {
    // Widen a Manager (default DIRECT_REPORTS) to ALL for this user.
    expect(resolveEffectiveScope([{ roleKey: 'MANAGER', scopeOverride: 'ALL' }])).toBe('ALL');
    // Narrow an IT_ADMIN (default ALL) to DEPARTMENT for this user.
    expect(resolveEffectiveScope([{ roleKey: 'IT_ADMIN', scopeOverride: 'DEPARTMENT' }])).toBe(
      'DEPARTMENT',
    );
  });

  it('widest across assignments wins, like resolveScope', () => {
    expect(
      resolveEffectiveScope([
        { roleKey: 'EMPLOYEE' },
        { roleKey: 'MANAGER', scopeOverride: 'DEPARTMENT' },
      ]),
    ).toBe('DEPARTMENT');
  });

  it('unknown/custom roles fail closed to OWN', () => {
    expect(resolveEffectiveScope([{ roleKey: 'CUSTOM_ROLE' }])).toBe('OWN');
    // …but an explicit override on a custom role is honoured.
    expect(resolveEffectiveScope([{ roleKey: 'CUSTOM_ROLE', scopeOverride: 'DEPARTMENT' }])).toBe(
      'DEPARTMENT',
    );
  });

  it('with no overrides equals resolveScope over the same known roles', () => {
    expect(resolveEffectiveScope([{ roleKey: 'EMPLOYEE' }, { roleKey: 'FINANCE' }])).toBe(
      resolveScope(['EMPLOYEE', 'FINANCE']),
    );
  });

  it('empty assignments resolve to OWN', () => {
    expect(resolveEffectiveScope([])).toBe('OWN');
  });
});

describe('module:resource:action taxonomy (v2.1 WS-C)', () => {
  it('maps every catalogue permission to a module', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permissionModule(permission), permission).toBeTruthy();
    }
    expect(permissionModule('assets:read')).toBe('assets');
    expect(permissionModule('invoices:verify')).toBe('procurement');
    expect(permissionModule('purchase-orders:manage')).toBe('procurement');
    expect(permissionModule('users:manage')).toBe('admin');
    expect(permissionModule('audit:read')).toBe('audit');
  });

  it('an exact grant matches only itself', () => {
    expect(permissionMatches('assets:read', 'assets:read')).toBe(true);
    expect(permissionMatches('assets:read', 'assets:update')).toBe(false);
  });

  it('a trailing wildcard covers one-or-more remaining segments', () => {
    expect(permissionMatches('assets:*', 'assets:read')).toBe(true);
    expect(permissionMatches('assets:*', 'assets:cost:read')).toBe(true);
    expect(permissionMatches('assets:*', 'invoices:read')).toBe(false);
    // `assets:*` needs at least one more segment — bare `assets` does not match.
    expect(permissionMatches('assets:*', 'assets')).toBe(false);
  });

  it('a lone `*` matches everything; a middle wildcard matches one segment', () => {
    expect(permissionMatches('*', 'anything:at:all')).toBe(true);
    expect(permissionMatches('assets:*:read', 'assets:cost:read')).toBe(true);
    expect(permissionMatches('assets:*:read', 'assets:cost:write')).toBe(false);
  });

  it('grantsSatisfy resolves a required permission against a wildcard grant set', () => {
    expect(grantsSatisfy(['reports:read', 'assets:*'], 'assets:dispose')).toBe(true);
    expect(grantsSatisfy(['reports:read', 'assets:*'], 'invoices:verify')).toBe(false);
    expect(grantsSatisfy(['*'], 'anything:goes')).toBe(true);
  });
});

describe('canonical 13-role model (v2.1 WS-C)', () => {
  it('defines exactly the 13 canonical roles', () => {
    expect(SYSTEM_ROLES).toHaveLength(13);
    for (const role of [
      'COMPANY_ADMIN',
      'IT_TECHNICIAN',
      'PROCUREMENT_MANAGER',
      'INVENTORY_MANAGER',
      'VENDOR',
    ] as const) {
      expect(SYSTEM_ROLES).toContain(role);
    }
  });

  it('every role has grants and a default scope (Vendor is an empty placeholder)', () => {
    for (const role of SYSTEM_ROLES) {
      expect(ROLE_PERMISSIONS[role], `${role} grants`).toBeDefined();
      expect(ROLE_DEFAULT_SCOPE[role], `${role} scope`).toBeDefined();
    }
    expect(ROLE_PERMISSIONS.VENDOR).toEqual([]);
    expect(ROLE_DEFAULT_SCOPE.VENDOR).toBe('OWN');
  });

  it('Company Admin is the tenant sovereign (grant-equivalent to Super Admin in v1)', () => {
    expect([...ROLE_PERMISSIONS.COMPANY_ADMIN].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('IT Technician is a subset of the IT Manager (IT_ADMIN)', () => {
    const itManager = new Set(ROLE_PERMISSIONS.IT_ADMIN);
    for (const p of ROLE_PERMISSIONS.IT_TECHNICIAN) expect(itManager.has(p)).toBe(true);
  });

  it('the read-only invariant still applies to exactly the Auditor', () => {
    expect(READ_ONLY_ROLES).toEqual(['AUDITOR']);
  });
});
