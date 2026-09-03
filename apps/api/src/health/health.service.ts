import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { DependencyHealth, HealthResponse, ProtectionHealth } from '@techpioasset/contracts';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { latestBackup, targetFromEnv } from '../backup/backup-storage.js';
import { RoutingMailProvider } from '../providers/mail/routing-mail.provider.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';

const startedAt = Date.now();
/** A readiness probe runs every few seconds; object storage does not need that. */
const OFFSITE_CACHE_MS = 10 * 60 * 1000;

/**
 * How the local storage provider is reported.
 *
 * It was described as `mocked` - "Results are simulated, not real" - which is
 * simply untrue: the local provider writes real files under real ULID keys and
 * issues real HMAC-signed expiring URLs, and since v2.33 those files are in the
 * nightly backup. Calling that simulated teaches an operator to discount the
 * word `mocked`, which is the one word on this endpoint that has to keep its
 * meaning, because `ai` and `push` really are simulated.
 *
 * What is true is that local disk is not durable object storage, and the
 * provider already says so itself. So the status is taken from the provider's
 * own `durable` flag rather than from a string comparison on an env var, and
 * `degraded` carries the real limitation: the files exist, on one box.
 */
export function describeStorage(name: string, durable: boolean): DependencyHealth {
  return durable
    ? { name: 'storage', status: 'up', detail: `Provider: ${name}`, critical: false }
    : {
        name: 'storage',
        status: 'degraded',
        detail:
          `Provider: ${name}. Files are real and included in the nightly backup, ` +
          `but they are on this host rather than durable object storage.`,
        critical: false,
      };
}

/**
 * The overall verdict.
 *
 * `degraded` dependencies were not counted here, so any dependency reporting it
 * left the service looking `ok`. Nothing reported `degraded` before, which is
 * why it never showed - but storage does now, and so does mail when its
 * settings cannot be read, and a limitation nobody is told about is the same as
 * no limitation at all.
 */
export function rollUp(dependencies: DependencyHealth[]): HealthResponse['status'] {
  if (dependencies.some((d) => d.critical && d.status === 'down')) return 'error';
  return dependencies.some((d) => d.status === 'down' || d.status === 'mocked' || d.status === 'degraded')
    ? 'degraded'
    : 'ok';
}

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
    // MailModule and StorageModule are both @Global, so these need no wiring
    // in HealthModule.
    private readonly mail: RoutingMailProvider,
    private readonly storage: StorageProvider,
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
    dependencies.push(describeStorage(this.storage.name, this.storage.durable));
    dependencies.push(this.describeProvider('ai', this.config.get('AI_PROVIDER'), 'mock'));
    dependencies.push(await this.checkMail());
    dependencies.push(this.describeProvider('push', this.config.get('PUSH_PROVIDER'), 'mock'));

    return {
      status: rollUp(dependencies),
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

  /**
   * Mail is the one provider whose configuration does not live in the
   * environment. Since v2.12 the router prefers SMTP settings held in the
   * database, so MAIL_PROVIDER is routinely dead config - and reading it here
   * told production it was simulating mail on a day it sent 352 real messages,
   * while marking the whole service `degraded`. A probe that cries wolf gets
   * ignored, which costs more than having no probe.
   *
   * So ask the router where a send would actually go, rather than asking the
   * environment what it would have decided.
   */
  private async checkMail(): Promise<DependencyHealth> {
    let route: Awaited<ReturnType<RoutingMailProvider['route']>>;
    try {
      route = await this.mail.route();
    } catch (error) {
      // Settings we cannot read prove nothing either way, and claiming a state
      // we could not establish is the failure this whole change is about.
      return {
        name: 'mail',
        status: 'degraded',
        detail: `Could not determine the mail route: ${(error as Error).message}`,
        critical: false,
      };
    }

    if (route === 'simulated') {
      return {
        name: 'mail',
        status: 'mocked',
        detail: 'Using the mock provider. Results are simulated, not real.',
        critical: false,
      };
    }
    return {
      name: 'mail',
      status: 'up',
      detail:
        route === 'database'
          ? 'Provider: SMTP, configured in Platform → Mail'
          : 'Provider: SMTP, from the environment',
      critical: false,
    };
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
