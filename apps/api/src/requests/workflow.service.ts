import { Injectable, Logger } from '@nestjs/common';
import { ApprovalDecision, Prisma, type RequestType } from '@prisma/client';
import {
  canApproveStep,
  pendingStatusForApprover,
  resolveApplicableSteps,
  type ApproverType,
  type RequestStatus,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface MaterialisedStep {
  stepOrder: number;
  stepName: string;
  approverType: ApproverType;
  approverRoleId: string | null;
  approverRoleKey: string | null;
  approverId: string | null;
  slaDueAt: Date | null;
}

/**
 * Turns a configured WorkflowDefinition into the concrete approval chain for one
 * request, and decides who may act on the current step.
 *
 * Spec section 11 requires Super Admins to configure steps, approvers,
 * thresholds and bypass rules, so none of that is hard-coded — this service only
 * interprets the configuration.
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds the definition for a request type, falling back to the catch-all
   * (requestType = null) so a newly added type is never left without a workflow.
   */
  async resolveDefinition(companyId: string, type: RequestType) {
    const specific = await this.prisma.client.workflowDefinition.findFirst({
      where: { companyId, requestType: type, isActive: true },
      include: { steps: { include: { approverRole: true }, orderBy: { stepOrder: 'asc' } } },
    });
    if (specific) return specific;

    return this.prisma.client.workflowDefinition.findFirst({
      where: { companyId, requestType: null, isActive: true },
      include: { steps: { include: { approverRole: true }, orderBy: { stepOrder: 'asc' } } },
    });
  }

  /** Steps that apply once thresholds are taken into account. */
  async materialise(
    companyId: string,
    type: RequestType,
    estimatedCost: Prisma.Decimal | string | null,
  ): Promise<{ definitionId: string | null; steps: MaterialisedStep[] }> {
    const definition = await this.resolveDefinition(companyId, type);
    if (!definition) {
      this.logger.warn(`No workflow definition for ${type} in company ${companyId}`);
      return { definitionId: null, steps: [] };
    }

    const applicable = resolveApplicableSteps(
      definition.steps.map((step) => ({
        stepOrder: step.stepOrder,
        approverType: step.approverType as ApproverType,
        approverRoleKey: step.approverRole?.key ?? null,
        approverUserId: step.approverUserId,
        costThreshold: step.costThreshold ? step.costThreshold.toString() : null,
        isSkippable: step.isSkippable,
        name: step.name,
        approverRoleId: step.approverRoleId,
        slaHours: step.slaHours,
      })),
      estimatedCost === null ? null : estimatedCost.toString(),
    );

    return {
      definitionId: definition.id,
      steps: applicable.map((step) => ({
        stepOrder: step.stepOrder,
        stepName: step.name,
        approverType: step.approverType,
        approverRoleId: step.approverRoleId,
        approverRoleKey: step.approverRoleKey,
        approverId: step.approverUserId ?? null,
        slaDueAt: step.slaHours ? new Date(Date.now() + step.slaHours * 3_600_000) : null,
      })),
    };
  }

  /** Status the request should sit in while the given step is pending. */
  statusForStep(step: MaterialisedStep): RequestStatus {
    return pendingStatusForApprover({
      approverType: step.approverType,
      approverRoleKey: step.approverRoleKey,
    });
  }

  /**
   * Non-throwing counterpart to assertCanDecide, for telling the UI whether to
   * offer the approve/reject controls.
   *
   * The client cannot work this out for itself: whether someone may act depends
   * on the step's approver type and, for a line-manager step, on the requester's
   * manager. Without this the UI shows an Approve button to every holder of
   * `requests:approve` and lets them discover the 403 by clicking it.
   */
  async canDecide(input: {
    requestId: string;
    actorId: string;
    actorRoleKeys: readonly string[];
  }): Promise<boolean> {
    try {
      await this.assertCanDecide(input);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Authorises a decision on the current step.
   *
   * Holding `requests:approve` is necessary but not sufficient: the actor must
   * also match *this* step's approver. Otherwise any approver could sign off any
   * stage, and the configured chain would be decorative.
   */
  async assertCanDecide(input: {
    requestId: string;
    actorId: string;
    actorRoleKeys: readonly string[];
  }) {
    const approval = await this.prisma.client.requestApproval.findFirst({
      where: { requestId: input.requestId, decision: ApprovalDecision.PENDING },
      orderBy: { stepOrder: 'asc' },
      include: { request: { include: { requester: { include: { profile: true } } } } },
    });

    if (!approval) {
      throw new AppError(
        'ILLEGAL_STATE_TRANSITION',
        'This request has no step awaiting a decision',
      );
    }

    const role = approval.approverRoleId
      ? await this.prisma.client.role.findUnique({ where: { id: approval.approverRoleId } })
      : null;

    const permitted = canApproveStep({
      step: {
        stepOrder: approval.stepOrder,
        approverType: approval.approverType as ApproverType,
        approverRoleKey: role?.key ?? null,
        approverUserId: approval.approverId,
        isSkippable: false,
      },
      actorId: input.actorId,
      actorRoleKeys: input.actorRoleKeys,
      requesterManagerId: approval.request.requester.profile?.managerId ?? null,
      requesterDepartmentHeadId: null,
    });

    if (!permitted) {
      throw AppError.forbidden(
        `This request is awaiting "${approval.stepName}", which you are not the approver for`,
      );
    }

    return approval;
  }
}
