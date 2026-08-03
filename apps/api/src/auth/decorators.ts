import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@techpioasset/domain';
import type { AuthUser } from '@techpioasset/contracts';

export const IS_PUBLIC_KEY = 'techpioasset:isPublic';
export const REQUIRED_PERMISSIONS_KEY = 'techpioasset:requiredPermissions';

/**
 * Marks a route as reachable without authentication.
 *
 * Authentication is deny-by-default: the guard is global and every route is
 * protected unless it opts out here. The inverse (opt-in protection) leaves a
 * forgotten decorator as an unauthenticated endpoint.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const SKIP_RLS_KEY = 'techpioasset:skipRls';
/**
 * v2.7 R1 - opts a handler/controller out of the per-request tenant GUC.
 * ONLY for the platform plane: its guard is the gate, its reads are
 * deliberately cross-tenant, and the permissive-until-GUC policies allow a
 * GUC-less session by design. Never use this on tenant-facing routes.
 */
export const SkipRls = () => SetMetadata(SKIP_RLS_KEY, true);

/**
 * Requires every listed permission. Multiple decorators are ANDed, matching the
 * principle that a handler touching two resources needs rights to both.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** Injects the authenticated subject resolved by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    return data && user ? user[data] : user;
  },
);
