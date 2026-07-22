import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';
import { WorkflowService } from './workflow.service.js';

@Module({
  controllers: [RequestsController],
  providers: [RequestsService, WorkflowService],
  exports: [RequestsService, WorkflowService],
})
export class RequestsModule {}
