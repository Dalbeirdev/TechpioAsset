import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@techpioasset/contracts';
import { CurrentUser } from '../auth/decorators.js';
import { DashboardService } from './dashboard.service.js';

/**
 * v2.2 Workstream F — role-based dashboard summary. No permission decorator:
 * the summary tailors itself to the actor's own permissions and scope, so every
 * authenticated user gets a view appropriate to their role.
 */
@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Role-aware KPI tiles for the current user' })
  summary(@CurrentUser() actor: AuthUser) {
    return this.dashboard.getSummary(actor);
  }
}
