import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  completeMaintenanceSchema,
  createMaintenanceSchema,
  maintenanceListQuerySchema,
  scheduleMaintenanceSchema,
  type AuthUser,
  type CreateMaintenanceInput,
  type MaintenanceListQuery,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { MaintenanceService } from './maintenance.service.js';

const repairAdviceSchema = z.object({ repairCost: z.string().regex(/^\d+(\.\d{1,2})?$/) });

@ApiTags('Maintenance')
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MAINTENANCE_READ)
  @ApiOperation({ summary: 'List maintenance records' })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(maintenanceListQuerySchema)) query: MaintenanceListQuery,
  ) {
    return this.maintenance.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_READ)
  @ApiOperation({ summary: 'Read a maintenance record' })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.maintenance.findOne(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Raise a maintenance record' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createMaintenanceSchema)) body: CreateMaintenanceInput,
  ) {
    return this.maintenance.create(actor, body);
  }

  @Post(':id/schedule')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Schedule a date' })
  schedule(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(scheduleMaintenanceSchema)) body: { scheduledFor: Date },
  ) {
    return this.maintenance.schedule(actor, id, body.scheduledFor);
  }

  @Post(':id/start')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Start work (takes the asset under repair)' })
  start(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.maintenance.start(actor, id);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Complete, recording cost and downtime' })
  complete(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(completeMaintenanceSchema)) body: Parameters<MaintenanceService['complete']>[2],
  ) {
    return this.maintenance.complete(actor, id, body);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Cancel a maintenance record' })
  cancel(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.maintenance.cancel(actor, id);
  }

  @Post('assets/:assetId/repair-advice')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_READ, PERMISSIONS.ASSETS_COST_READ)
  @ApiOperation({ summary: 'Repair-versus-replace guidance for an asset' })
  repairAdvice(
    @CurrentUser() actor: AuthUser,
    @Param('assetId') assetId: string,
    @Body(zodBody(repairAdviceSchema)) body: { repairCost: string },
  ) {
    return this.maintenance.repairAdvice(actor, assetId, body.repairCost);
  }
}
