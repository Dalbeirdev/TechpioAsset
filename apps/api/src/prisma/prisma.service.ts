import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { deriveDimensionsFromLegacy, type AssetStatus, type ConditionGrade } from '@techpioasset/domain';
import { AppConfig } from '../config/config.module.js';
import {
  SOFT_DELETABLE_MODELS,
  UNDELETABLE_MODELS,
  UndeletableModelError,
} from './model-policy.js';

export { SOFT_DELETABLE_MODELS, UNDELETABLE_MODELS, UndeletableModelError };

const READ_OPERATIONS = new Set(['findFirst', 'findMany', 'findUnique', 'count', 'aggregate']);
const DELETE_OPERATIONS = new Set(['delete', 'deleteMany']);
const WRITE_OPERATIONS = new Set(['create', 'update', 'updateMany', 'upsert', 'createMany']);

/**
 * v2.1 Workstream A dual-write. When STATUS_MODEL_V2 is on, any Asset write that
 * sets `status` also derives the lifecycle + availability dimensions from it, so
 * every path (create / update / changeStatus / assign / return / bulk) keeps the
 * dimensions in step with the legacy status without touching each call site.
 * Ownership and condition are orthogonal and never derived here. Explicitly
 * supplied dimensions are respected. Off by default → v1 behaviour unchanged.
 */
function deriveOneRow(data: Record<string, unknown>): void {
  if (typeof data.status !== 'string') return;
  const dims = deriveDimensionsFromLegacy(data.status as AssetStatus, {
    existingCondition: typeof data.condition === 'string' ? (data.condition as ConditionGrade) : undefined,
  });
  if (data.lifecycleState === undefined) data.lifecycleState = dims.lifecycle;
  if (data.availabilityState === undefined) data.availabilityState = dims.availability;
}

function deriveAssetDimensions(data: unknown): void {
  if (Array.isArray(data)) {
    for (const row of data) if (row && typeof row === 'object') deriveOneRow(row as Record<string, unknown>);
  } else if (data && typeof data === 'object') {
    deriveOneRow(data as Record<string, unknown>);
  }
}

/**
 * Builds the extended client. Exported separately from the Nest service so the
 * seed script and integration tests can construct one without a Nest container.
 *
 * @param statusModelV2 enables the v2.1 asset-dimension dual-write (default off).
 */
export function createPrismaClient(datasourceUrl?: string, statusModelV2 = false) {
  const base = new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);

  return base.$extends({
    name: 'techpioasset-guards',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && DELETE_OPERATIONS.has(operation) && UNDELETABLE_MODELS.has(model)) {
            throw new UndeletableModelError(model, operation.replace('Many', ''));
          }

          if (statusModelV2 && model === 'Asset' && WRITE_OPERATIONS.has(operation)) {
            // upsert carries create+update payloads; both get derived.
            const a = args as {
              data?: Record<string, unknown>;
              create?: Record<string, unknown>;
              update?: Record<string, unknown>;
            };
            if (operation === 'upsert') {
              deriveAssetDimensions(a.create);
              deriveAssetDimensions(a.update);
            } else {
              deriveAssetDimensions(a.data);
            }
          }

          if (model && READ_OPERATIONS.has(operation) && SOFT_DELETABLE_MODELS.has(model)) {
            const where = (args as { where?: Record<string, unknown> }).where ?? {};
            // `includeDeleted: true` is the documented opt-out for audit and
            // restore screens; anything else gets the filter applied.
            if (!('deletedAt' in where) && !('includeDeleted' in where)) {
              (args as { where?: Record<string, unknown> }).where = {
                ...where,
                deletedAt: null,
              };
            } else if ('includeDeleted' in where) {
              delete (where as Record<string, unknown>).includeDeleted;
            }
          }

          return query(args);
        },
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: ExtendedPrismaClient;

  constructor(config: AppConfig) {
    this.client = createPrismaClient(config.get('DATABASE_URL'), config.get('STATUS_MODEL_V2'));
  }

  /**
   * Connects eagerly but does not make the connection a boot requirement.
   *
   * Throwing here would kill the process whenever Postgres is unavailable, which
   * takes /health/ready down with it - precisely the endpoint whose job is to
   * report that Postgres is unavailable. Prisma connects lazily on first query,
   * so a failure here costs nothing beyond the warning, and the readiness probe
   * reports `postgres: down` as designed.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      this.logger.error(
        `Database unavailable at startup: ${(error as Error).message}. ` +
          'The API is serving in a degraded state; /health/ready reports the detail.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** Round-trip used by the readiness probe. */
  async ping(): Promise<number> {
    const started = process.hrtime.bigint();
    await this.client.$queryRaw`SELECT 1`;
    return Number((process.hrtime.bigint() - started) / 1_000_000n);
  }
}
