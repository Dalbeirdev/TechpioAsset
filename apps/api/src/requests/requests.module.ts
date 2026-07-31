import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';
import { WorkflowService } from './workflow.service.js';
import { DelegationController } from './delegation.controller.js';
import { DelegationService } from './delegation.service.js';

@Module({
  controllers: [RequestsController, DelegationController],
  providers: [RequestsService, WorkflowService, DelegationService],
  exports: [RequestsService, WorkflowService],
})
export class RequestsModule {}
