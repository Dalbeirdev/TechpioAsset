import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';
import { WorkflowService } from './workflow.service.js';
import { DelegationController } from './delegation.controller.js';
import { DelegationService } from './delegation.service.js';
import { WorkflowsController } from './workflows.controller.js';
import { WorkflowsService } from './workflows.service.js';

@Module({
  controllers: [RequestsController, DelegationController, WorkflowsController],
  providers: [RequestsService, WorkflowService, DelegationService, WorkflowsService],
  exports: [RequestsService, WorkflowService],
})
export class RequestsModule {}
