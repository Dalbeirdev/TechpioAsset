import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@techpioasset/contracts';
import { updateWorkflowStepSchema } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { WorkflowsService } from './workflows.service.js';

@ApiTags('Approval workflows')
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WORKFLOWS_CONFIGURE)
  @ApiOperation({
    summary: 'The configured approval chains',
    description:
      'Every workflow with its steps in order, each reporting how many active accounts could ' +
      'actually decide it - a step that applies to every request but has no eligible approver ' +
      'is the failure worth seeing.',
  })
  list(@CurrentUser() actor: AuthUser) {
    return this.workflows.list(actor);
  }

  @Patch('steps/:id')
  @RequirePermissions(PERMISSIONS.WORKFLOWS_CONFIGURE)
  @ApiOperation({
    summary: 'Change when a step applies',
    description:
      'Cost threshold, skippability and SLA. A null threshold means the step applies to every ' +
      'request. Adding, removing or reordering steps is not offered here.',
  })
  updateStep(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateWorkflowStepSchema))
    body: { costThreshold?: string | null; isSkippable?: boolean; slaHours?: number | null },
  ) {
    return this.workflows.updateStep(actor, id, body);
  }
}
