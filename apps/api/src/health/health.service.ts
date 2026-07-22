import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { DependencyHealth, HealthResponse } from '@techpioasset/contracts';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

const startedAt = Date.now();

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** Liveness: the process is up. Deliberately checks nothing external. */
  liveness(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: this.uptimeSeconds() };
  }

  /**
   * Readiness: can this instance serve traffic?
   *
   * A provider running in mock mode reports `mocked`, not `up` - spec section 28
   * forbids presenting a simulated dependency as a working one, and this is the
   * endpoint an operator checks first.
   */
  async readiness(): Promise<HealthResponse> {
    const dependencies: DependencyHealth[] = [];

    dependencies.push(await this.checkPostgres());
    dependencies.push(await this.checkRedis());
    dependencies.push(
      this.describeProvider('storage', this.config.get('STORAGE_PROVIDER'), 'local'),
    );
    dependencies.push(this.describeProvider('ai', this.config.get('AI_PROVIDER'), 'mock'));
    dependencies.push(this.describeProvider('mail', this.config.get('MAIL_PROVIDER'), 'mock'));
    dependencies.push(this.describeProvider('push', this.config.get('PUSH_PROVIDER'), 'mock'));

    const hasDown = dependencies.some((d) => d.status === 'down');
    const hasMocked = dependencies.some((d) => d.status === 'mocked');

    return {
      status: hasDown ? 'error' : hasMocked ? 'degraded' : 'ok',
      service: 'techpioasset-api',
      version: process.env.npm_package_version ?? '0.1.0',
      environment: this.config.get('NODE_ENV'),
      uptimeSeconds: this.uptimeSeconds(),
      dependencies,
    };
  }

  private uptimeSeconds(): number {
    return Math.floor((Date.now() - startedAt) / 1000);
  }

  private async checkPostgres(): Promise<DependencyHealth> {
    try {
      const latencyMs = await this.prisma.ping();
      return { name: 'postgres', status: 'up', latencyMs };
    } catch (error) {
      this.logger.warn(`Postgres health check failed: ${(error as Error).message}`);
      return { name: 'postgres', status: 'down', detail: 'Connection failed' };
    }
  }

  private async checkRedis(): Promise<DependencyHealth> {
    const client = new Redis(this.config.get('REDIS_URL'), {
      lazyConnect: true,
      // Health checks must fail fast rather than hold the probe open.
      connectTimeout: 1500,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    const started = Date.now();
    try {
      await client.connect();
      await client.ping();
      return { name: 'redis', status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      this.logger.warn(`Redis health check failed: ${(error as Error).message}`);
      return { name: 'redis', status: 'down', detail: 'Connection failed' };
    } finally {
      client.disconnect();
    }
  }

  private describeProvider(name: string, configured: string, mockValue: string): DependencyHealth {
    return configured === mockValue
      ? {
          name,
          status: 'mocked',
          detail: `Using the ${configured} provider. Results are simulated, not real.`,
        }
      : { name, status: 'up', detail: `Provider: ${configured}` };
  }
}
