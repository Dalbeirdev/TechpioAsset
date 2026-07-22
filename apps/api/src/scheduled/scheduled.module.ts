import { Module } from '@nestjs/common';
import { ScheduledController } from './scheduled.controller.js';
import { AlertSweepService } from './alert-sweep.service.js';

@Module({
  controllers: [ScheduledController],
  providers: [AlertSweepService],
  exports: [AlertSweepService],
})
export class ScheduledModule {}
