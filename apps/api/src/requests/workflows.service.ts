import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AuthUser,
  SetAssessmentStagesInput,
  UpdateWorkflowStepInput,
} from '@techpioasset/contracts';
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
        kind: step.kind,
        isSkippable: step.isSkippable,
        slaHours: step.slaHours,
        eligibleApprovers:
          step.approverType === 'LINE_MANAGER'
            ? managerHolders
            : (holderCount.get(step.approverRoleId ?? '') ?? 0),
      })),
    }));
  }

  /**
   * Turn the two assessment stages on or off for one workflow (v2.25).
   *
   * They go in immediately before the first thresholded step, because that is
   * the step whose answer they exist to supply - the cost has to be known
   * before Finance can be told whether it is needed. With no thresholded step
   * they go at the end, where the work still has to happen before the request
   * is fulfilled.
   *
   * Removing them takes only the stages themselves; requests already in flight
   * carry their own snapshotted copy of the chain and are untouched.
   */
  async setAssessmentStages(
    actor: AuthUser,
    definitionId: string,
    input: SetAssessmentStagesInput,
  ) {
    const definition = await this.prisma.client.workflowDefinition.findFirst({
      where: { id: definitionId, companyId: actor.companyId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!definition) throw AppError.notFound('Workflow', definitionId);

    const existing = definition.steps.filter((s) => s.kind !== 'APPROVAL');

    if (!input.enabled) {
      if (existing.length === 0) return this.list(actor);
      await this.prisma.client.$transaction(async (tx) => {
        await tx.workflowStep.deleteMany({
          where: { id: { in: existing.map((step) => step.id) } },
        });
        await this.renumber(tx, definitionId);
      });
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.SETTING_CHANGED,
        entityType: 'WorkflowDefinition',
        entityId: definitionId,
        previousValues: { assessmentStages: true },
        newValues: { assessmentStages: false, workflow: definition.name },
      });
      return this.list(actor);
    }

    if (existing.length > 0) return this.list(actor);

    const roleKey = input.roleKey ?? 'OFFICE_ADMIN';
    const role = await this.prisma.client.role.findFirst({
      where: { companyId: actor.companyId, key: roleKey },
      select: { id: true },
    });
    if (!role) throw AppError.notFound('Role', roleKey);

    // Before the first thresholded step: its answer is what the threshold is
    // measured against.
    const firstThresholded = definition.steps.find((s) => s.costThreshold !== null);
    const insertAt = firstThresholded
      ? firstThresholded.stepOrder
      : (definition.steps.at(-1)?.stepOrder ?? 0) + 1;

    await this.prisma.client.$transaction(async (tx) => {
      // Two slots are needed, so everything at or after the insert point moves
      // down by two. Descending order avoids colliding with the unique
      // (definition, stepOrder) index on the way.
      for (const step of [...definition.steps].reverse()) {
        if (step.stepOrder < insertAt) continue;
        await tx.workflowStep.update({
          where: { id: step.id },
          data: { stepOrder: step.stepOrder + 2 },
        });
      }
      await tx.workflowStep.createMany({
        data: [
          {
            workflowDefinitionId: definitionId,
            stepOrder: insertAt,
            name: 'Inventory check',
            approverType: 'ROLE',
            approverRoleId: role.id,
            kind: 'INVENTORY_CHECK',
            slaHours: 48,
          },
          {
            workflowDefinitionId: definitionId,
            stepOrder: insertAt + 1,
            name: 'Cost assessment',
            approverType: 'ROLE',
            approverRoleId: role.id,
            kind: 'COST_ASSESSMENT',
            slaHours: 48,
          },
        ],
      });
      await this.renumber(tx, definitionId);
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'WorkflowDefinition',
      entityId: definitionId,
      previousValues: { assessmentStages: false },
      newValues: { assessmentStages: true, roleKey, workflow: definition.name },
    });

    return this.list(actor);
  }

  /**
   * Close the gaps a add or remove leaves in the ordering.
   *
   * Adding shifts later steps down by two and removing does not shift them
   * back, so without this a workflow toggled a few times ends up with its last
   * step at order 10 - harmless to sort, but it makes the configuration read
   * like something went wrong, and the insertion point is computed from those
   * numbers. Renumbering to 1..n after every change keeps them meaningful.
   *
   * Done in two passes because (definition, stepOrder) is unique: moving
   * everything into a range nothing occupies first means no intermediate state
   * collides.
   */
  private async renumber(
    tx: Pick<PrismaService['client'], 'workflowStep'>,
    definitionId: string,
  ): Promise<void> {
    const steps = await tx.workflowStep.findMany({
      where: { workflowDefinitionId: definitionId },
      orderBy: { stepOrder: 'asc' },
      select: { id: true },
    });
    const PARK = 1000;
    for (const [index, step] of steps.entries()) {
      await tx.workflowStep.update({
        where: { id: step.id },
        data: { stepOrder: PARK + index },
      });
    }
    for (const [index, step] of steps.entries()) {
      await tx.workflowStep.update({
        where: { id: step.id },
        data: { stepOrder: index + 1 },
      });
    }
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

    let newRoleId: string | null = null;
    if (input.approverRoleKey !== undefined) {
      const role = await this.prisma.client.role.findFirst({
        where: { companyId: actor.companyId, key: input.approverRoleKey },
        select: { id: true, key: true, name: true },
      });
      if (!role) throw AppError.notFound('Role', input.approverRoleKey);
      newRoleId = role.id;
      data.approverRole = { connect: { id: role.id } };
      // A step pointed at a role is a ROLE step, whatever it was before -
      // otherwise the resolver keeps reading it as LINE_MANAGER and ignores the
      // role that was just chosen.
      data.approverType = 'ROLE';
    }

    const updated = await this.prisma.client.workflowStep.update({
      where: { id: stepId },
      data,
    });

    /**
     * Re-point the requests already in flight (v2.26).
     *
     * A chain is snapshotted when a request is submitted, so changing the
     * definition alone would only affect future requests - the ones already
     * waiting would keep pointing at the old role, and the person who was just
     * given the job still would not see them. That is precisely the confusion
     * this change exists to end.
     *
     * Only steps nobody has decided yet, only requests raised from THIS
     * workflow, and only those still carrying the role we are moving away from:
     * a chain somebody has already redirected by hand is left alone, and no
     * decision already taken is rewritten.
     */
    let movedInFlight = 0;
    if (newRoleId && step.approverRoleId !== newRoleId) {
      const moved = await this.prisma.client.requestApproval.updateMany({
        where: {
          stepName: step.name,
          decision: { in: ['WAITING', 'PENDING'] },
          approverRoleId: step.approverRoleId,
          request: {
            companyId: actor.companyId,
            workflowDefinitionId: step.workflowDefinitionId,
          },
        },
        data: { approverRoleId: newRoleId },
      });
      movedInFlight = moved.count;
    }

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
        approverRoleId: step.approverRoleId,
        approverType: step.approverType,
      },
      newValues: {
        costThreshold: updated.costThreshold ? updated.costThreshold.toString() : null,
        isSkippable: updated.isSkippable,
        slaHours: updated.slaHours,
        approverRoleId: updated.approverRoleId,
        approverType: updated.approverType,
        // Says how far the change reached, so the trail shows the requests it
        // moved and not just the setting it changed.
        inFlightRequestsMoved: movedInFlight,
      },
    });

    return this.list(actor);
  }
}
