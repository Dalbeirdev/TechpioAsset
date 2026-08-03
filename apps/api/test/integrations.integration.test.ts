import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WebhooksService } from '../src/integrations/webhooks.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.6 A3 — the integrations hub. Invariants under test: deliveries are
 * HMAC-signed and verifiable; retries are bounded ending in a VISIBLE dead
 * letter; SCIM writes go through the guarded role path; secrets show once.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let webhooks: WebhooksService;
let receiver: Server;
let receiverUrl: string;
const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];

const run = Date.now() % 1_000_000;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  webhooks = app.get(WebhooksService);

  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
});

afterAll(async () => {
  await prisma.client.webhookDelivery.deleteMany({
    where: { companyId: s.superAdmin.user.companyId },
  });
  await prisma.client.webhookSubscription.deleteMany({
    where: { companyId: s.superAdmin.user.companyId },
  });
  await prisma.client.scimToken.deleteMany({ where: { companyId: s.superAdmin.user.companyId } });
  await prisma.client.user.deleteMany({ where: { email: { contains: `scim-${run}` } } });
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  await app?.close();
});

async function waitFor(check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('condition not met in time');
}

describe('webhooks', () => {
  it('an employee cannot touch the hub', async () => {
    const res = await api(app).get('/api/v1/integrations').set(auth(s.employee));
    expect(res.status).toBe(403);
  });

  it('delivers a signed event a receiver can verify; the secret is shown once', async () => {
    const created = await api(app)
      .post('/api/v1/integrations/webhooks')
      .set(auth(s.superAdmin))
      .send({ url: receiverUrl, events: ['asset.created'] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { id, secret } = created.body.data;
    expect(secret).toMatch(/^whsec_/);

    // The list never re-exposes the secret.
    const list = await api(app).get('/api/v1/integrations/webhooks').set(auth(s.superAdmin));
    expect(JSON.stringify(list.body)).not.toContain(secret);

    await webhooks.publish(s.superAdmin.user.companyId, 'asset.created', {
      assetId: 'probe',
      assetTag: `WH-${run}`,
    });
    await waitFor(async () => received.length > 0);

    const hit = received.at(-1)!;
    expect(hit.headers['x-techpio-event']).toBe('asset.created');
    const expected = `sha256=${createHmac('sha256', secret).update(hit.body).digest('hex')}`;
    expect(hit.headers['x-techpio-signature']).toBe(expected);
    expect(JSON.parse(hit.body).data.assetTag).toBe(`WH-${run}`);

    await waitFor(async () => {
      const delivery = await prisma.client.webhookDelivery.findFirst({
        where: { subscriptionId: id },
      });
      return delivery?.status === 'DELIVERED';
    });

    const deliveries = await api(app)
      .get(`/api/v1/integrations/webhooks/${id}/deliveries`)
      .set(auth(s.superAdmin));
    expect(deliveries.body.data[0].status).toBe('DELIVERED');
  });

  it('a dead endpoint retries with backoff and lands in a VISIBLE dead letter', async () => {
    const created = await api(app)
      .post('/api/v1/integrations/webhooks')
      .set(auth(s.superAdmin))
      .send({ url: 'http://127.0.0.1:1/hook', events: ['discovery.conflict'] });
    const { id } = created.body.data;

    await webhooks.publish(s.superAdmin.user.companyId, 'discovery.conflict', { probe: true });
    await waitFor(async () => {
      const d = await prisma.client.webhookDelivery.findFirst({ where: { subscriptionId: id } });
      return d !== null && d.status === 'FAILED';
    });

    // Drain the backoff deterministically: rewind and sweep until DEAD.
    for (let i = 0; i < 6; i++) {
      await prisma.client.webhookDelivery.updateMany({
        where: { subscriptionId: id, status: 'FAILED' },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      await webhooks.runRetrySweep();
    }

    const dead = await prisma.client.webhookDelivery.findFirst({
      where: { subscriptionId: id },
    });
    expect(dead!.status).toBe('DEAD');
    expect(dead!.attempts).toBe(5);
    expect(dead!.lastError).toBeTruthy();

    // The hub surfaces the dead letter - never silently dropped.
    const hub = await api(app).get('/api/v1/integrations').set(auth(s.superAdmin));
    expect(hub.body.data.webhooks.deadDeliveries).toBeGreaterThanOrEqual(1);
  });

  it('the real emit point fires: creating an asset reaches the receiver', async () => {
    const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
    const categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;
    const before = received.length;

    const asset = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.superAdmin))
      .send({ assetTag: `WHOOK-${run}`, name: 'Webhook emit probe', categoryId, status: 'AVAILABLE' });
    expect(asset.status).toBe(201);

    await waitFor(async () => received.length > before);
    const hit = received.at(-1)!;
    expect(JSON.parse(hit.body).data.assetTag).toBe(`WHOOK-${run}`);

    await prisma.client.asset.delete({ where: { id: asset.body.data.id } }).catch(() => undefined);
  });
});

describe('SCIM provisioning (built to contract - no live IdP here)', () => {
  let token: string;

  it('mints the token once; the endpoints refuse anything else', async () => {
    const minted = await api(app)
      .post('/api/v1/integrations/scim/token')
      .set(auth(s.superAdmin));
    expect(minted.status, JSON.stringify(minted.body)).toBe(201);
    token = minted.body.data.token;
    expect(token).toMatch(/^scim_/);

    const anonymous = await api(app).get('/api/v1/scim/v2/Users');
    expect(anonymous.status).toBe(401);
    const wrong = await api(app)
      .get('/api/v1/scim/v2/Users')
      .set('Authorization', 'Bearer scim_wrong');
    expect(wrong.status).toBe(401);

    const ok = await api(app).get('/api/v1/scim/v2/Users').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.schemas[0]).toContain('ListResponse');
    expect(ok.body.data.totalResults).toBeGreaterThan(0);
  });

  it('provisions through the guarded role path and reads back RFC-shaped', async () => {
    const created = await api(app)
      .post('/api/v1/scim/v2/Users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        userName: `scim-${run}@techpioasset.dev`,
        name: { givenName: 'Scim', familyName: 'Probe' },
        active: true,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.userName).toBe(`scim-${run}@techpioasset.dev`);
    expect(created.body.data.active).toBe(true);
    expect(created.body.data.roles).toEqual([{ value: 'EMPLOYEE' }]); // guarded default

    // Duplicate provisioning is a SCIM uniqueness conflict.
    const dup = await api(app)
      .post('/api/v1/scim/v2/Users')
      .set('Authorization', `Bearer ${token}`)
      .send({ userName: `scim-${run}@techpioasset.dev`, active: true });
    expect(dup.status).toBe(409);

    // An unknown role is refused by the guarded path, not silently dropped.
    const badRole = await api(app)
      .post('/api/v1/scim/v2/Users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        userName: `scim-${run}-rogue@techpioasset.dev`,
        active: true,
        roles: [{ value: 'NOT_A_ROLE' }],
      });
    expect(badRole.status).toBe(422);
  });

  it('deactivation blocks login; SCIM delete deprovisions, never destroys', async () => {
    const scimId = (await prisma.client.user.findFirst({
      where: { email: `scim-${run}@techpioasset.dev` },
      select: { id: true },
    }))!.id;

    const patched = await api(app)
      .patch(`/api/v1/scim/v2/Users/${scimId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ Operations: [{ op: 'replace', value: { active: false } }] });
    expect(patched.status).toBe(200);
    expect(patched.body.data.active).toBe(false);

    const user = await prisma.client.user.findUnique({ where: { id: scimId } });
    expect(user!.status).toBe('DEACTIVATED');

    const removed = await api(app)
      .delete(`/api/v1/scim/v2/Users/${scimId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(204);
    // The record survives - deprovision is never deletion.
    expect(await prisma.client.user.findUnique({ where: { id: scimId } })).not.toBeNull();

    // Filter round-trip (what IdPs actually send).
    const filtered = await api(app)
      .get(`/api/v1/scim/v2/Users?filter=${encodeURIComponent(`userName eq "scim-${run}@techpioasset.dev"`)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(filtered.body.data.totalResults).toBe(1);
    expect(filtered.body.data.Resources[0].active).toBe(false);
  });

  it('revoking the token closes the door', async () => {
    const revoked = await api(app)
      .delete('/api/v1/integrations/scim/token')
      .set(auth(s.superAdmin));
    expect(revoked.status).toBe(204);
    const after = await api(app)
      .get('/api/v1/scim/v2/Users')
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });
});
