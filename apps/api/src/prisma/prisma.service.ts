import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from '../config/config.module.js';
import {
  SOFT_DELETABLE_MODELS,
  UNDELETABLE_MODELS,
  UndeletableModelError,
} from './model-policy.js';

export { SOFT_DELETABLE_MODELS, UNDELETABLE_MODELS, UndeletableModelError };

const READ_OPERATIONS = new Set(['findFirst', 'findMany', 'findUnique', 'count', 'aggregate']);
const DELETE_OPERATIONS = new Set(['delete', 'deleteMany']);

/**
 * Builds the extended client. Exported separately from the Nest service so the
 * seed script and integration tests can construct one without a Nest container.
 */
export function createPrismaClient(datasourceUrl?: string) {
  const base = new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);

  return base.$extends({
    name: 'techpioasset-guards',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && DELETE_OPERATIONS.has(operation) && UNDELETABLE_MODELS.has(model)) {
            throw new UndeletableModelError(model, operation.replace('Many', ''));
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
    this.client = createPrismaClient(config.get('DATABASE_URL'));
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
