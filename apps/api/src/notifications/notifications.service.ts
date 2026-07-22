import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { NotificationChannel, NotificationType } from '@prisma/client';
import type { AuthUser, PageQuery } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { paginate } from '../common/paginate.js';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailProvider } from '../providers/mail/mail.provider.js';
import { PushProvider } from '../providers/push/push.provider.js';
import { QueueProvider } from '../providers/queue/queue.provider.js';
import { NOTIFICATION_CATALOGUE, isMandatory } from './notification-catalogue.js';

export const SEND_NOTIFICATION_JOB = 'notification.send';
export const SEND_PUSH_JOB = 'notification.push';

export interface NotifyInput {
  companyId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  linkPath?: string;
  entityType?: string;
  entityId?: string;
}

interface SendJobPayload {
  notificationId: string;
  email: string;
  subject: string;
  text: string;
}

interface PushJobPayload {
  userId: string;
  title: string;
  body: string;
  linkPath?: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProvider,
    private readonly mail: MailProvider,
    private readonly push: PushProvider,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.queue.register<SendJobPayload>(SEND_NOTIFICATION_JOB, async (payload) => {
      const result = await this.mail.send({
        to: payload.email,
        subject: payload.subject,
        text: payload.text,
      });

      await this.prisma.client.notification.update({
        where: { id: payload.notificationId },
        data: { deliveredAt: new Date(), simulated: result.simulated },
      });
    });

    // Push delivery runs off the request path too. A recipient with no registered
    // device is a no-op, not an error — most users are web-only.
    this.queue.register<PushJobPayload>(SEND_PUSH_JOB, async (payload) => {
      const devices = await this.prisma.client.deviceToken.findMany({
        where: { userId: payload.userId, revokedAt: null },
        select: { token: true },
      });
      if (devices.length === 0) return;

      const result = await this.push.send({
        tokens: devices.map((d) => d.token),
        title: payload.title,
        body: payload.body,
        ...(payload.linkPath ? { data: { linkPath: payload.linkPath } } : {}),
      });

      // Prune tokens Expo reported as dead, so they stop being retried.
      if (result.invalidTokens.length > 0) {
        await this.prisma.client.deviceToken.updateMany({
          where: { token: { in: result.invalidTokens } },
          data: { revokedAt: new Date() },
        });
      }
    });
  }

  /**
   * Records an in-app notification and queues email where permitted.
   *
   * The in-app row is written synchronously so the bell is correct the moment the
   * triggering action returns; only delivery is deferred. Doing both in the job
   * would make notifications appear seconds late for no benefit.
   */
  async notify(input: NotifyInput): Promise<void> {
    const definition = NOTIFICATION_CATALOGUE[input.type];

    const notification = await this.prisma.client.notification.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        type: input.type,
        channel: 'IN_APP',
        title: input.title,
        body: input.body,
        linkPath: input.linkPath,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });

    // Push runs alongside email where the type and the user's preference allow.
    if (
      definition.channels.includes('PUSH') &&
      (await this.wants(input.userId, input.type, 'PUSH'))
    ) {
      await this.queue.enqueue<PushJobPayload>(SEND_PUSH_JOB, {
        userId: input.userId,
        title: input.title,
        body: input.body,
        ...(input.linkPath ? { linkPath: input.linkPath } : {}),
      });
    }

    if (!definition.channels.includes('EMAIL')) return;
    if (!(await this.wants(input.userId, input.type, 'EMAIL'))) return;

    const user = await this.prisma.client.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });
    if (!user) return;

    await this.queue.enqueue<SendJobPayload>(SEND_NOTIFICATION_JOB, {
      notificationId: notification.id,
      email: user.email,
      subject: input.title,
      text: `${input.body}\n\n${input.linkPath ? `${this.config.get('WEB_URL')}${input.linkPath}` : ''}`.trim(),
    });
  }

  /** Fan-out helper; one row per recipient so read state is per-user. */
  async notifyMany(userIds: readonly string[], input: Omit<NotifyInput, 'userId'>): Promise<void> {
    // Deduplicated: an approver who is also the requester should not be told twice.
    for (const userId of new Set(userIds)) {
      await this.notify({ ...input, userId });
    }
  }

  /**
   * A mandatory type always returns true regardless of stored preference, so a
   * row written before a type became mandatory cannot suppress it.
   */
  private async wants(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    if (isMandatory(type)) return true;

    const preference = await this.prisma.client.notificationPreference.findUnique({
      where: { userId_type_channel: { userId, type, channel } },
    });
    // Absent preference means opted in; users should not have to enable each
    // notification individually to be told anything.
    return preference?.enabled ?? true;
  }

  async list(actor: AuthUser, query: PageQuery, unreadOnly: boolean) {
    const where = { userId: actor.id, ...(unreadOnly ? { readAt: null } : {}) };

    return paginate(query, {
      count: () => this.prisma.client.notification.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.notification.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            linkPath: true,
            entityType: true,
            entityId: true,
            readAt: true,
            deliveredAt: true,
            simulated: true,
            createdAt: true,
          },
        }),
    });
  }

  unreadCount(actor: AuthUser): Promise<number> {
    return this.prisma.client.notification.count({
      where: { userId: actor.id, readAt: null },
    });
  }

  async markRead(actor: AuthUser, id: string): Promise<void> {
    // Scoped to the actor: marking someone else's notification read would be a
    // small but real cross-user write.
    const result = await this.prisma.client.notification.updateMany({
      where: { id, userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await this.prisma.client.notification.findFirst({
        where: { id, userId: actor.id },
        select: { id: true },
      });
      if (!exists) throw AppError.notFound('Notification', id);
    }
  }

  async markAllRead(actor: AuthUser): Promise<{ updated: number }> {
    const result = await this.prisma.client.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async preferences(actor: AuthUser) {
    const stored = await this.prisma.client.notificationPreference.findMany({
      where: { userId: actor.id },
    });
    const byKey = new Map(stored.map((p) => [`${p.type}:${p.channel}`, p.enabled]));

    return Object.values(NOTIFICATION_CATALOGUE).map((definition) => ({
      type: definition.type,
      title: definition.title,
      mandatory: definition.mandatory,
      channels: definition.channels.map((channel) => ({
        channel,
        enabled: definition.mandatory || (byKey.get(`${definition.type}:${channel}`) ?? true),
        // The UI disables the control rather than hiding it, so users can see
        // what they are always told and why.
        locked: definition.mandatory,
      })),
    }));
  }

  async setPreference(
    actor: AuthUser,
    type: NotificationType,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<void> {
    if (isMandatory(type) && !enabled) {
      throw new AppError(
        'FORBIDDEN',
        `${NOTIFICATION_CATALOGUE[type].title} cannot be turned off`,
        {
          detail:
            'Security and workflow notifications are mandatory (spec section 19) and cannot be disabled.',
        },
      );
    }

    await this.prisma.client.notificationPreference.upsert({
      where: { userId_type_channel: { userId: actor.id, type, channel } },
      update: { enabled },
      create: { userId: actor.id, type, channel, enabled },
    });
  }
}
