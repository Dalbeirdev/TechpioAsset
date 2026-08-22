import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '@techpioasset/contracts';
import { READ_ONLY_ROLES, isReadOnlyPermission, type Permission } from '@techpioasset/domain';
import { AppError } from '../../common/errors/app-error.js';
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from '../decorators.js';

const READ_ONLY_ROLE_SET: ReadonlySet<string> = new Set(READ_ONLY_ROLES);

/**
 * Enforces @RequirePermissions.
 *
 * Runs after JwtAuthGuard. A route with no declared permissions is reachable by
 * any authenticated user - useful for "my own profile" style endpoints, which
 * carry their own ownership checks in the service layer.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndMerge<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndMerge<Permission[]>(REQUIRED_ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const declared = [...(required ?? []), ...(requiredAny ?? [])];
    if (declared.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');

    // v2.1 Workstream C — hard read-only invariant. A read-only role (Auditor)
    // can never pass a write permission, and this is checked BEFORE the held set,
    // so granting the permission string onto the role does not override it
    // (blueprint Roles §3.1; RBAC-017/018). Belt-and-suspenders over the grant-time
    // check in @techpioasset/domain — the gateway refuses the mutation regardless.
    // Every declared permission counts here, whether required outright or as one
    // of an any-of set: a route offering a write is closed to a read-only role
    // even by the alternative that would otherwise have let them in.
    if (user.roles.some((role) => READ_ONLY_ROLE_SET.has(role))) {
      const writeRequired = declared.filter((permission) => !isReadOnlyPermission(permission));
      if (writeRequired.length > 0) {
        throw new AppError('FORBIDDEN', 'This role is read-only and cannot perform write actions', {
          internalContext: { readOnlyViolation: writeRequired, userId: user.id },
        });
      }
    }

    const held = new Set(user.permissions);
    const missing = (required ?? []).filter((permission) => !held.has(permission));
    // An any-of set is satisfied by one match; an empty set imposes nothing.
    const missingAny =
      requiredAny && requiredAny.length > 0 && !requiredAny.some((p) => held.has(p))
        ? requiredAny
        : [];

    if (missing.length > 0 || missingAny.length > 0) {
      throw new AppError('FORBIDDEN', 'You do not have permission to perform this action', {
        // The missing permission keys are logged, not returned: telling a caller
        // exactly which grant would unlock an endpoint maps the authorisation
        // model for them.
        internalContext: { missing, missingAny, userId: user.id },
      });
    }

    return true;
  }
}
