import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@techpioasset/domain';
import type { AuthUser } from '@techpioasset/contracts';

export const IS_PUBLIC_KEY = 'techpioasset:isPublic';
export const REQUIRED_PERMISSIONS_KEY = 'techpioasset:requiredPermissions';
export const REQUIRED_ANY_PERMISSIONS_KEY = 'techpioasset:requiredAnyPermissions';

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

/**
 * Requires at least ONE of the listed permissions (v2.27).
 *
 * For a handler that serves two audiences whose rights differ - deciding a
 * request needs `requests:approve` to approve it and `requests:decline` to
 * refuse it, and the two are held by different roles. ANDing them would lock
 * out both; dropping the decorator would leave the route open to any signed-in
 * user and push the whole check into the service.
 *
 * This is the door, not the decision: the handler must still enforce which of
 * the two the caller actually holds against what they are asking to do.
 */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_ANY_PERMISSIONS_KEY, permissions);

/** Injects the authenticated subject resolved by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    return data && user ? user[data] : user;
  },
);
