import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '@techpioasset/contracts';
import { AppConfig } from '../config/config.module.js';

/**
 * v2.6 A4 — the platform-plane gate (plan invariant 4).
 *
 * DELIBERATELY outside the tenant permission matrix: platform access is
 * operator-designated via PLATFORM_ADMIN_EMAILS, granted to no tenant role —
 * a tenant Super Admin is not a platform admin. An empty list disables the
 * plane entirely. Runs after the JWT guard, so request.user is authenticated.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const email = request.user?.email?.toLowerCase();
    const allowed = this.config
      .get('PLATFORM_ADMIN_EMAILS')
      .split(',')
      .map((entry: string) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (!email || !allowed.includes(email)) {
      throw new ForbiddenException('The platform plane is operator-designated');
    }
    return true;
  }
}
