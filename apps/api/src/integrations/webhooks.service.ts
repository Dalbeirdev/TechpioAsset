import { createHmac, randomBytes } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser, CreateWebhookInput, UpdateWebhookInput, WebhookEvent } from '@techpioasset/contracts';
import { AppConfig } from '../config/config.module.js';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 10_000;

/**
 * v2.6 A3 — outbound webhooks (plan invariant 3): every delivery is signed
 * (HMAC-SHA256 over the raw body), retries are bounded with backoff, and the
 * terminal DEAD state is visible in the hub — a dead endpoint never wedges
 * the queue and a dropped event is never silent.
 *
 * publish() is fire-and-forget from business code: it records deliveries and
 * attempts them asynchronously; a webhook failure must never fail an asset
 * creation.
 */
@Injectable()
export class WebhooksService implements OnModuleInit {
  private readonly logger = new Logger(WebhooksService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('ENABLE_SCHEDULED_JOBS')) return;
    this.timer = setInterval(() => void this.runRetrySweep(), 5 * 60 * 1000);
    this.timer.unref?.();
  }

  // ── publishing ─────────────────────────────────────────────────────────────

  /** Record deliveries for every matching subscription and attempt them now. */
  async publish(companyId: string, event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
    try {
      const subscriptions = await this.prisma.client.webhookSubscription.findMany({
        where: { companyId, isActive: true, deletedAt: null, events: { has: event } },
        select: { id: true },
      });
      if (subscriptions.length === 0) return;

      const body = { event, occurredAt: new Date().toISOString(), data: payload };
      const deliveries = await Promise.all(
        subscriptions.map((sub) =>
          this.prisma.client.webhookDelivery.create({
            data: {
              companyId,
              subscriptionId: sub.id,
              event,
              payload: body as unknown as Prisma.InputJsonValue,
              nextAttemptAt: new Date(),
            },
            select: { id: true },
          }),
        ),
      );
      // Fire and forget - the business transaction is already committed.
      for (const delivery of deliveries) void this.attempt(delivery.id);
    } catch (error) {
      // Publishing must never break the caller.
      this.logger.warn(`webhook publish failed for ${event}: ${String(error)}`);
    }
  }

  /** One delivery attempt; schedules the retry or the DEAD verdict itself. */
  async attempt(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.client.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { subscription: { select: { url: true, secret: true, isActive: true } } },
    });
    if (!delivery || delivery.status === 'DELIVERED' || delivery.status === 'DEAD') return;
    if (!delivery.subscription.isActive) return;

    const raw = JSON.stringify(delivery.payload);
    const signature = createHmac('sha256', delivery.subscription.secret).update(raw).digest('hex');
    const attempts = delivery.attempts + 1;

    let responseStatus: number | null = null;
    let lastError: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(delivery.subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Techpio-Event': delivery.event,
          'X-Techpio-Delivery': delivery.id,
          'X-Techpio-Signature': `sha256=${signature}`,
        },
        body: raw,
        signal: controller.signal,
      });
      clearTimeout(timer);
      responseStatus = res.status;
      if (!res.ok) lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'request failed';
    }

    const delivered = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
    const dead = !delivered && attempts >= MAX_ATTEMPTS;
    await this.prisma.client.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts,
        lastAttemptAt: new Date(),
        responseStatus,
        lastError: delivered ? null : lastError,
        status: delivered ? 'DELIVERED' : dead ? 'DEAD' : 'FAILED',
        // Exponential backoff: 2^attempts minutes, capped at 4h.
        nextAttemptAt: delivered || dead ? null : new Date(Date.now() + Math.min(2 ** attempts, 240) * 60_000),
      },
    });
    if (dead) {
      this.logger.warn(`webhook delivery ${deliveryId} is DEAD after ${attempts} attempts (${lastError})`);
    }
  }

  /** Retry FAILED deliveries whose backoff has elapsed. Returns the count tried. */
  async runRetrySweep(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.client.webhookDelivery.findMany({
      where: { status: 'FAILED', nextAttemptAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    for (const delivery of due) await this.attempt(delivery.id);
    if (due.length > 0) this.logger.log(`webhook retry sweep tried ${due.length} delivery(ies)`);
    return due.length;
  }

  // ── subscription CRUD (integrations:manage) ────────────────────────────────

  async list(actor: AuthUser) {
    const subs = await this.prisma.client.webhookSubscription.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    });
    const counts = await this.prisma.client.webhookDelivery.groupBy({
      by: ['subscriptionId', 'status'],
      where: { companyId: actor.companyId },
      _count: { _all: true },
    });
    return subs.map((sub) => ({
      ...sub,
      deliveries: Object.fromEntries(
        counts.filter((c) => c.subscriptionId === sub.id).map((c) => [c.status, c._count._all]),
      ),
    }));
  }

  /** The signing secret is returned ONCE, at creation. */
  async create(actor: AuthUser, input: CreateWebhookInput) {
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const sub = await this.prisma.client.webhookSubscription.create({
      data: {
        companyId: actor.companyId,
        url: input.url,
        secret,
        events: input.events,
        createdById: actor.id,
      },
      select: { id: true, url: true, events: true, isActive: true },
    });
    return { ...sub, secret };
  }

  async update(actor: AuthUser, id: string, input: UpdateWebhookInput) {
    const existing = await this.prisma.client.webhookSubscription.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound('Webhook', id);
    return this.prisma.client.webhookSubscription.update({
      where: { id },
      data: {
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: { id: true, url: true, events: true, isActive: true },
    });
  }

  async remove(actor: AuthUser, id: string) {
    const result = await this.prisma.client.webhookSubscription.updateMany({
      where: { id, companyId: actor.companyId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (result.count === 0) throw AppError.notFound('Webhook', id);
  }

  async deliveries(actor: AuthUser, subscriptionId: string) {
    const sub = await this.prisma.client.webhookSubscription.findFirst({
      where: { id: subscriptionId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!sub) throw AppError.notFound('Webhook', subscriptionId);
    return this.prisma.client.webhookDelivery.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        responseStatus: true,
        lastError: true,
        lastAttemptAt: true,
        nextAttemptAt: true,
        createdAt: true,
      },
    });
  }
}
