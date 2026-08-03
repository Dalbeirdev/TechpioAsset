import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_RLS_KEY } from '../../auth/decorators.js';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { AppConfig } from '../../config/config.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getRequestContext } from '../request-context.js';

/**
 * v2.1 Workstream B — activates Row-Level Security tenant isolation.
 *
 * When RLS_ENFORCE is on, every authenticated HTTP request runs inside a
 * transaction with `app.tenant_id` set (via PrismaService.runInTenant), so the
 * RLS policies scope all of its queries to the caller's tenant — a backstop under
 * the app-layer tenant filters. Requires the app to connect as a non-superuser
 * role (see deploy/rls-app-role.sql); superusers bypass RLS.
 *
 * Registered innermost so it wraps only the handler; the response envelope is
 * applied after the transaction commits. Off by default → pure passthrough.
 */
@Injectable()
export class RlsTenantInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.config.get('RLS_ENFORCE') || context.getType() !== 'http') {
      return next.handle();
    }
    // v2.7 R1: the platform plane reads across tenants by design; scoping it
    // to the operator's own company would silently hide every other tenant.
    // GUC-less is safe here because the policies are permissive-until-GUC and
    // PlatformGuard is the gate.
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RLS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    // No tenant on public/unauthenticated routes — nothing to scope.
    const companyId = getRequestContext()?.companyId;
    if (!companyId) return next.handle();

    return from(this.prisma.runInTenant(companyId, () => lastValueFrom(next.handle())));
  }
}
