import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.12 — SMTP settings from the operator console. The lines held: operators
 * only, the password never returns to any caller in any form, editing without
 * re-typing the password keeps the stored one, and removing settings falls
 * back cleanly.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  await prisma.client.mailSettings.deleteMany({});
});

afterAll(async () => {
  await prisma?.client.mailSettings.deleteMany({});
  await app?.close();
});

describe('platform mail settings', () => {
  it('is operators-only', async () => {
    // superAdmin of the tenant is also the designated platform admin in the
    // test env; the plain employee is not.
    const res = await api(app).get('/api/v1/platform/mail-settings').set(auth(s.employee));
    expect(res.status).toBe(403);
  });

  it('first save requires an explicit password decision', async () => {
    const res = await api(app)
      .put('/api/v1/platform/mail-settings')
      .set(auth(s.superAdmin))
      .send({ host: 'smtp-relay.brevo.com', fromAddress: 'TechpioAsset <no-reply@techpio.com>' });
    expect([400, 422]).toContain(res.status);
  });

  it('saves settings, stores the password encrypted, and never returns it', async () => {
    const res = await api(app)
      .put('/api/v1/platform/mail-settings')
      .set(auth(s.superAdmin))
      .send({
        host: 'smtp-relay.brevo.com',
        port: 587,
        username: 'login@smtp-brevo.com',
        password: 'super-secret-smtp-key',
        fromAddress: 'TechpioAsset <no-reply@techpio.com>',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.hasPassword).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-smtp-key');

    const row = await prisma.client.mailSettings.findUnique({ where: { id: 'default' } });
    expect(row?.passwordEncrypted).not.toBeNull();
    expect(row?.passwordEncrypted).not.toContain('super-secret-smtp-key');

    const read = await api(app).get('/api/v1/platform/mail-settings').set(auth(s.superAdmin));
    expect(JSON.stringify(read.body)).not.toContain('super-secret');
    expect(read.body.data.configured).toBe(true);
  });

  it('editing without a password keeps the stored one', async () => {
    const before = await prisma.client.mailSettings.findUnique({ where: { id: 'default' } });
    const res = await api(app)
      .put('/api/v1/platform/mail-settings')
      .set(auth(s.superAdmin))
      .send({
        host: 'smtp-relay.brevo.com',
        port: 2525,
        username: 'login@smtp-brevo.com',
        fromAddress: 'TechpioAsset <no-reply@techpio.com>',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.port).toBe(2525);
    const after = await prisma.client.mailSettings.findUnique({ where: { id: 'default' } });
    expect(after?.passwordEncrypted).toBe(before?.passwordEncrypted);
  });

  it('the test endpoint answers with a clear failure instead of a 500 for an unreachable host', async () => {
    // The saved host is real but the credentials are fake; either connect or
    // auth will fail. What must NOT happen is an unhandled 500.
    const res = await api(app)
      .post('/api/v1/platform/mail-settings/test')
      .set(auth(s.superAdmin))
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.delivered).toBe(false);
  }, 30_000);

  it('removing the settings falls back and reports unconfigured', async () => {
    const res = await api(app)
      .delete('/api/v1/platform/mail-settings')
      .set(auth(s.superAdmin));
    expect(res.status).toBe(204);
    const read = await api(app).get('/api/v1/platform/mail-settings').set(auth(s.superAdmin));
    expect(read.body.data.configured).toBe(false);
  });
});
