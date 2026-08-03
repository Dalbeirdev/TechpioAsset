import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AuthUser,
  BudgetListQuery,
  CostCentreListQuery,
  CreateBudgetInput,
  CreateCostCentreInput,
  UpdateBudgetInput,
  UpdateCostCentreInput,
} from '@techpioasset/contracts';
import {
  budgetLimitMessage,
  budgetRemaining,
  budgetUtilisationPercent,
  periodsOverlap,
} from '@techpioasset/domain';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { paginate } from '../common/paginate.js';
import { PrismaService, type TenantTxClient } from '../prisma/prisma.service.js';

/**
 * v2.9 C2 — budgets as hard limits.
 *
 * `commit` and `release` are the whole point of this service. Everything else
 * is the administration needed to have something to commit against.
 *
 * The enforcement is the seat-pool pattern: an atomic conditional UPDATE whose
 * WHERE clause IS the limit, so two approvers racing the last of a budget are
 * separated by Postgres rather than by a read-then-write that both pass. The
 * CHECK constraint on the table is the backstop, and the refusal carries the
 * real numbers because "budget exceeded" tells nobody what to do next.
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── cost centres ───────────────────────────────────────────────────────────

  async listCostCentres(actor: AuthUser, query: CostCentreListQuery) {
    return paginate(query, {
      count: () =>
        this.prisma.client.costCentre.count({
          where: {
            companyId: actor.companyId,
            deletedAt: null,
            ...(query.activeOnly ? { isActive: true } : {}),
          },
        }),
      findMany: ({ skip, take }) =>
        this.prisma.client.costCentre.findMany({
          where: {
            companyId: actor.companyId,
            deletedAt: null,
            ...(query.activeOnly ? { isActive: true } : {}),
          },
          orderBy: { code: 'asc' },
          skip,
          take,
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
            notes: true,
            department: { select: { id: true, name: true } },
            owner: { select: { id: true, email: true } },
            _count: { select: { budgets: true } },
          },
        }),
    });
  }

  async createCostCentre(actor: AuthUser, input: CreateCostCentreInput) {
    await this.assertReferences(actor, input.departmentId, input.ownerId);
    const created = await this.prisma.client.costCentre
      .create({
        data: {
          companyId: actor.companyId,
          code: input.code,
          name: input.name,
          departmentId: input.departmentId ?? null,
          ownerId: input.ownerId ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
        select: { id: true, code: true, name: true, isActive: true },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw AppError.conflict('CONFLICT', `Cost centre ${input.code} already exists`);
        }
        throw error;
      });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.COST_CENTRE_CREATED,
      entityType: 'CostCentre',
      entityId: created.id,
      newValues: { code: created.code, name: created.name },
    });
    return created;
  }

  async updateCostCentre(actor: AuthUser, id: string, input: UpdateCostCentreInput) {
    const existing = await this.loadCostCentre(actor, id);
    await this.assertReferences(actor, input.departmentId, input.ownerId);
    const updated = await this.prisma.client.costCentre.update({
      where: { id: existing.id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedById: actor.id,
      },
      select: { id: true, code: true, name: true, isActive: true },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.COST_CENTRE_UPDATED,
      entityType: 'CostCentre',
      entityId: id,
      previousValues: { code: existing.code, name: existing.name, isActive: existing.isActive },
      newValues: { code: updated.code, name: updated.name, isActive: updated.isActive },
    });
    return updated;
  }

  // ── budgets ────────────────────────────────────────────────────────────────

  async listBudgets(actor: AuthUser, query: BudgetListQuery) {
    const where: Prisma.BudgetWhereInput = {
      companyId: actor.companyId,
      deletedAt: null,
      ...(query.costCentreId ? { costCentreId: query.costCentreId } : {}),
      ...(query.on ? { periodStart: { lte: query.on }, periodEnd: { gte: query.on } } : {}),
    };
    const page = await paginate(query, {
      count: () => this.prisma.client.budget.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.budget.findMany({
          where,
          orderBy: [{ periodStart: 'desc' }, { name: 'asc' }],
          skip,
          take,
          select: this.budgetSelect(),
        }),
    });
    return { ...page, data: page.data.map((b) => this.withConsumption(b)) };
  }

  async findBudget(actor: AuthUser, id: string) {
    const budget = await this.prisma.client.budget.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: this.budgetSelect(),
    });
    if (!budget) throw AppError.notFound('Budget', id);
    // What the money is actually holding, named, so the number is answerable.
    const commitments = await this.prisma.client.purchaseRequest.findMany({
      where: { budgetId: id, committedAmount: { not: null } },
      orderBy: { committedAt: 'desc' },
      select: {
        id: true,
        prNumber: true,
        status: true,
        committedAmount: true,
        committedAt: true,
        requester: { select: { id: true, email: true } },
      },
    });
    return { ...this.withConsumption(budget), commitments };
  }

  async createBudget(actor: AuthUser, input: CreateBudgetInput) {
    const costCentre = await this.loadCostCentre(actor, input.costCentreId);
    // Two budgets covering one day would make "which budget does this charge?"
    // ambiguous, so the overlap is refused here rather than tie-broken later.
    const siblings = await this.prisma.client.budget.findMany({
      where: { costCentreId: costCentre.id, deletedAt: null },
      select: { name: true, periodStart: true, periodEnd: true },
    });
    const clash = siblings.find((s) => periodsOverlap(s, input));
    if (clash) {
      throw AppError.conflict(
        'CONFLICT',
        `Budget ${clash.name} already covers part of that period for ${costCentre.code}`,
      );
    }
    const created = await this.prisma.client.budget.create({
      data: {
        companyId: actor.companyId,
        costCentreId: costCentre.id,
        name: input.name,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        currency: input.currency.toUpperCase(),
        amount: new Prisma.Decimal(input.amount),
        notes: input.notes ?? null,
        createdById: actor.id,
      },
      select: this.budgetSelect(),
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.BUDGET_CREATED,
      entityType: 'Budget',
      entityId: created.id,
      newValues: { name: created.name, amount: created.amount.toString(), currency: created.currency },
    });
    return this.withConsumption(created);
  }

  /**
   * The period and cost centre are deliberately immutable: moving them would
   * silently re-point live commitments at a different pot of money.
   */
  async updateBudget(actor: AuthUser, id: string, input: UpdateBudgetInput) {
    const existing = await this.prisma.client.budget.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: { id: true, name: true, amount: true, committed: true, currency: true },
    });
    if (!existing) throw AppError.notFound('Budget', id);

    if (input.amount !== undefined) {
      const next = new Prisma.Decimal(input.amount);
      // Cutting a budget below what it is already holding would put the table
      // in a state the CHECK constraint forbids - and, more importantly, would
      // mean somebody has approved spending that no longer has cover.
      if (next.lessThan(existing.committed)) {
        throw AppError.conflict(
          'CONFLICT',
          `Cannot reduce ${existing.name} to ${next.toFixed(2)}: ${existing.committed.toFixed(2)} ` +
            `${existing.currency} is already committed. Release commitments first.`,
        );
      }
    }
    const updated = await this.prisma.client.budget.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedById: actor.id,
        version: { increment: 1 },
      },
      select: this.budgetSelect(),
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.BUDGET_UPDATED,
      entityType: 'Budget',
      entityId: id,
      previousValues: { name: existing.name, amount: existing.amount.toString() },
      newValues: { name: updated.name, amount: updated.amount.toString() },
    });
    return this.withConsumption(updated);
  }

  /** Cost-centre reporting: what each pot holds, on one page. */
  async consumptionReport(actor: AuthUser, on?: Date) {
    const day = on ?? new Date();
    const budgets = await this.prisma.client.budget.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        periodStart: { lte: day },
        periodEnd: { gte: day },
      },
      orderBy: [{ costCentre: { code: 'asc' } }],
      select: this.budgetSelect(),
    });
    const rows = budgets.map((b) => this.withConsumption(b));
    return {
      on: day.toISOString().slice(0, 10),
      rows,
      totals: {
        amount: rows.reduce((sum, r) => sum + Number(r.amount), 0).toFixed(2),
        committed: rows.reduce((sum, r) => sum + Number(r.committed), 0).toFixed(2),
        remaining: rows.reduce((sum, r) => sum + Number(r.remaining), 0).toFixed(2),
      },
    };
  }

  // ── the guarded commit and release ─────────────────────────────────────────

  /**
   * Reserves `requested` against the cost centre's budget for `when`.
   *
   * Runs inside the caller's transaction so the commitment and the approval it
   * pays for succeed or fail together. Returns the budget it charged.
   */
  async commit(
    tx: TenantTxClient,
    actor: AuthUser,
    params: { costCentreId: string; requested: Prisma.Decimal; when: Date },
  ) {
    const budgets = await tx.budget.findMany({
      where: {
        companyId: actor.companyId,
        costCentreId: params.costCentreId,
        deletedAt: null,
        periodStart: { lte: params.when },
        periodEnd: { gte: params.when },
      },
      select: { id: true, name: true, amount: true, committed: true, currency: true },
    });
    if (budgets.length === 0) {
      const centre = await tx.costCentre.findUnique({
        where: { id: params.costCentreId },
        select: { code: true },
      });
      throw AppError.conflict(
        'CONFLICT',
        `No budget covers ${params.when.toISOString().slice(0, 10)} for cost centre ${centre?.code ?? params.costCentreId}. ` +
          'Set one before approving spend against it.',
      );
    }
    if (budgets.length > 1) {
      // Creation refuses overlaps, so this means the data was changed another
      // way. Guessing which pot to charge would be worse than saying so.
      throw AppError.conflict(
        'CONFLICT',
        `${budgets.length} budgets cover that date for this cost centre; exactly one must.`,
      );
    }
    const budget = budgets[0]!;

    // Atomic conditional commit — the WHERE clause IS the limit.
    const affected = await tx.$executeRaw`
      UPDATE "budgets"
         SET "committed" = "committed" + ${params.requested}
       WHERE "id" = ${budget.id}
         AND "companyId" = ${actor.companyId}
         AND "committed" + ${params.requested} <= "amount"`;
    if (affected === 0) {
      throw AppError.conflict(
        'CONFLICT',
        budgetLimitMessage(
          {
            name: budget.name,
            currency: budget.currency,
            amount: budget.amount.toString(),
            committed: budget.committed.toString(),
          },
          params.requested.toString(),
        ),
      );
    }
    return budget;
  }

  /**
   * Gives back what a purchase request was holding.
   *
   * The clear and the give-back are one guarded step: the UPDATE only matches
   * while the commitment is still live, so a double release (retry, race,
   * cancel-twice) returns the money exactly once.
   */
  async release(
    tx: TenantTxClient,
    companyId: string,
    purchaseRequestId: string,
  ): Promise<{ budgetId: string; amount: Prisma.Decimal } | null> {
    const pr = await tx.purchaseRequest.findFirst({
      where: { id: purchaseRequestId, companyId },
      select: { budgetId: true, committedAmount: true },
    });
    if (!pr?.budgetId || pr.committedAmount === null) return null;

    const cleared = await tx.$executeRaw`
      UPDATE "purchase_requests"
         SET "committedAmount" = NULL, "committedAt" = NULL
       WHERE "id" = ${purchaseRequestId}
         AND "companyId" = ${companyId}
         AND "committedAmount" IS NOT NULL`;
    if (cleared === 0) return null; // Somebody else released it first.

    await tx.$executeRaw`
      UPDATE "budgets"
         SET "committed" = "committed" - ${pr.committedAmount}
       WHERE "id" = ${pr.budgetId}
         AND "companyId" = ${companyId}
         AND "committed" >= ${pr.committedAmount}`;
    return { budgetId: pr.budgetId, amount: pr.committedAmount };
  }

  /** The cost centre a request may be charged to, or a refusal saying why not. */
  async assertChargeable(actor: AuthUser, costCentreId: string) {
    const centre = await this.loadCostCentre(actor, costCentreId);
    if (!centre.isActive) {
      throw new AppError('VALIDATION_FAILED', `Cost centre ${centre.code} is not active`);
    }
    return centre;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private budgetSelect() {
    return {
      id: true,
      name: true,
      periodStart: true,
      periodEnd: true,
      currency: true,
      amount: true,
      committed: true,
      notes: true,
      costCentre: { select: { id: true, code: true, name: true } },
    } satisfies Prisma.BudgetSelect;
  }

  private withConsumption<T extends { amount: Prisma.Decimal; committed: Prisma.Decimal }>(budget: T) {
    const snapshot = { amount: budget.amount.toString(), committed: budget.committed.toString() };
    return {
      ...budget,
      remaining: budgetRemaining(snapshot).toFixed(2),
      utilisationPercent: budgetUtilisationPercent(snapshot),
    };
  }

  private async loadCostCentre(actor: AuthUser, id: string) {
    const centre = await this.prisma.client.costCentre.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!centre) throw AppError.notFound('Cost centre', id);
    return centre;
  }

  private async assertReferences(actor: AuthUser, departmentId?: string | null, ownerId?: string | null) {
    if (departmentId) {
      const department = await this.prisma.client.department.findFirst({
        where: { id: departmentId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!department) throw AppError.notFound('Department', departmentId);
    }
    if (ownerId) {
      const owner = await this.prisma.client.user.findFirst({
        where: { id: ownerId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!owner) throw AppError.notFound('User', ownerId);
    }
  }
}
