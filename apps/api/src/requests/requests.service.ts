import { Logger, Injectable } from '@nestjs/common';
import { ApprovalDecision, AuditAction, Prisma, type RequestType } from '@prisma/client';
import type { AuthUser, CreateRequestInput, RequestListQuery } from '@techpioasset/contracts';
import {
  assertTransition,
  findIssueCategory,
  requestStatusMachine,
  PERMISSIONS,
  type RequestStatus,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { requestScopeFilter, tenantFilter } from '../common/scope.js';
import { AppConfig } from '../config/config.module.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';
import { validateUpload } from '../providers/storage/file-validation.js';
import { WebhooksService } from '../integrations/webhooks.service.js';
import { WorkflowService } from './workflow.service.js';

const SORTABLE = ['createdAt', 'requestNumber', 'status', 'priority', 'requiredBy'] as const;

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
    private readonly storage: StorageProvider,
    private readonly config: AppConfig,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  private readonly listSelect = {
    id: true,
    requestNumber: true,
    type: true,
    status: true,
    priority: true,
    businessReason: true,
    issueCategory: true,
    requiredBy: true,
    estimatedCost: true,
    currency: true,
    submittedAt: true,
    completedAt: true,
    createdAt: true,
    requester: {
      select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } },
    },
    beneficiary: {
      select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } },
    },
    items: { select: { id: true, description: true, quantity: true } },
  } satisfies Prisma.AssetRequestSelect;

  /**
   * ANDed, never spread — a caller-supplied filter must not widen scope. Same
   * reasoning as AssetsService.list.
   */
  private listWhere(actor: AuthUser, query: RequestListQuery): Prisma.AssetRequestWhereInput {
    const filters: Prisma.AssetRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      // "My requests" narrows WITHIN the actor's scope, so it can never widen
      // what a restricted scope would already refuse to show.
      ...(query.mine ? { requesterId: actor.id } : {}),
      ...(query.requesterId ? { requesterId: query.requesterId } : {}),
      ...(query.q
        ? {
            OR: [
              { requestNumber: { contains: query.q, mode: 'insensitive' } },
              { businessReason: { contains: query.q, mode: 'insensitive' } },
              { items: { some: { description: { contains: query.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
      ...(query.awaitingMe
        ? {
            approvals: {
              some: {
                decision: ApprovalDecision.PENDING,
                OR: [
                  // Named approver.
                  { approverId: actor.id },
                  // Role-based step: anyone currently holding the role.
                  { approverRole: { users: { some: { userId: actor.id } } } },
                  // Line-manager step carries neither an approverId nor a role -
                  // the approver is whoever manages the beneficiary - so it is
                  // matched through the request's denormalised managerId.
                  // Without this branch, manager approvals never appear in an
                  // inbox and simply stall.
                  { approverType: 'LINE_MANAGER', request: { managerId: actor.id } },
                ],
              },
            },
          }
        : {}),
    };
    return { AND: [requestScopeFilter(actor), filters] };
  }

  async list(actor: AuthUser, query: RequestListQuery) {
    const where = this.listWhere(actor, query);

    return paginate(query, {
      count: () => this.prisma.client.assetRequest.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.assetRequest.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(query.sort, query.order, SORTABLE, 'createdAt'),
          select: this.listSelect,
        }),
    });
  }

  /** All requests matching the list filters, flattened for CSV export (scoped, capped). */
  async exportRows(actor: AuthUser, query: RequestListQuery) {
    const where = this.listWhere(actor, query);
    const requests = await this.prisma.client.assetRequest.findMany({
      where,
      take: 10_000,
      orderBy: { createdAt: 'desc' },
      select: this.listSelect,
    });

    const name = (p: { profile: { firstName: string; lastName: string } | null; email: string }) =>
      p.profile ? `${p.profile.firstName} ${p.profile.lastName}` : p.email;

    const columns = [
      { key: 'requestNumber', label: 'Request' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'requester', label: 'Requester' },
      { key: 'items', label: 'Items' },
      { key: 'estimatedCost', label: 'Estimated cost' },
      { key: 'createdAt', label: 'Created' },
    ];
    const rows = requests.map((r) => ({
      requestNumber: r.requestNumber,
      type: r.type,
      status: r.status,
      priority: r.priority,
      requester: name(r.requester),
      items: r.items.map((i) => `${i.description} ×${i.quantity}`).join('; '),
      estimatedCost: r.estimatedCost != null ? String(r.estimatedCost) : '',
      createdAt: r.createdAt.toISOString().slice(0, 10),
    }));

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.DATA_EXPORTED,
      entityType: 'AssetRequest',
      entityId: 'export',
      newValues: { rows: rows.length },
    });

    return { columns, rows };
  }

  async findOne(actor: AuthUser, id: string) {
    const request = await this.prisma.client.assetRequest.findFirst({
      where: { AND: [{ id }, requestScopeFilter(actor)] },
      select: {
        ...this.listSelect,
        notes: true,
        preferredSpec: true,
        isReplacement: true,
        officeId: true,
        departmentId: true,
        currentStepOrder: true,
        // v2.15 - the work order this ticket became, so an approved damage
        // report answers "and then what happened?" on its own page.
        workOrder: { select: { id: true, status: true, title: true } },
        items: {
          select: {
            id: true,
            description: true,
            quantity: true,
            preferredSpec: true,
            estimatedCost: true,
            category: { select: { id: true, name: true } },
            subcategory: { select: { id: true, name: true } },
            fulfilledAsset: { select: { id: true, assetTag: true, name: true } },
            fulfilledAt: true,
          },
        },
        approvals: {
          // Capped like every other nested collection: a request's chain is
          // short by design, but "short by design" is not a guarantee.
          take: 50,
          orderBy: { stepOrder: 'asc' },
          select: {
            id: true,
            stepOrder: true,
            stepName: true,
            approverType: true,
            decision: true,
            decidedAt: true,
            comment: true,
            slaDueAt: true,
            approver: {
              select: {
                id: true,
                email: true,
                profile: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
        comments: {
          // Internal notes are filtered out for the requester, who would
          // otherwise read the reviewers' private discussion of their request.
          where: this.canSeeInternalComments(actor) ? {} : { isInternal: false },
          // Newest 100, then re-ordered oldest-first below for reading. A
          // long-running request accumulates comments without bound.
          take: 100,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            body: true,
            isInternal: true,
            createdAt: true,
            author: {
              select: {
                id: true,
                email: true,
                profile: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
        attachments: {
          where: { deletedAt: null },
          take: 50,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            caption: true,
            createdAt: true,
            uploadedById: true,
          },
        },
      },
    });

    if (!request) throw AppError.notFound('Request', id);

    // Resolved server-side: only the API knows the step's approver rules.
    const canDecide =
      actor.permissions.includes(PERMISSIONS.REQUESTS_APPROVE) &&
      (await this.workflow.canDecide({
        requestId: id,
        actorId: actor.id,
        actorRoleKeys: actor.roles,
      }));

    return {
      ...request,
      // Fetched newest-first so the cap keeps the RECENT comments; read
      // oldest-first, which is how a conversation is followed.
      comments: [...request.comments].reverse(),
      canDecide,
    };
  }

  private canSeeInternalComments(actor: AuthUser): boolean {
    return actor.permissions.includes(PERMISSIONS.REQUESTS_APPROVE);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Create and submit
  // ───────────────────────────────────────────────────────────────────────────

  /** `REQ-2026-000123`, unique per company. */
  private async nextRequestNumber(companyId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `REQ-${year}-`;
    const latest = await this.prisma.client.assetRequest.findFirst({
      where: { companyId, requestNumber: { startsWith: prefix } },
      orderBy: { requestNumber: 'desc' },
      select: { requestNumber: true },
    });
    const next = latest ? Number(latest.requestNumber.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(6, '0')}`;
  }

  async create(actor: AuthUser, input: CreateRequestInput) {
    // NOTE deliberately NOT refused here: the estimated cost drives approval
    // routing (spec section 11 - at/above the Finance threshold the Finance
    // step is included), so the API accepts estimates from any requester. The
    // employee-facing FORM hides the field (money entry is a finance-side
    // concern in the UI); a hard API block here broke threshold routing for
    // every workflow that prices requests at submission.
    if (input.beneficiaryId && input.beneficiaryId !== actor.id) {
      if (!actor.permissions.includes(PERMISSIONS.REQUESTS_CREATE_ON_BEHALF)) {
        throw AppError.forbidden('You may not raise a request on behalf of another employee');
      }
      const beneficiary = await this.prisma.client.user.findFirst({
        where: { id: input.beneficiaryId, companyId: actor.companyId },
        select: { id: true },
      });
      if (!beneficiary) throw AppError.notFound('User', input.beneficiaryId);
    }

    const beneficiaryId = input.beneficiaryId ?? actor.id;
    const beneficiaryProfile = await this.prisma.client.userProfile.findUnique({
      where: { userId: beneficiaryId },
      select: { managerId: true, departmentId: true, officeId: true },
    });

    // Total estimate drives threshold-based step skipping, so an explicit
    // request-level figure wins and otherwise the items are summed.
    const itemTotal = input.items.reduce(
      (sum, item) => sum.plus(new Prisma.Decimal(item.estimatedCost ?? 0).times(item.quantity)),
      new Prisma.Decimal(0),
    );
    const estimatedCost = input.estimatedCost ? new Prisma.Decimal(input.estimatedCost) : itemTotal;

    const request = await this.prisma.client.assetRequest.create({
      data: {
        companyId: actor.companyId,
        requestNumber: await this.nextRequestNumber(actor.companyId),
        type: input.type,
        status: 'DRAFT',
        priority: input.priority,
        requesterId: actor.id,
        beneficiaryId: input.beneficiaryId ?? null,
        managerId: beneficiaryProfile?.managerId ?? null,
        officeId: input.officeId ?? beneficiaryProfile?.officeId ?? null,
        departmentId: input.departmentId ?? beneficiaryProfile?.departmentId ?? null,
        businessReason: input.businessReason,
        // Only keys we actually publish are stored: an unknown one would make
        // the issue reports quietly wrong rather than loudly rejected.
        issueCategory: input.issueCategory
          ? (findIssueCategory(input.issueCategory)?.key ?? null)
          : null,
        requiredBy: input.requiredBy ?? null,
        preferredSpec: input.preferredSpec ?? null,
        isReplacement: input.isReplacement,
        replacesAssetId: input.replacesAssetId ?? null,
        estimatedCost,
        currency: input.currency ?? 'USD',
        notes: input.notes ?? null,
        createdById: actor.id,
        items: {
          create: input.items.map((item) => ({
            categoryId: item.categoryId ?? null,
            subcategoryId: item.subcategoryId ?? null,
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity),
            preferredSpec: item.preferredSpec ?? null,
            estimatedCost: item.estimatedCost ? new Prisma.Decimal(item.estimatedCost) : null,
          })),
        },
      },
      select: { id: true, requestNumber: true },
    });

    return this.findOne(actor, request.id);
  }

  /**
   * Submits a draft: builds the approval chain and moves to the first step.
   *
   * The chain is materialised at submit time rather than read live, so an
   * administrator editing the workflow mid-flight cannot retroactively change the
   * approvals an in-progress request has already collected.
   */
  async submit(actor: AuthUser, id: string) {
    const request = await this.loadForWrite(actor, id);

    if (
      request.requesterId !== actor.id &&
      !actor.permissions.includes(PERMISSIONS.REQUESTS_APPROVE)
    ) {
      throw AppError.forbidden('Only the requester may submit this request');
    }
    assertTransition(requestStatusMachine, request.status as RequestStatus, 'SUBMITTED');

    const { definitionId, steps } = await this.workflow.materialise(
      actor.companyId,
      request.type,
      request.estimatedCost,
    );

    if (steps.length === 0) {
      // No configured approvals: the request is approved on submission rather
      // than stalling forever in a state nobody can action.
      const updated = await this.prisma.client.assetRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          submittedAt: new Date(),
          decidedAt: new Date(),
          workflowDefinitionId: definitionId,
          updatedById: actor.id,
          version: { increment: 1 },
        },
      });
      await this.recordSubmission(actor, updated.id, updated.requestNumber, 'APPROVED');
      // Approved-on-submission is still approved: the same work-order rule
      // applies here as at the end of an approval chain.
      await this.raiseWorkOrder(actor, {
        id: updated.id,
        requestNumber: updated.requestNumber,
        type: updated.type,
        assetId: updated.replacesAssetId,
        businessReason: updated.businessReason,
      });
      return this.findOne(actor, id);
    }

    const firstStatus = this.workflow.statusForStep(steps[0]!);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.requestApproval.createMany({
        // Only the first step is PENDING; the rest queue as WAITING. Creating
        // them all as PENDING would put the request in every future approver's
        // inbox the moment it was submitted.
        data: steps.map((step, index) => ({
          requestId: id,
          stepOrder: step.stepOrder,
          stepName: step.stepName,
          approverType: step.approverType,
          approverRoleId: step.approverRoleId,
          approverId: step.approverId,
          slaDueAt: step.slaDueAt,
          decision: index === 0 ? ApprovalDecision.PENDING : ApprovalDecision.WAITING,
        })),
      });

      await tx.assetRequest.update({
        where: { id },
        data: {
          status: firstStatus,
          submittedAt: new Date(),
          workflowDefinitionId: definitionId,
          currentStepOrder: steps[0]!.stepOrder,
          updatedById: actor.id,
          version: { increment: 1 },
        },
      });
    });

    await this.recordSubmission(actor, id, request.requestNumber, firstStatus);
    await this.notifyApprovers(actor.companyId, id, request.requestNumber);

    return this.findOne(actor, id);
  }

  private async recordSubmission(
    actor: AuthUser,
    id: string,
    requestNumber: string,
    status: string,
  ): Promise<void> {
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.REQUEST_SUBMITTED,
      entityType: 'AssetRequest',
      entityId: id,
      newValues: { requestNumber, status },
    });
  }

  /** Tells whoever can action the current step that it is waiting on them. */
  private async notifyApprovers(companyId: string, requestId: string, requestNumber: string) {
    const approval = await this.prisma.client.requestApproval.findFirst({
      where: { requestId, decision: ApprovalDecision.PENDING },
      orderBy: { stepOrder: 'asc' },
      include: {
        request: { include: { requester: { include: { profile: true } } } },
      },
    });
    if (!approval) return;

    const recipients: string[] = [];

    if (approval.approverId) {
      recipients.push(approval.approverId);
    } else if (approval.approverType === 'LINE_MANAGER') {
      const managerId = approval.request.requester.profile?.managerId;
      if (managerId) recipients.push(managerId);
    } else if (approval.approverRoleId) {
      const holders = await this.prisma.client.userRole.findMany({
        where: { roleId: approval.approverRoleId },
        select: { userId: true },
      });
      recipients.push(...holders.map((h) => h.userId));
    }

    await this.notifications.notifyMany(recipients, {
      companyId,
      type: 'APPROVAL_REQUIRED',
      title: `Approval required: ${requestNumber}`,
      body: `${approval.stepName} is waiting on you for request ${requestNumber}.`,
      linkPath: `/requests/${requestId}`,
      entityType: 'AssetRequest',
      entityId: requestId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Decisions
  // ───────────────────────────────────────────────────────────────────────────

  async decide(actor: AuthUser, id: string, decision: 'APPROVED' | 'REJECTED', comment?: string) {
    const request = await this.loadForWrite(actor, id);
    const approval = await this.workflow.assertCanDecide({
      requestId: id,
      actorId: actor.id,
      actorRoleKeys: actor.roles,
    });

    const now = new Date();

    if (decision === 'REJECTED') {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.requestApproval.update({
          where: { id: approval.id },
          data: {
            decision: ApprovalDecision.REJECTED,
            decidedAt: now,
            comment,
            approverId: actor.id,
          },
        });
        // Remaining steps are marked skipped rather than left pending, so the
        // chain reads as a complete history rather than a half-finished one.
        await tx.requestApproval.updateMany({
          where: {
            requestId: id,
            decision: { in: [ApprovalDecision.PENDING, ApprovalDecision.WAITING] },
          },
          data: { decision: ApprovalDecision.SKIPPED, decidedAt: now },
        });
        await tx.assetRequest.update({
          where: { id },
          data: {
            status: 'REJECTED',
            decidedAt: now,
            updatedById: actor.id,
            version: { increment: 1 },
          },
        });
      });

      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.REQUEST_REJECTED,
        entityType: 'AssetRequest',
        entityId: id,
        previousValues: { status: request.status },
        newValues: { status: 'REJECTED', step: approval.stepName },
        reason: comment,
      });

      await this.notifications.notify({
        companyId: actor.companyId,
        userId: request.requesterId,
        type: 'REQUEST_REJECTED',
        title: `Request ${request.requestNumber} was rejected`,
        body: comment
          ? `Rejected at ${approval.stepName}: ${comment}`
          : `Rejected at ${approval.stepName}.`,
        linkPath: `/requests/${id}`,
        entityType: 'AssetRequest',
        entityId: id,
      });

      // v2.6 A3: terminal outcome - integrations may care.
      void this.webhooks.publish(actor.companyId, 'request.decided', {
        requestId: id,
        requestNumber: request.requestNumber,
        decision: 'REJECTED',
        step: approval.stepName,
      });

      return this.findOne(actor, id);
    }

    const nextStep = await this.prisma.client.$transaction(async (tx) => {
      await tx.requestApproval.update({
        where: { id: approval.id },
        data: {
          decision: ApprovalDecision.APPROVED,
          decidedAt: now,
          comment,
          approverId: actor.id,
        },
      });

      // Promote the next queued step onto its approver's desk.
      const next = await tx.requestApproval.findFirst({
        where: { requestId: id, decision: ApprovalDecision.WAITING },
        orderBy: { stepOrder: 'asc' },
        include: { approverRole: true },
      });

      if (next) {
        await tx.requestApproval.update({
          where: { id: next.id },
          data: { decision: ApprovalDecision.PENDING },
        });
      }

      return next;
    });

    const nextStatus: RequestStatus = nextStep
      ? this.workflow.statusForStep({
          stepOrder: nextStep.stepOrder,
          stepName: nextStep.stepName,
          approverType: nextStep.approverType,
          approverRoleId: nextStep.approverRoleId,
          approverRoleKey: nextStep.approverRole?.key ?? null,
          approverId: nextStep.approverId,
          slaDueAt: nextStep.slaDueAt,
        })
      : 'APPROVED';

    await this.prisma.client.assetRequest.update({
      where: { id },
      data: {
        status: nextStatus,
        currentStepOrder: nextStep?.stepOrder ?? null,
        ...(nextStep ? {} : { decidedAt: now }),
        updatedById: actor.id,
        version: { increment: 1 },
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.REQUEST_APPROVED,
      entityType: 'AssetRequest',
      entityId: id,
      previousValues: { status: request.status },
      newValues: { status: nextStatus, step: approval.stepName },
      reason: comment,
    });

    if (nextStep) {
      await this.notifyApprovers(actor.companyId, id, request.requestNumber);
    } else {
      await this.notifications.notify({
        companyId: actor.companyId,
        userId: request.requesterId,
        type: 'REQUEST_APPROVED',
        title: `Request ${request.requestNumber} approved`,
        body: 'Your request has completed approval and is being prepared.',
        linkPath: `/requests/${id}`,
        entityType: 'AssetRequest',
        entityId: id,
      });
      // v2.6 A3: fully approved - a terminal outcome.
      void this.webhooks.publish(actor.companyId, 'request.decided', {
        requestId: id,
        requestNumber: request.requestNumber,
        decision: 'APPROVED',
        step: approval.stepName,
      });

      // v2.15 Phase 2d - an approved damage or repair ticket becomes a work
      // order on the named device. Before this, approval was where the trail
      // ended: the ticket said "approved" forever and the repair, if it
      // happened, was a separate record nobody connected to it.
      await this.raiseWorkOrder(actor, {
        id,
        requestNumber: request.requestNumber,
        type: request.type,
        assetId: request.replacesAssetId,
        businessReason: request.businessReason,
      });
    }

    return this.findOne(actor, id);
  }

  /**
   * Creates the linked work order for an approved DAMAGE/REPAIR request.
   *
   * Skips silently when the request names no asset - a damage ticket about a
   * meeting-room chair has nothing to schedule a repair against. The unique
   * requestId on MaintenanceRecord makes a duplicate structurally impossible,
   * and failures log rather than throw: the approval has already happened.
   */
  private async raiseWorkOrder(
    actor: AuthUser,
    request: {
      id: string;
      requestNumber: string;
      type: string;
      assetId: string | null;
      businessReason: string;
    },
  ): Promise<void> {
    if (request.type !== 'DAMAGE' && request.type !== 'REPAIR') return;
    if (!request.assetId) return;

    try {
      const asset = await this.prisma.client.asset.findFirst({
        where: { id: request.assetId, companyId: actor.companyId, deletedAt: null },
        select: { id: true, assetTag: true, name: true },
      });
      if (!asset) return;

      const workOrder = await this.prisma.client.maintenanceRecord.create({
        data: {
          assetId: asset.id,
          requestId: request.id,
          type: 'REPAIR',
          status: 'REQUESTED',
          title: `${request.type === 'DAMAGE' ? 'Damage' : 'Repair'}: ${asset.name} (${request.requestNumber})`,
          description: request.businessReason,
          requestedById: actor.id,
          isInternal: true,
          createdById: actor.id,
        },
        select: { id: true },
      });

      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.ASSET_UPDATED,
        entityType: 'MaintenanceRecord',
        entityId: workOrder.id,
        newValues: { assetId: asset.id, requestId: request.id, source: request.requestNumber },
        reason: 'Work order raised from approved request',
      });
    } catch (error) {
      this.logger.error(
        `Approved ${request.requestNumber} but could not raise its work order: ${(error as Error).message}`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Fulfilment and cancellation
  // ───────────────────────────────────────────────────────────────────────────

  /** Moves an approved request forward through the fulfilment statuses. */
  async advance(actor: AuthUser, id: string, status: RequestStatus) {
    const request = await this.loadForWrite(actor, id);
    assertTransition(requestStatusMachine, request.status as RequestStatus, status);

    await this.prisma.client.assetRequest.update({
      where: { id },
      data: {
        status,
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
        updatedById: actor.id,
        version: { increment: 1 },
      },
    });

    if (status === 'READY_FOR_ASSIGNMENT') {
      await this.notifications.notify({
        companyId: actor.companyId,
        userId: request.beneficiaryId ?? request.requesterId,
        type: 'ASSET_READY',
        title: `Ready for collection: ${request.requestNumber}`,
        body: 'Your equipment is ready.',
        linkPath: `/requests/${id}`,
        entityType: 'AssetRequest',
        entityId: id,
      });
    }

    return this.findOne(actor, id);
  }

  async cancel(actor: AuthUser, id: string, reason?: string) {
    const request = await this.loadForWrite(actor, id);

    const isOwner = request.requesterId === actor.id;
    if (!isOwner && !actor.permissions.includes(PERMISSIONS.REQUESTS_APPROVE)) {
      // 404, not 403: a guessed id must read the same whether the request
      // exists outside the caller's reach or not at all - the read path
      // already follows this convention (v2.12 least-privilege audit, G7).
      throw AppError.notFound('Request', id);
    }
    assertTransition(requestStatusMachine, request.status as RequestStatus, 'CANCELLED');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.requestApproval.updateMany({
        where: {
          requestId: id,
          decision: { in: [ApprovalDecision.PENDING, ApprovalDecision.WAITING] },
        },
        data: { decision: ApprovalDecision.SKIPPED, decidedAt: new Date() },
      });
      await tx.assetRequest.update({
        where: { id },
        data: { status: 'CANCELLED', updatedById: actor.id, version: { increment: 1 } },
      });
    });

    // The cancellation reason was previously accepted and thrown away. It is the
    // only record of why an in-flight request stopped, so it belongs in the audit
    // trail alongside who cancelled it.
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.REQUEST_REJECTED,
      entityType: 'AssetRequest',
      entityId: id,
      previousValues: { status: request.status },
      newValues: { status: 'CANCELLED' },
      reason: reason ?? 'Cancelled without a stated reason',
    });

    return this.findOne(actor, id);
  }

  async addComment(actor: AuthUser, id: string, body: string, isInternal: boolean) {
    await this.findOne(actor, id);

    if (isInternal && !this.canSeeInternalComments(actor)) {
      throw AppError.forbidden('You may not add internal comments');
    }

    await this.prisma.client.requestComment.create({
      data: { requestId: id, authorId: actor.id, body, isInternal },
    });

    return this.findOne(actor, id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Attachments (v2.12) — a photo of the damage, a spec sheet, a quote. Reuses
  // the generic Attachment model (assetRequestId), stored privately, validated
  // by signature not by claimed type. Reachability follows the request's own
  // scope: findOne 404s a request the actor may not see, so attaching to or
  // reading attachments of a foreign request is impossible.
  // ───────────────────────────────────────────────────────────────────────────

  async addAttachment(
    actor: AuthUser,
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    caption?: string,
  ) {
    await this.findOne(actor, id); // ownership/scope gate + 404

    const { contentType } = validateUpload({
      data: file.buffer,
      declaredMime: file.mimetype,
      allowedMimes: this.config.get('ALLOWED_UPLOAD_MIME'),
      maxBytes: this.config.get('MAX_UPLOAD_MB') * 1024 * 1024,
    });

    const stored = await this.storage.put({
      prefix: `requests/${actor.companyId}`,
      originalName: file.originalname,
      contentType,
      data: file.buffer,
    });

    await this.prisma.client.attachment.create({
      data: {
        companyId: actor.companyId,
        entityType: 'AssetRequest',
        entityId: id,
        assetRequestId: id,
        storageKey: stored.key,
        originalName: file.originalname,
        mimeType: contentType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        scanStatus: 'SKIPPED',
        caption: caption ?? null,
        uploadedById: actor.id,
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.REQUEST_SUBMITTED,
      entityType: 'AssetRequest',
      entityId: id,
      newValues: { attachment: file.originalname },
      reason: 'Attachment added',
    });

    return this.findOne(actor, id);
  }

  /** Streams one attachment, but only if it belongs to a request the actor may see. */
  async getAttachment(actor: AuthUser, id: string, attachmentId: string) {
    await this.findOne(actor, id); // scope gate first

    const attachment = await this.prisma.client.attachment.findFirst({
      where: {
        id: attachmentId,
        assetRequestId: id,
        companyId: actor.companyId,
        deletedAt: null,
      },
      select: { storageKey: true, originalName: true, mimeType: true },
    });
    if (!attachment) throw AppError.notFound('Attachment', attachmentId);

    const data = await this.storage.get(attachment.storageKey);
    return { data, ...attachment };
  }

  /** The requester may remove an attachment they added while the request is theirs. */
  async removeAttachment(actor: AuthUser, id: string, attachmentId: string) {
    const request = await this.findOne(actor, id);
    const attachment = await this.prisma.client.attachment.findFirst({
      where: { id: attachmentId, assetRequestId: id, companyId: actor.companyId, deletedAt: null },
      select: { id: true, uploadedById: true },
    });
    if (!attachment) throw AppError.notFound('Attachment', attachmentId);

    const isOwner = request.requester?.id === actor.id;
    if (!isOwner && !actor.permissions.includes(PERMISSIONS.REQUESTS_APPROVE)) {
      throw AppError.notFound('Attachment', attachmentId);
    }

    await this.prisma.client.attachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() },
    });
    return this.findOne(actor, id);
  }

  /**
   * Loads for mutation using the tenant filter, not the scope filter.
   *
   * An approver must be able to act on a request that is not "theirs" by scope;
   * authority to act is decided by permission and workflow step, not visibility.
   */
  private async loadForWrite(actor: AuthUser, id: string) {
    const request = await this.prisma.client.assetRequest.findFirst({
      where: { id, ...tenantFilter(actor) },
    });
    if (!request) throw AppError.notFound('Request', id);
    return request;
  }

  /** Request types, exposed so the UI need not hard-code the enum. */
  types(): readonly RequestType[] {
    return [
      'NEW_EMPLOYEE_ONBOARDING',
      'REPLACEMENT',
      'DAMAGE',
      'LOSS',
      'UPGRADE',
      'TEMPORARY_ASSIGNMENT',
      'PROJECT_REQUIREMENT',
      'OFFICE_REQUIREMENT',
      'KITCHEN_REQUIREMENT',
      'ACCESSIBILITY_REQUIREMENT',
      'ADDITIONAL_EQUIPMENT',
      'REPAIR',
      'RETURN',
    ];
  }
}
