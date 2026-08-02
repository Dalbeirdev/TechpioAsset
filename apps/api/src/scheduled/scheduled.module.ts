import { Module } from '@nestjs/common';
import { MaintenanceModule } from '../maintenance/maintenance.module.js';
import { ScheduledController } from './scheduled.controller.js';
import { AlertSweepService } from './alert-sweep.service.js';

@Module({
  imports: [MaintenanceModule],
  controllers: [ScheduledController],
  providers: [AlertSweepService],
  exports: [AlertSweepService],
})
export class ScheduledModule {}
