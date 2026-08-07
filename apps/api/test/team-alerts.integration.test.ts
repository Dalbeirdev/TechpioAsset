import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MockChatProvider } from '../src/providers/chat/mock-chat.provider.js';
import { ChatProvider } from '../src/providers/chat/chat.provider.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.12 — team alerts: one Teams/Slack webhook per company, posted to for
 * high-signal events. The lines held: integrations:manage gates configuration,
 * only https URLs are accepted, the test endpoint refuses when unconfigured,
 * and the mail test endpoint reports honestly that mock mail delivered nothing.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
});

afterAll(async () => {
  await prisma?.client.company.update({
    where: { id: companyId },
    data: { teamAlertWebhookUrl: null },
  });
  await app?.close();
});

describe('team alerts', () => {
  it('configuration needs integrations:manage', async () => {
    const res = await api(app)
      .patch('/api/v1/integrations/team-alerts')
      .set(auth(s.employee))
      .send({ webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXX' });
    expect(res.status).toBe(403);
  });

  it('refuses a non-https webhook', async () => {
    const res = await api(app)
      .patch('/api/v1/integrations/team-alerts')
      .set(auth(s.superAdmin))
      .send({ webhookUrl: 'http://hooks.slack.com/services/T000/B000/XXX' });
    expect([400, 422]).toContain(res.status);
  });

  it('test refuses while unconfigured', async () => {
    await prisma.client.company.update({
      where: { id: companyId },
      data: { teamAlertWebhookUrl: null },
    });
    const res = await api(app)
      .post('/api/v1/integrations/team-alerts/test')
      .set(auth(s.superAdmin))
      .send({});
    expect([400, 422]).toContain(res.status);
  });

  it('sets the webhook, audits it without recording the URL, and the test posts', async () => {
    const url = 'https://hooks.slack.com/services/T000/B000/test-suite';
    const res = await api(app)
      .patch('/api/v1/integrations/team-alerts')
      .set(auth(s.superAdmin))
      .send({ webhookUrl: url });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const audit = await prisma.client.auditLog.findFirst({
      where: { companyId, action: 'SETTING_CHANGED', entityType: 'Company' },
      orderBy: { createdAt: 'desc' },
      select: { newValues: true },
    });
    const recorded = JSON.stringify(audit?.newValues);
    expect(recorded).toContain('configured');
    // The webhook URL is a channel credential; it must never land in the log.
    expect(recorded).not.toContain('hooks.slack.com');

    const test = await api(app)
      .post('/api/v1/integrations/team-alerts/test')
      .set(auth(s.superAdmin))
      .send({});
    expect(test.status, JSON.stringify(test.body)).toBe(200);
    // The suite runs with the mock chat provider - it records instead of posting.
    const chat = app.get(ChatProvider);
    if (chat instanceof MockChatProvider) {
      const posted = chat.recorded();
      expect(posted.some((p) => p.webhookUrl === url)).toBe(true);
    }
  });

  it('a high-signal notification enqueues exactly one channel post per event', async () => {
    const chat = app.get(ChatProvider);
    if (!(chat instanceof MockChatProvider)) return;
    const before = chat.recorded().length;

    const { NotificationsService } = await import('../src/notifications/notifications.service.js');
    const notifications = app.get(NotificationsService);
    const [a, b] = await prisma.client.user.findMany({
      where: { companyId },
      take: 2,
      select: { id: true },
    });
    // The same event notifying two recipients must produce ONE channel post.
    for (const target of [a, b]) {
      await notifications.notify({
        companyId,
        userId: target.id,
        type: 'SECURITY_ALERT',
        title: 'Test security alert',
        body: 'Dedupe check',
        entityId: 'dedupe-entity-1',
      });
    }
    // Queue jobs run asynchronously; give the in-process queue a beat.
    await new Promise((r) => setTimeout(r, 500));
    const after = chat.recorded().length;
    expect(after - before).toBe(1);
  });
});

describe('mail test endpoint', () => {
  it('reports the mock provider honestly', async () => {
    const res = await api(app)
      .post('/api/v1/integrations/mail/test')
      .set(auth(s.superAdmin))
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.provider).toBe('mock');
    expect(res.body.data.delivered).toBe(false);
  });
});
