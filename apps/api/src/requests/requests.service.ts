import { Logger, Injectable } from '@nestjs/common';
import { ApprovalDecision, AuditAction, Prisma, type NotificationType, type RequestType } from '@prisma/client';
import type { AuthUser, CreateRequestInput, RequestListQuery } from '@techpioasset/contracts';
import {
  EQUIPMENT_CATALOG,
  assertTransition,
  findIssueCategory,
  requestStatusMachine,
  PERMISSIONS,
  type RequestStatus,
  decideRequestCreation,
  type RequestCreationPolicy,
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

/** The client shape Prisma passes to interactive-transaction callbacks. */
type Tx = Omit<
  PrismaService['client'],
  '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'
>;

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
                  // v2.24 - no manager recorded: the Manager role stands in, so
                  // those requests land in every Manager-role holder's inbox.
                  ...(actor.roles.includes('MANAGER')
                    ? [
                        {
                          approverType: 'LINE_MANAGER' as const,
                          request: { managerId: null, requesterId: { not: actor.id } },
                        },
                      ]
                    : []),
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
        details: true,
        replacesAssetId: true,
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
            isUncatalogued: true,
            manufacturer: true,
            model: true,
            referenceUrl: true,
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
            reviewStartedAt: true,
            reviewStartedBy: {
              select: { id: true, profile: { select: { firstName: true, lastName: true } } },
            },
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
          //
          // The id breaks ties. Comments posted in the same millisecond - which
          // a script, an import or a busy thread all manage - otherwise leave
          // "the newest 100" undefined, so the cap could drop the most recent
          // comment and keep an older one. Ids are cuids, which carry their
          // creation time, so this orders the tie the way it happened.
          take: 100,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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

    // The asset this request is about (upgrade/repair/replacement), as a
    // light reference the detail page can link to.
    const aboutAsset = request.replacesAssetId
      ? await this.prisma.client.asset.findFirst({
          where: { id: request.replacesAssetId, companyId: actor.companyId },
          select: { id: true, assetTag: true, name: true, serialNumber: true },
        })
      : null;

    return {
      ...request,
      aboutAsset,
      // Fetched newest-first so the cap keeps the RECENT comments; read
      // oldest-first, which is how a conversation is followed.
      comments: [...request.comments].reverse(),
      canDecide,
      waitingOn: await this.describeCurrentStep(actor, id),
    };
  }

  /**
   * Who the request is actually sitting with, and whether that is anybody.
   *
   * A step names a role or "the line manager" rather than a person, so a chain
   * can point at nobody: a requester with no manager recorded, or a role no
   * account holds. The request then waits forever, appears in no one's approval
   * queue, and the detail page shows the same "Manager review - pending" it
   * would show if a real person were about to act on it.
   *
   * Every request in the live tenant was stuck this way, which is what made the
   * difference between "waiting on someone" and "waiting on no one" worth
   * putting on the screen.
   */
  private async describeCurrentStep(actor: AuthUser, requestId: string) {
    const step = await this.prisma.client.requestApproval.findFirst({
      where: { requestId, decision: 'PENDING' },
      orderBy: { stepOrder: 'asc' },
      select: {
        stepName: true,
        approverType: true,
        approverRoleId: true,
        approverId: true,
      },
    });
    if (!step) return null;

    const approverIds = await this.pendingApproverIds(requestId);
    const [people, role] = await Promise.all([
      approverIds.length
        ? this.prisma.client.user.findMany({
            where: { id: { in: approverIds }, deletedAt: null },
            // Bounded to match pendingApproverIds, which already caps a role's
            // holders at 25: this is a line of names under a heading, not a list.
            take: 25,
            select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } },
          })
        : Promise.resolve([]),
      step.approverRoleId
        ? this.prisma.client.role.findUnique({
            where: { id: step.approverRoleId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      stepName: step.stepName,
      approverType: step.approverType,
      roleName: role?.name ?? null,
      approvers: people.map((p) => ({
        id: p.id,
        name: [p.profile?.firstName, p.profile?.lastName].filter(Boolean).join(' ') || p.email,
      })),
      /** Nobody can act on this request until the configuration below is fixed. */
      blocked: people.length === 0,
      /** What to change, in the words of the thing that is missing. */
      blockedReason:
        people.length > 0
          ? null
          : step.approverType === 'LINE_MANAGER'
            ? 'The requester has no manager recorded and nobody holds the Manager role, so there is nobody to approve the step.'
            : role
              ? `Nobody holds the ${role.name} role, so there is nobody to approve this step.`
              : 'This step has no approver assigned, so there is nobody to approve it.',
    };
  }

  /**
   * v2.22 - may this person raise a request at all?
   *
   * `requests:create` is the floor and the guard on the route already enforced
   * it; this is the company policy on top, plus any per-person exception. The
   * refusal carries the reason, because "403" tells somebody nothing about who
   * to ask.
   */
  /** The same decision assertMayRaise() enforces, for the UI to read. */
  async canCreate(actor: AuthUser) {
    return this.decideRaise(actor);
  }

  private async assertMayRaise(actor: AuthUser): Promise<void> {
    const decision = await this.decideRaise(actor);
    if (!decision.allowed) {
      throw new AppError('FORBIDDEN', 'You cannot raise a request', { detail: decision.reason });
    }
  }

  private async decideRaise(actor: AuthUser) {
    const [company, profile] = await Promise.all([
      this.prisma.client.company.findUnique({
        where: { id: actor.companyId },
        select: { requestPolicy: true },
      }),
      this.prisma.client.userProfile.findUnique({
        where: { userId: actor.id },
        select: { canRaiseRequests: true },
      }),
    ]);

    const decision = decideRequestCreation({
      policy: (company?.requestPolicy ?? 'EVERYONE') as RequestCreationPolicy,
      override: profile?.canRaiseRequests ?? null,
      hasCreatePermission: actor.permissions.includes(PERMISSIONS.REQUESTS_CREATE),
      raisesOnBehalf: actor.permissions.includes(PERMISSIONS.REQUESTS_CREATE_ON_BEHALF),
    });
    return decision;
  }

  /**
   * The open ticket that makes a new one a duplicate, if any: same subject,
   * same type, same asset (or an identical item), still in flight, younger
   * than 10 days. DRAFTs never block - an abandoned half-form is not a ticket.
   */
  private async findOpenDuplicate(
    companyId: string,
    subjectId: string,
    input: { type: RequestType; targetAssetId: string | null; itemDescriptions: string[] },
  ) {
    // v2.21 - with no asset and no named item there is nothing to be a
    // duplicate OF, so the guard stands down rather than matching on nothing.
    const named = input.itemDescriptions.filter((d) => d.trim().length > 0);
    if (!input.targetAssetId && named.length === 0) return null;
    return this.findOpenDuplicateInner(companyId, subjectId, input, named);
  }

  private async findOpenDuplicateInner(
    companyId: string,
    subjectId: string,
    input: { type: RequestType; targetAssetId: string | null; itemDescriptions: string[] },
    named: string[],
  ) {
    const since = new Date(Date.now() - 10 * 86_400_000);
    return this.prisma.client.assetRequest.findFirst({
      where: {
        companyId,
        type: input.type,
        status: { notIn: ['DRAFT', 'REJECTED', 'COMPLETED', 'CANCELLED'] },
        createdAt: { gte: since },
        // The SUBJECT owns the duplicate space: HR raising for two different
        // people is two problems, not one.
        OR: [{ beneficiaryId: subjectId }, { beneficiaryId: null, requesterId: subjectId }],
        ...(input.targetAssetId
          ? { replacesAssetId: input.targetAssetId }
          : {
              items: {
                some: {
                  OR: named.map((d) => ({
                    description: { equals: d.trim(), mode: 'insensitive' as const },
                  })),
                },
              },
            }),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, requestNumber: true, status: true, createdAt: true },
    });
  }

  /** Pre-check for the form: lets the UI point at the existing ticket BEFORE
   * a submit bounces. Same rule as the create-time guard. */
  async openDuplicate(
    actor: AuthUser,
    query: { type: RequestType; targetAssetId?: string; item?: string },
  ) {
    const duplicate = await this.findOpenDuplicate(actor.companyId, actor.id, {
      type: query.type,
      targetAssetId: query.targetAssetId ?? null,
      itemDescriptions: query.item ? [query.item] : [],
    });
    return { duplicate };
  }

  /**
   * The caller's own assigned assets, shaped for the dynamic request form.
   * Scoped to the requester by construction - no cost fields, no other
   * people's equipment - so the form can never show what the API would refuse.
   */
  async eligibleAssets(actor: AuthUser) {
    return this.prisma.client.asset.findMany({
      where: { companyId: actor.companyId, deletedAt: null, assignedUserId: actor.id },
      orderBy: { name: 'asc' },
      take: 100,
      select: {
        id: true,
        name: true,
        assetTag: true,
        serialNumber: true,
        brand: true,
        model: true,
        status: true,
        condition: true,
        purchaseDate: true,
        warrantyEndDate: true,
        category: { select: { id: true, name: true } },
        office: { select: { name: true } },
        hardwareProfile: {
          select: { manufacturer: true, cpu: true, ramGb: true, storageTotalGb: true },
        },
      },
    });
  }

  /**
   * Equipment picker contents: the domain baseline merged with the distinct
   * asset names this company actually owns, grouped by category. DB-driven by
   * design - a tenant's register grows the list, no hardcode to maintain.
   */
  async equipmentCatalog(actor: AuthUser) {
    const [categories, owned, curated] = await Promise.all([
      this.prisma.client.category.findMany({
        where: { companyId: actor.companyId },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, key: true },
      }),
      this.prisma.client.asset.findMany({
        where: { companyId: actor.companyId, deletedAt: null },
        distinct: ['name'],
        orderBy: { name: 'asc' },
        take: 400,
        select: { name: true, category: { select: { name: true } } },
      }),
      this.prisma.client.catalogItem.findMany({
        where: { companyId: actor.companyId },
        orderBy: { name: 'asc' },
        take: 400,
        select: { name: true, category: { select: { name: true } } },
      }),
    ]);

    const groups = new Map<string, Set<string>>();
    for (const { group, items } of EQUIPMENT_CATALOG) {
      groups.set(group, new Set(items));
    }
    for (const entry of [...owned, ...curated]) {
      const label = entry.category?.name ?? 'In your register';
      if (!groups.has(label)) groups.set(label, new Set());
      groups.get(label)!.add(entry.name);
    }

    return {
      groups: [...groups.entries()].map(([label, items]) => ({
        label,
        items: [...items].sort((a, b) => a.localeCompare(b)),
      })),
      categories,
    };
  }

  /**
   * Admin review outcome for an uncatalogued item: promote the NAME into the
   * curated catalog so future requests offer it. Deliberately creates no
   * asset and no serial - only procurement turns a purchase into inventory.
   */
  async addCatalogItem(actor: AuthUser, input: { name: string; categoryId?: string | null }) {
    const existing = await this.prisma.client.catalogItem.findFirst({
      where: { companyId: actor.companyId, name: { equals: input.name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (existing) {
      throw AppError.conflict('CONFLICT', `"${existing.name}" is already in the catalog`);
    }
    if (input.categoryId) {
      const category = await this.prisma.client.category.findFirst({
        where: { id: input.categoryId, companyId: actor.companyId },
        select: { id: true },
      });
      if (!category) throw AppError.notFound('Category', input.categoryId);
    }
    const item = await this.prisma.client.catalogItem.create({
      data: {
        companyId: actor.companyId,
        name: input.name,
        categoryId: input.categoryId ?? null,
        createdById: actor.id,
      },
      select: { id: true, name: true, categoryId: true },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'CatalogItem',
      entityId: item.id,
      newValues: { name: item.name, categoryId: item.categoryId },
    });
    return item;
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

    // v2.22 - the company's request policy, and any exception recorded against
    // this person. Checked here rather than only in the UI: hiding a button is
    // a courtesy, this is the rule.
    await this.assertMayRaise(actor);

    const beneficiaryId = input.beneficiaryId ?? actor.id;
    const beneficiaryProfile = await this.prisma.client.userProfile.findUnique({
      where: { userId: beneficiaryId },
      select: { managerId: true, departmentId: true, officeId: true },
    });

    // v2.17: one open ticket per problem. The same subject re-raising the
    // same type about the same asset (or the same item) while the earlier
    // request is still in flight gets pointed at the existing ticket instead.
    // The block expires after 10 days so a stalled approval never locks
    // anyone out for good.
    const dupTargetAssetId = input.details?.targetAssetId ?? input.replacesAssetId ?? null;
    const duplicate = await this.findOpenDuplicate(actor.companyId, beneficiaryId, {
      type: input.type,
      targetAssetId: dupTargetAssetId,
      itemDescriptions: input.items.map((i) => i.description),
    });
    if (duplicate) {
      throw new AppError(
        'CONFLICT',
        `You already have an open request about this (${duplicate.requestNumber})`,
        {
          detail:
            'Open that request and ask for an update in its comments. If it is still ' +
            'unresolved after 10 days, you can raise it again.',
        },
      );
    }

    // v2.17 dynamic form: when the request is ABOUT a specific asset, the
    // asset must exist here and be assigned to the request's subject - the
    // frontend filters, but only this check makes it a rule. Wider-scope
    // roles (assets:read) may reference any company asset.
    const targetAssetId = input.details?.targetAssetId ?? input.replacesAssetId ?? null;
    if (targetAssetId) {
      const target = await this.prisma.client.asset.findFirst({
        where: { id: targetAssetId, companyId: actor.companyId, deletedAt: null },
        select: { id: true, assignedUserId: true },
      });
      if (!target) throw AppError.notFound('Asset', targetAssetId);
      // Assigned-to-the-subject, or a company-wide role: OWN/DEPARTMENT-scope
      // requesters may only reference their own (or their beneficiary's) gear.
      if (target.assignedUserId !== beneficiaryId && actor.scope !== 'ALL') {
        throw new AppError('VALIDATION_FAILED', 'That asset is not assigned to you', {
          fieldErrors: [
            { path: 'details.targetAssetId', message: 'Pick one of your own assigned assets' },
          ],
        });
      }
    }

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
        isReplacement: input.isReplacement || input.type === 'REPLACEMENT',
        replacesAssetId: targetAssetId,
        details: input.details ? (input.details as Prisma.InputJsonValue) : undefined,
        estimatedCost,
        currency:
          input.currency ??
          (
            await this.prisma.client.company.findUniqueOrThrow({
              where: { id: actor.companyId },
              select: { baseCurrency: true },
            })
          ).baseCurrency,
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
            isUncatalogued: item.isUncatalogued ?? false,
            manufacturer: item.manufacturer ?? null,
            model: item.model ?? null,
            referenceUrl: item.referenceUrl ?? null,
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

    const requesterProfile = await this.prisma.client.userProfile.findUnique({
      where: { userId: request.requesterId },
      select: { managerId: true },
    });

    const promoted = await this.prisma.client.$transaction(async (tx) => {
      await tx.requestApproval.createMany({
        // Everything queues as WAITING; promoteUntilStaffed picks the first
        // step somebody can actually act on and skips past unstaffed ones, so
        // a chain whose opening step points at an empty role does not stall on
        // the day it is raised.
        data: steps.map((step) => ({
          requestId: id,
          stepOrder: step.stepOrder,
          stepName: step.stepName,
          approverType: step.approverType,
          approverRoleId: step.approverRoleId,
          approverId: step.approverId,
          slaDueAt: step.slaDueAt,
          decision: ApprovalDecision.WAITING,
        })),
      });

      const result = await this.promoteUntilStaffed(tx, {
        requestId: id,
        companyId: actor.companyId,
        requesterManagerId: requesterProfile?.managerId ?? null,
        requesterId: request.requesterId,
      });

      // steps.length > 0 and the last step is never skipped, so a current step
      // always exists here.
      const current = result.current!;
      await tx.assetRequest.update({
        where: { id },
        data: {
          status: this.workflow.statusForStep({
            stepOrder: current.stepOrder,
            stepName: current.stepName,
            approverType: current.approverType,
            approverRoleId: current.approverRoleId,
            approverRoleKey: current.approverRole?.key ?? null,
            approverId: current.approverId,
            slaDueAt: current.slaDueAt,
          }),
          submittedAt: new Date(),
          workflowDefinitionId: definitionId,
          currentStepOrder: current.stepOrder,
          updatedById: actor.id,
          version: { increment: 1 },
        },
      });
      return result;
    });

    const submittedTo = await this.prisma.client.assetRequest.findUnique({
      where: { id },
      select: { status: true },
    });
    await this.recordSubmission(actor, id, request.requestNumber, submittedTo?.status ?? 'SUBMITTED');
    if (promoted.skipped.length > 0) {
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.REQUEST_SUBMITTED,
        entityType: 'AssetRequest',
        entityId: id,
        newValues: { skippedSteps: promoted.skipped, reason: 'No approver holds these steps' },
      });
    }
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

    // resolveStepApprovers already excludes the requester, so "waiting on you"
    // can never land in the inbox of the person who raised it.
    const recipients = await this.resolveStepApprovers(this.prisma.client, {
      companyId,
      approverType: approval.approverType,
      approverId: approval.approverId,
      approverRoleId: approval.approverRoleId,
      requesterManagerId: approval.request.requester.profile?.managerId ?? null,
      requesterId: approval.request.requesterId,
    });

    // An approval nobody will ever see is a stalled request wearing a clean
    // status. When the step resolves to zero recipients (a role with no
    // members, a requester without a manager), the user-managers are told
    // instead - they are the ones who can assign the role or set the manager.
    if (recipients.length === 0) {
      const managers = await this.prisma.client.userRole.findMany({
        where: {
          role: {
            companyId,
            permissions: { some: { permission: { key: 'users:manage' } } },
          },
          user: { deletedAt: null, status: 'ACTIVE' },
        },
        select: { userId: true },
        distinct: ['userId'],
        take: 20,
      });
      await this.notifications.notifyMany(
        managers.map((m) => m.userId).filter((uid) => uid !== approval.request.requesterId),
        {
          companyId,
          type: 'APPROVAL_REQUIRED',
          title: `Request ${requestNumber} has no approver`,
          body: `${approval.stepName} routes to a role nobody holds. Assign the role under People, or decide the request yourself.`,
          linkPath: `/requests/${requestId}`,
          entityType: 'AssetRequest',
          entityId: requestId,
        },
      );
      return;
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

  /**
   * v2.24 - "I have seen it, I am on it", without deciding.
   *
   * A PENDING step read "Awaiting decision" whether the approver had opened it
   * or ignored it for a week, so requesters could not tell silence from
   * progress. Marking the step under review changes only what the chain says -
   * "Under review by X since Y" - never what anyone may do; approve and reject
   * stay available exactly as before.
   *
   * Guarded by the same rule as a decision: only the current step's approver
   * may claim it. First claim sticks - two HR people opening the same request
   * do not overwrite each other - and asking again is a harmless no-op rather
   * than an error, so a double-click costs nothing.
   */
  async startReview(actor: AuthUser, id: string) {
    const request = await this.loadForWrite(actor, id);
    const approval = await this.workflow.assertCanDecide({
      requestId: id,
      actorId: actor.id,
      actorRoleKeys: actor.roles,
    });

    if (approval.reviewStartedAt) return this.findOne(actor, id);

    await this.prisma.client.requestApproval.update({
      where: { id: approval.id },
      data: { reviewStartedAt: new Date(), reviewStartedById: actor.id },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.REQUEST_REVIEW_STARTED,
      entityType: 'AssetRequest',
      entityId: id,
      newValues: { step: approval.stepName },
    });

    // The requester learns somebody picked it up - the entire point.
    await this.notifications.notify({
      companyId: actor.companyId,
      userId: request.requesterId,
      type: 'REQUEST_COMMENT',
      title: `Request ${request.requestNumber} is being reviewed`,
      body: `${approval.stepName} has started looking at your request.`,
      linkPath: `/requests/${id}`,
      entityType: 'AssetRequest',
      entityId: id,
    });

    return this.findOne(actor, id);
  }

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

    const { current: nextStep, skipped } = await this.prisma.client.$transaction(async (tx) => {
      await tx.requestApproval.update({
        where: { id: approval.id },
        data: {
          decision: ApprovalDecision.APPROVED,
          decidedAt: now,
          comment,
          approverId: actor.id,
        },
      });

      // Promote the next step somebody can act on; unstaffed ones skip with
      // the reason written on the step.
      return this.promoteUntilStaffed(tx, {
        requestId: id,
        companyId: actor.companyId,
        requesterManagerId: approval.request.requester.profile?.managerId ?? null,
        requesterId: approval.request.requesterId,
      });
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
      newValues: {
        status: nextStatus,
        step: approval.stepName,
        ...(skipped.length ? { skippedSteps: skipped } : {}),
      },
      reason: comment,
    });

    if (nextStep) {
      await this.notifyApprovers(actor.companyId, id, request.requestNumber);
      // The requester hears about EVERY move, not only the terminal one - a
      // three-step chain that only ever emails at the end reads as two weeks
      // of silence. Same type as the final approval, so it emails.
      await this.notifications.notify({
        companyId: actor.companyId,
        userId: request.requesterId,
        type: 'REQUEST_APPROVED',
        title: `${request.requestNumber}: ${approval.stepName} approved`,
        body:
          `${approval.stepName} approved${comment ? ` — “${comment}”` : ''}.` +
          (skipped.length ? ` ${skipped.join(', ')} skipped (nobody holds that role).` : '') +
          ` Now with ${nextStep.stepName}.`,
        linkPath: `/requests/${id}`,
        entityType: 'AssetRequest',
        entityId: id,
      });
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

    // v2.24 - every fulfilment move reaches the requester's inbox and email,
    // not only "ready": a request that goes quiet between approval and handover
    // reads as lost, and "where is it?" tickets follow.
    const fulfilmentNote: Partial<Record<RequestStatus, { type: NotificationType; title: string; body: string }>> = {
      INVENTORY_RESERVED: {
        type: 'ASSET_READY',
        title: `${request.requestNumber}: reserved from stock`,
        body: 'Your equipment has been reserved from existing stock and is being prepared.',
      },
      ORDERED: {
        type: 'ASSET_ORDERED',
        title: `${request.requestNumber}: ordered`,
        body: 'Your equipment has been ordered from the supplier.',
      },
      RECEIVED: {
        type: 'ASSET_RECEIVED',
        title: `${request.requestNumber}: arrived`,
        body: 'Your equipment has arrived and is being booked in.',
      },
      READY_FOR_ASSIGNMENT: {
        type: 'ASSET_READY',
        title: `Ready for collection: ${request.requestNumber}`,
        body: 'Your equipment is ready.',
      },
      COMPLETED: {
        type: 'REQUEST_APPROVED',
        title: `${request.requestNumber}: completed`,
        body: 'Your request is complete. If anything is not right, reply on the request.',
      },
    };
    const note = fulfilmentNote[status];
    if (note) {
      await this.notifications.notify({
        companyId: actor.companyId,
        userId: request.beneficiaryId ?? request.requesterId,
        type: note.type,
        title: note.title,
        body: note.body,
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

    // v2.17: a message should reach the other side of the ticket, not sit
    // unseen. Requester-side messages go to whoever holds the pending step;
    // reviewer replies (never internal notes) go to the requester.
    const request = await this.prisma.client.assetRequest.findUniqueOrThrow({
      where: { id },
      select: { companyId: true, requesterId: true, beneficiaryId: true, requestNumber: true },
    });
    const excerpt = body.length > 140 ? `${body.slice(0, 137)}…` : body;
    const requesterSide = actor.id === request.requesterId || actor.id === request.beneficiaryId;
    if (requesterSide) {
      const approvers = (await this.pendingApproverIds(id)).filter((uid) => uid !== actor.id);
      await this.notifications.notifyMany(approvers, {
        companyId: request.companyId,
        type: 'REQUEST_COMMENT',
        title: `New message on ${request.requestNumber}`,
        body: excerpt,
        linkPath: `/requests/${id}`,
        entityType: 'AssetRequest',
        entityId: id,
      });
    } else if (!isInternal) {
      const targets = [request.requesterId, request.beneficiaryId].filter(
        (uid): uid is string => Boolean(uid) && uid !== actor.id,
      );
      await this.notifications.notifyMany(targets, {
        companyId: request.companyId,
        type: 'REQUEST_COMMENT',
        title: `Reply on your request ${request.requestNumber}`,
        body: excerpt,
        linkPath: `/requests/${id}`,
        entityType: 'AssetRequest',
        entityId: id,
      });
    }

    return this.findOne(actor, id);
  }

  /** Who currently holds the pending approval step, resolved the same way the
   * submit-time notification resolves it. */
  /**
   * Moves the chain to the next step somebody can actually act on (v2.24).
   *
   * A step whose approver set is empty - a role nobody holds - is marked
   * SKIPPED with the reason written on the step itself, and the chain moves
   * on. The LAST remaining step is never skipped: however unstaffed, a request
   * must end on a human decision, and for an empty role the deadlock-breaker
   * in assertCanDecide already lets a user-manager supply it.
   */
  private async promoteUntilStaffed(
    tx: Tx,
    ctx: {
      requestId: string;
      companyId: string;
      requesterManagerId: string | null;
      requesterId: string;
    },
  ) {
    const skipped: string[] = [];
    for (;;) {
      const waiting = await tx.requestApproval.findMany({
        where: { requestId: ctx.requestId, decision: ApprovalDecision.WAITING },
        orderBy: { stepOrder: 'asc' },
        take: 2,
        include: { approverRole: true },
      });
      const next = waiting[0];
      if (!next) return { current: null, skipped };

      const approvers = await this.resolveStepApprovers(tx, {
        companyId: ctx.companyId,
        approverType: next.approverType,
        approverId: next.approverId,
        approverRoleId: next.approverRoleId,
        requesterManagerId: ctx.requesterManagerId,
        requesterId: ctx.requesterId,
      });

      if (approvers.length === 0 && waiting.length > 1) {
        await tx.requestApproval.update({
          where: { id: next.id },
          data: {
            decision: ApprovalDecision.SKIPPED,
            decidedAt: new Date(),
            comment: next.approverRole
              ? `Skipped automatically — nobody eligible holds the ${next.approverRole.name} role.`
              : 'Skipped automatically — this step has no approver.',
          },
        });
        skipped.push(next.stepName);
        continue;
      }

      await tx.requestApproval.update({
        where: { id: next.id },
        data: { decision: ApprovalDecision.PENDING },
      });
      return { current: next, skipped };
    }
  }

  private async pendingApproverIds(requestId: string): Promise<string[]> {
    const approval = await this.prisma.client.requestApproval.findFirst({
      where: { requestId, decision: ApprovalDecision.PENDING },
      orderBy: { stepOrder: 'asc' },
      include: { request: { include: { requester: { include: { profile: true } } } } },
    });
    if (!approval) return [];
    return this.resolveStepApprovers(this.prisma.client, {
      companyId: approval.request.companyId,
      approverType: approval.approverType,
      approverId: approval.approverId,
      approverRoleId: approval.approverRoleId,
      requesterManagerId: approval.request.requester.profile?.managerId ?? null,
      requesterId: approval.request.requesterId,
    });
  }

  /**
   * Who can actually act on a step - the one resolution rule (v2.24).
   *
   * A LINE_MANAGER step goes to the recorded line manager; with none recorded
   * it goes to every active holder of the Manager role, because most companies
   * never fill in per-person managers and a step that resolves to nobody is a
   * request that stalls forever wearing a clean status. Mirrors the domain's
   * canApproveStep exactly - what this returns is who that function admits.
   */
  private async resolveStepApprovers(
    db: Pick<Tx, 'userRole'>,
    step: {
      companyId: string;
      approverType: string;
      approverId: string | null;
      approverRoleId: string | null;
      requesterManagerId: string | null;
      /** Excluded from the result: segregation of duties forbids self-approval. */
      requesterId: string;
    },
  ): Promise<string[]> {
    // The requester is never an approver of their own request, whatever role
    // they hold (BR-04, enforced in canApproveStep). Excluded here so every
    // caller agrees: an IT team of one cannot approve their own IT step, so a
    // step staffed only by the requester counts as unstaffed - it must skip,
    // not sit pending on somebody the server will refuse.
    const notRequester = (ids: string[]) => ids.filter((id) => id !== step.requesterId);

    if (step.approverId) return notRequester([step.approverId]);

    if (step.approverType === 'LINE_MANAGER') {
      if (step.requesterManagerId) return notRequester([step.requesterManagerId]);
      const managers = await db.userRole.findMany({
        where: {
          role: { companyId: step.companyId, key: 'MANAGER' },
          user: { deletedAt: null, status: 'ACTIVE' },
        },
        select: { userId: true },
        take: 25,
      });
      return notRequester(managers.map((m) => m.userId));
    }

    if (step.approverRoleId) {
      const holders = await db.userRole.findMany({
        where: { roleId: step.approverRoleId, user: { deletedAt: null, status: 'ACTIVE' } },
        select: { userId: true },
        take: 25,
      });
      return notRequester(holders.map((h) => h.userId));
    }
    return [];
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
