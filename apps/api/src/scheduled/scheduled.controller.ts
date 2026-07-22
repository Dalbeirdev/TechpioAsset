import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createScheduledReportSchema, type AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter } from '../common/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertSweepService } from './alert-sweep.service.js';
import { nextCronRun } from './cron.js';

@ApiTags('Scheduled')
@Controller('scheduled')
export class ScheduledController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: AlertSweepService,
  ) {}

  @Get('reports')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({ summary: 'List scheduled reports' })
  listReports(@CurrentUser() actor: AuthUser) {
    return this.prisma.client.scheduledReport.findMany({
      where: { ...tenantFilter(actor), deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        resource: true,
        format: true,
        cron: true,
        recipients: true,
        isActive: true,
        lastRunAt: true,
        nextRunAt: true,
      },
    });
  }

  @Post('reports')
  @RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
  @ApiOperation({
    summary: 'Schedule a recurring report',
    description: 'Delivered by email on the cron schedule when scheduled jobs are enabled.',
  })
  async createReport(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createScheduledReportSchema))
    body: { name: string; type: string; format: string; cron: string; recipients: string[] },
  ) {
    const nextRunAt = nextCronRun(body.cron, new Date());
    return this.prisma.client.scheduledReport.create({
      data: {
        companyId: actor.companyId,
        ownerId: actor.id,
        name: body.name,
        resource: body.type,
        format: body.format,
        cron: body.cron,
        recipients: body.recipients,
        nextRunAt,
      },
      select: { id: true, name: true, cron: true, nextRunAt: true },
    });
  }

  @Delete('reports/:id')
  @RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a scheduled report' })
  async deleteReport(@CurrentUser() actor: AuthUser, @Param('id') id: string): Promise<void> {
    const result = await this.prisma.client.scheduledReport.updateMany({
      where: { id, ...tenantFilter(actor) },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (result.count === 0) throw AppError.notFound('Scheduled report', id);
  }

  @Post('alerts/run')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run the warranty and maintenance alert sweep now',
    description: 'Super Admin trigger for the sweep that also runs on a daily timer.',
  })
  async runAlerts() {
    const [warranty, maintenance] = await Promise.all([
      this.sweep.runWarrantySweep(),
      this.sweep.runMaintenanceSweep(),
    ]);
    return { warrantyAlerts: warranty, maintenanceAlerts: maintenance };
  }
}
