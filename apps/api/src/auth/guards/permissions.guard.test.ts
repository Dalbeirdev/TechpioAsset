import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { PermissionsGuard } from './permissions.guard.js';

function makeContext(user: Partial<AuthUser> | undefined, required: string[]) {
  const reflector = { getAllAndMerge: () => required } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return { guard: new PermissionsGuard(reflector), context };
}

const base = (over: Partial<AuthUser>): Partial<AuthUser> => ({
  id: 'u1',
  roles: [],
  permissions: [],
  scope: 'ALL',
  ...over,
});

describe('PermissionsGuard — read-only Auditor invariant (v2.1 WS-C)', () => {
  it('blocks a read-only role from a WRITE permission even when the permission is held (RBAC-018)', () => {
    // Misconfiguration: the write permission is present in the held set.
    const user = base({ roles: ['AUDITOR'], permissions: [PERMISSIONS.ASSETS_UPDATE] });
    const { guard, context } = makeContext(user, [PERMISSIONS.ASSETS_UPDATE]);
    expect(() => guard.canActivate(context)).toThrowError(/read-only/i);
  });

  it('blocks a read-only role from a write action it does NOT hold (deny-by-default still applies)', () => {
    const user = base({ roles: ['AUDITOR'], permissions: [PERMISSIONS.ASSETS_READ] });
    const { guard, context } = makeContext(user, [PERMISSIONS.ASSETS_ASSIGN]);
    expect(() => guard.canActivate(context)).toThrowError(/read-only/i);
  });

  it('allows a read-only role a READ permission it holds (RBAC-020)', () => {
    const user = base({ roles: ['AUDITOR'], permissions: [PERMISSIONS.ASSETS_READ] });
    const { guard, context } = makeContext(user, [PERMISSIONS.ASSETS_READ]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('still enforces missing READ permission for a read-only role (normal 403, not the invariant)', () => {
    const user = base({ roles: ['AUDITOR'], permissions: [] });
    const { guard, context } = makeContext(user, [PERMISSIONS.ASSETS_READ]);
    expect(() => guard.canActivate(context)).toThrowError(/do not have permission/i);
  });

  it('does not affect a non-read-only role with the write permission held', () => {
    const user = base({ roles: ['IT_ADMIN'], permissions: [PERMISSIONS.ASSETS_UPDATE] });
    const { guard, context } = makeContext(user, [PERMISSIONS.ASSETS_UPDATE]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('is a no-op when the route declares no permissions', () => {
    const user = base({ roles: ['AUDITOR'], permissions: [] });
    const { guard, context } = makeContext(user, []);
    expect(guard.canActivate(context)).toBe(true);
  });
});
