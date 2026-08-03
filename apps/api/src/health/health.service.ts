import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { DependencyHealth, HealthResponse, ProtectionHealth } from '@techpioasset/contracts';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { latestBackup, targetFromEnv } from '../backup/backup-storage.js';

const startedAt = Date.now();
/** A readiness probe runs every few seconds; object storage does not need that. */
const OFFSITE_CACHE_MS = 10 * 60 * 1000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private offsiteCache: {
    at: number;
    value: Pick<ProtectionHealth, 'offsiteBackups' | 'lastOffsiteBackupAgeHours' | 'offsiteDetail'>;
  } | null = null;

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

    const criticalDown = dependencies.some((d) => d.critical && d.status === 'down');
    const anyDown = dependencies.some((d) => d.status === 'down');
    const anyMocked = dependencies.some((d) => d.status === 'mocked');

    return {
      status: criticalDown ? 'error' : anyDown || anyMocked ? 'degraded' : 'ok',
      service: 'techpioasset-api',
      version: process.env.npm_package_version ?? '0.1.0',
      environment: this.config.get('NODE_ENV'),
      uptimeSeconds: this.uptimeSeconds(),
      dependencies,
      protection: await this.checkProtection(),
    };
  }

  private uptimeSeconds(): number {
    return Math.floor((Date.now() - startedAt) / 1000);
  }

  /**
   * v2.8 S6 - the protection posture, answerable from outside without
   * credentials. Twice now the honest answer has been "less than you think":
   * RLS was installed but dormant for six releases, and every backup lived on
   * the machine it was protecting. Neither was visible from anywhere.
   */
  private async checkProtection(): Promise<ProtectionHealth> {
    return {
      ...(await this.checkRls()),
      ...(await this.checkOffsiteBackups()),
    };
  }

  /**
   * Configured enforcement is not enforcement: a superuser (or a role with
   * BYPASSRLS) ignores every policy. Report what is TRUE, not what is asked for.
   */
  private async checkRls(): Promise<Pick<ProtectionHealth, 'rlsEnforced' | 'rlsDetail'>> {
    if (!this.config.get('RLS_ENFORCE')) {
      return {
        rlsEnforced: false,
        rlsDetail: 'RLS_ENFORCE is off - tenant isolation rests on the application layer alone',
      };
    }
    try {
      const rows = await this.prisma.client.$queryRawUnsafe<{ bypass: boolean }[]>(
        'SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user',
      );
      const bypasses = rows[0]?.bypass ?? true;
      return bypasses
        ? {
            rlsEnforced: false,
            rlsDetail:
              'RLS_ENFORCE is on but the serving role can bypass row-level security - enforcement is not in effect',
          }
        : { rlsEnforced: true };
    } catch {
      return { rlsEnforced: false, rlsDetail: 'could not determine the serving role privileges' };
    }
  }

  /** Off-site copies, cached: a health probe must not call object storage every few seconds. */
  private async checkOffsiteBackups(): Promise<
    Pick<ProtectionHealth, 'offsiteBackups' | 'lastOffsiteBackupAgeHours' | 'offsiteDetail'>
  > {
    const target = targetFromEnv();
    if (!target) {
      return {
        offsiteBackups: 'not-configured',
        lastOffsiteBackupAgeHours: null,
        offsiteDetail: 'no destination configured - the local copy is the only copy',
      };
    }
    const now = Date.now();
    if (this.offsiteCache && now - this.offsiteCache.at < OFFSITE_CACHE_MS) {
      return this.offsiteCache.value;
    }
    let value: Pick<ProtectionHealth, 'offsiteBackups' | 'lastOffsiteBackupAgeHours' | 'offsiteDetail'>;
    try {
      const latest = await latestBackup(target);
      value = latest
        ? {
            offsiteBackups: 'configured',
            lastOffsiteBackupAgeHours:
              Math.round(((now - latest.lastModified.getTime()) / 3_600_000) * 10) / 10,
          }
        : {
            offsiteBackups: 'configured',
            lastOffsiteBackupAgeHours: null,
            offsiteDetail: 'destination is reachable but holds no backup yet',
          };
    } catch (error) {
      value = {
        offsiteBackups: 'unreachable',
        lastOffsiteBackupAgeHours: null,
        offsiteDetail: `destination configured but unreachable: ${(error as Error).message}`,
      };
    }
    this.offsiteCache = { at: now, value };
    return value;
  }

  private async checkPostgres(): Promise<DependencyHealth> {
    try {
      const latencyMs = await this.prisma.ping();
      return { name: 'postgres', status: 'up', latencyMs, critical: true };
    } catch (error) {
      this.logger.warn(`Postgres health check failed: ${(error as Error).message}`);
      return { name: 'postgres', status: 'down', detail: 'Connection failed', critical: true };
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
      return { name: 'redis', status: 'up', latencyMs: Date.now() - started, critical: false };
    } catch (error) {
      this.logger.warn(`Redis health check failed: ${(error as Error).message}`);
      return {
        name: 'redis',
        status: 'down',
        // Rate limiting currently uses in-memory storage. Redis becomes critical
        // in Phase 2 when BullMQ queues start carrying notifications and jobs.
        detail: 'Connection failed. Not required until background jobs are enabled (Phase 2).',
        critical: false,
      };
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
          critical: false,
        }
      : { name, status: 'up', detail: `Provider: ${configured}`, critical: false };
  }
}
