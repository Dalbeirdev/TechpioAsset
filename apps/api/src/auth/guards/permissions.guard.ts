import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '@techpioasset/contracts';
import type { Permission } from '@techpioasset/domain';
import { AppError } from '../../common/errors/app-error.js';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators.js';

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
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');

    const held = new Set(user.permissions);
    const missing = required.filter((permission) => !held.has(permission));

    if (missing.length > 0) {
      throw new AppError('FORBIDDEN', 'You do not have permission to perform this action', {
        // The missing permission keys are logged, not returned: telling a caller
        // exactly which grant would unlock an endpoint maps the authorisation
        // model for them.
        internalContext: { missing, userId: user.id },
      });
    }

    return true;
  }
}
