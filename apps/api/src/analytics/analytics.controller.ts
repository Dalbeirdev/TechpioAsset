import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { AnalyticsService } from './analytics.service.js';

const monthsQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});
type MonthsQuery = z.infer<typeof monthsQuerySchema>;

/**
 * v2.6 A1 — read-only aggregates for the exec dashboard. Everything needs
 * analytics:read; spend additionally needs assets:cost:read, asserted in the
 * service so the figure never leaves the server on permission alone.
 */
@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'Headline KPIs: fleet, people, open work, coverage' })
  overview(@CurrentUser() actor: AuthUser) {
    return this.analytics.overview(actor);
  }

  @Get('spend')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({
    summary: 'Spend by month and category',
    description: 'Additionally requires assets:cost:read - refused with 403 otherwise.',
  })
  spend(@CurrentUser() actor: AuthUser, @Query(zodBody(monthsQuerySchema)) query: MonthsQuery) {
    return this.analytics.spend(actor, query.months);
  }

  @Get('licenses')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'License utilization and expiry runway' })
  licenses(@CurrentUser() actor: AuthUser) {
    return this.analytics.licenses(actor);
  }

  @Get('procurement')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'PR pipeline and cycle times (submit->approve->receive)' })
  procurement(@CurrentUser() actor: AuthUser, @Query(zodBody(monthsQuerySchema)) query: MonthsQuery) {
    return this.analytics.procurement(actor, query.months);
  }

  @Get('work-orders')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'Work-order throughput, aging, SLA breach rate, repair cycle' })
  workOrders(@CurrentUser() actor: AuthUser, @Query(zodBody(monthsQuerySchema)) query: MonthsQuery) {
    return this.analytics.workOrders(actor, query.months);
  }

  @Get('health')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'Health grades, capped count, discovery coverage and staleness' })
  health(@CurrentUser() actor: AuthUser) {
    return this.analytics.health(actor);
  }
}
