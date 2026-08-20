import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthUser, UpdateWorkflowStepInput } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Reading and tuning the configured approval chains (v2.24).
 *
 * The chains have been configurable in the data model since the beginning and
 * editable nowhere: `workflows:configure` was granted to Super Admin and
 * enforced by no route, so changing a cost threshold meant editing the
 * database by hand - no audit row, no way for the person who owns the process
 * to do it themselves.
 *
 * Each step is reported with the number of accounts that could actually decide
 * it, because a threshold is only half the question: a step that applies to
 * every request and has no eligible approver is worse than one that rarely
 * applies.
 */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser) {
    const definitions = await this.prisma.client.workflowDefinition.findMany({
      where: { companyId: actor.companyId },
      orderBy: [{ requestType: 'asc' }, { name: 'asc' }],
      take: 50,
      include: {
        steps: { orderBy: { stepOrder: 'asc' }, include: { approverRole: true } },
      },
    });

    // One query for every role's headcount rather than one per step.
    const roleIds = [
      ...new Set(
        definitions.flatMap((d) => d.steps.map((s) => s.approverRoleId).filter(Boolean)),
      ),
    ] as string[];
    const holders = roleIds.length
      ? await this.prisma.client.userRole.groupBy({
          by: ['roleId'],
          where: { roleId: { in: roleIds }, user: { deletedAt: null, status: 'ACTIVE' } },
          _count: { userId: true },
        })
      : [];
    const holderCount = new Map(holders.map((h) => [h.roleId, h._count.userId]));

    // A LINE_MANAGER step falls back to the Manager role when the requester has
    // no manager recorded, so that role's headcount is what it resolves to in
    // the general case - the same rule the request engine applies.
    const managerRole = await this.prisma.client.role.findFirst({
      where: { companyId: actor.companyId, key: 'MANAGER' },
      select: { id: true },
    });
    const managerHolders = managerRole
      ? await this.prisma.client.userRole.count({
          where: { roleId: managerRole.id, user: { deletedAt: null, status: 'ACTIVE' } },
        })
      : 0;

    return definitions.map((definition) => ({
      id: definition.id,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      requestType: definition.requestType,
      isActive: definition.isActive,
      steps: definition.steps.map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        name: step.name,
        approverType: step.approverType,
        approverRoleKey: step.approverRole?.key ?? null,
        approverRoleName: step.approverRole?.name ?? null,
        costThreshold: step.costThreshold ? step.costThreshold.toString() : null,
        isSkippable: step.isSkippable,
        slaHours: step.slaHours,
        eligibleApprovers:
          step.approverType === 'LINE_MANAGER'
            ? managerHolders
            : (holderCount.get(step.approverRoleId ?? '') ?? 0),
      })),
    }));
  }

  async updateStep(actor: AuthUser, stepId: string, input: UpdateWorkflowStepInput) {
    // Scoped through the definition: a step id from another tenant must read as
    // missing, not as forbidden.
    const step = await this.prisma.client.workflowStep.findFirst({
      where: { id: stepId, workflowDefinition: { companyId: actor.companyId } },
      include: { workflowDefinition: { select: { name: true } } },
    });
    if (!step) throw AppError.notFound('Workflow step', stepId);

    const data: Prisma.WorkflowStepUpdateInput = {};
    if (input.costThreshold !== undefined) {
      data.costThreshold =
        input.costThreshold === null ? null : new Prisma.Decimal(input.costThreshold);
    }
    if (input.isSkippable !== undefined) data.isSkippable = input.isSkippable;
    if (input.slaHours !== undefined) data.slaHours = input.slaHours;

    const updated = await this.prisma.client.workflowStep.update({
      where: { id: stepId },
      data,
    });

    // Changing who has to approve what is a governance change; it leaves the
    // same trail a role change does.
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'WorkflowStep',
      entityId: stepId,
      previousValues: {
        workflow: step.workflowDefinition.name,
        step: step.name,
        costThreshold: step.costThreshold ? step.costThreshold.toString() : null,
        isSkippable: step.isSkippable,
        slaHours: step.slaHours,
      },
      newValues: {
        costThreshold: updated.costThreshold ? updated.costThreshold.toString() : null,
        isSkippable: updated.isSkippable,
        slaHours: updated.slaHours,
      },
    });

    return this.list(actor);
  }
}
