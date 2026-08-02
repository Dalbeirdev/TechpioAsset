import { Module } from '@nestjs/common';
import { MaintenanceModule } from '../maintenance/maintenance.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { ScheduledController } from './scheduled.controller.js';
import { AlertSweepService } from './alert-sweep.service.js';
import { ReportRunnerService } from './report-runner.service.js';

@Module({
  imports: [MaintenanceModule, ReportsModule],
  controllers: [ScheduledController],
  providers: [AlertSweepService, ReportRunnerService],
  exports: [AlertSweepService, ReportRunnerService],
})
export class ScheduledModule {}
