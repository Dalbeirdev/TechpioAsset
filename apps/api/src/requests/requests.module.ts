import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';
import { WorkflowService } from './workflow.service.js';
import { DelegationController } from './delegation.controller.js';
import { DelegationService } from './delegation.service.js';
import { WorkflowsController } from './workflows.controller.js';
import { WorkflowsService } from './workflows.service.js';
import { AssessmentsService } from './assessments.service.js';

@Module({
  // For issuing a unit from stock once a request is approved. Assets does not
  // depend on requests, so this is a one-way edge.
  imports: [AssetsModule],
  controllers: [RequestsController, DelegationController, WorkflowsController],
  providers: [RequestsService, WorkflowService, DelegationService, WorkflowsService, AssessmentsService],
  exports: [RequestsService, WorkflowService],
})
export class RequestsModule {}
