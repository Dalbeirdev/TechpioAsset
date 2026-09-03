import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, type AiFeature } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import {
  resolveAiGate,
  type AiConfigState,
  type AiFeature as DomainAiFeature,
  type AiFeatureOverride,
  type AiGateResult,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Reads and writes the per-company AI configuration and answers the one question
 * the rest of the system asks before touching an AI provider: may this feature
 * run, for this actor, in this office?
 *
 * The decision logic itself is the pure resolveAiGate in packages/domain; this
 * service only loads the state and records usage.
 */
@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async loadState(companyId: string): Promise<{
    config: AiConfigState;
    overrides: AiFeatureOverride[];
    raw: {
      id: string;
      confidenceThreshold: Prisma.Decimal;
      monthlyBudgetUsd: Prisma.Decimal | null;
      monthlyRequestLimit: number | null;
    };
  }> {
    const record = await this.prisma.client.aIConfiguration.findUnique({
      where: { companyId },
      include: { overrides: true },
    });
    if (!record) throw AppError.notFound('AI configuration');

    const config: AiConfigState = {
      globallyEnabled: record.globallyEnabled,
      pausedAt: record.pausedAt,
      featureModes: record.featureModes as AiConfigState['featureModes'],
      confidenceThreshold: Number(record.confidenceThreshold),
      automaticFinancialApproval: record.automaticFinancialApproval,
      humanReviewRequired: record.humanReviewRequired,
    };

    const overrides: AiFeatureOverride[] = record.overrides.map((o) => ({
      feature: o.feature as DomainAiFeature,
      mode: o.mode as AiFeatureOverride['mode'],
      officeId: o.officeId,
      roleKey: o.roleKey,
    }));

    return {
      config,
      overrides,
      raw: {
        id: record.id,
        confidenceThreshold: record.confidenceThreshold,
        monthlyBudgetUsd: record.monthlyBudgetUsd,
        monthlyRequestLimit: record.monthlyRequestLimit,
      },
    };
  }

  /**
   * What this company has spent on AI since the start of the current month.
   *
   * Summed from the usage records the providers already write, so there is one
   * source of truth for spend rather than a running total that can drift out of
   * step with the records behind it. A failed call still counts as a request -
   * it was still made - but contributes whatever cost it reported, usually none.
   *
   * Simulated calls are excluded: a mock provider costs nothing, and letting the
   * mock consume a real budget would make development eat production's ceiling.
   */
  private async usageThisMonth(companyId: string): Promise<{ spendUsd: number; requests: number }> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const usage = await this.prisma.client.aIUsageRecord.aggregate({
      where: { companyId, simulated: false, createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
      _count: { _all: true },
    });
    return {
      spendUsd: Number(usage._sum.costUsd ?? 0),
      requests: usage._count._all,
    };
  }

  /**
   * The gate every AI call site must pass through. Nothing in the codebase calls
   * an AI provider without an `enabled: true` result from here — that is what
   * makes spec section 10's "when AI is disabled, no document is submitted"
   * structural rather than a convention.
   */
  async gate(
    companyId: string,
    feature: DomainAiFeature,
    actor: { officeId?: string | null; roleKeys?: readonly string[] },
  ): Promise<AiGateResult & { confidenceThreshold: number }> {
    const { config, overrides, raw } = await this.loadState(companyId);

    // Only counted when a ceiling exists - no reason to aggregate usage on every
    // gate check for a company that has not set one.
    const hasLimit = raw.monthlyBudgetUsd !== null || raw.monthlyRequestLimit !== null;
    const usage = hasLimit ? await this.usageThisMonth(companyId) : undefined;

    const result = resolveAiGate(
      config,
      overrides,
      { feature, officeId: actor.officeId, roleKeys: actor.roleKeys },
      hasLimit
        ? {
            monthlyBudgetUsd: raw.monthlyBudgetUsd === null ? null : Number(raw.monthlyBudgetUsd),
            monthlyRequestLimit: raw.monthlyRequestLimit,
          }
        : undefined,
      usage,
    );
    return { ...result, confidenceThreshold: config.confidenceThreshold };
  }

  async getConfiguration(actor: AuthUser) {
    const record = await this.prisma.client.aIConfiguration.findUnique({
      where: { companyId: actor.companyId },
      include: { overrides: true },
    });
    if (!record) throw AppError.notFound('AI configuration');
    return record;
  }

  async update(
    actor: AuthUser,
    input: {
      globallyEnabled?: boolean;
      paused?: boolean;
      featureModes?: Record<string, string>;
      confidenceThreshold?: number;
      monthlyBudgetUsd?: number | null;
      monthlyRequestLimit?: number | null;
      humanReviewRequired?: boolean;
    },
  ) {
    const before = await this.getConfiguration(actor);

    const data: Prisma.AIConfigurationUpdateInput = { updatedById: actor.id };
    if (input.globallyEnabled !== undefined) data.globallyEnabled = input.globallyEnabled;
    if (input.paused !== undefined) data.pausedAt = input.paused ? new Date() : null;
    if (input.featureModes !== undefined) {
      data.featureModes = input.featureModes as Prisma.InputJsonValue;
    }
    if (input.confidenceThreshold !== undefined) {
      data.confidenceThreshold = new Prisma.Decimal(input.confidenceThreshold);
    }
    if (input.monthlyBudgetUsd !== undefined) {
      data.monthlyBudgetUsd =
        input.monthlyBudgetUsd === null ? null : new Prisma.Decimal(input.monthlyBudgetUsd);
    }
    if (input.monthlyRequestLimit !== undefined)
      data.monthlyRequestLimit = input.monthlyRequestLimit;
    if (input.humanReviewRequired !== undefined)
      data.humanReviewRequired = input.humanReviewRequired;

    const updated = await this.prisma.client.aIConfiguration.update({
      where: { companyId: actor.companyId },
      data,
    });

    // Enabling AI or loosening review is exactly the kind of change an auditor
    // needs to see, so the before/after is recorded in full.
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'AIConfiguration',
      entityId: updated.id,
      previousValues: {
        globallyEnabled: before.globallyEnabled,
        humanReviewRequired: before.humanReviewRequired,
        paused: before.pausedAt !== null,
      },
      newValues: {
        globallyEnabled: updated.globallyEnabled,
        humanReviewRequired: updated.humanReviewRequired,
        paused: updated.pausedAt !== null,
      },
    });

    return updated;
  }

  /** Records an AI usage event for the audit log and budget tracking (spec section 10). */
  async recordUsage(input: {
    companyId: string;
    userId?: string | null;
    feature: AiFeature;
    provider: string;
    modelName?: string;
    entityType?: string;
    entityId?: string;
    confidence?: number;
    durationMs?: number;
    costUsd?: number | null;
    succeeded: boolean;
    simulated: boolean;
    failureDetail?: string;
  }): Promise<void> {
    try {
      await this.prisma.client.aIUsageRecord.create({
        data: {
          companyId: input.companyId,
          userId: input.userId ?? null,
          feature: input.feature,
          provider: input.provider,
          modelName: input.modelName,
          entityType: input.entityType,
          entityId: input.entityId,
          confidence: input.confidence !== undefined ? new Prisma.Decimal(input.confidence) : null,
          durationMs: input.durationMs,
          costUsd:
            input.costUsd !== undefined && input.costUsd !== null
              ? new Prisma.Decimal(input.costUsd)
              : null,
          succeeded: input.succeeded,
          simulated: input.simulated,
          failureDetail: input.failureDetail,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record AI usage: ${(error as Error).message}`);
    }
  }
}
