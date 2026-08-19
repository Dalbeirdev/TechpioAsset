import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.24 - the three webhook events that were offered but never fired.
 *
 * license.seat_blocked, workorder.escalated and discovery.conflict existed in
 * the contract and the settings UI while nothing published them, so a
 * subscription to any of them was a silent no-op. Each is now driven through
 * its real business path - a genuinely full seat pool, a genuinely overdue
 * work order, a genuinely ambiguous serial - and asserted at a live HTTP
 * receiver, not at a mock.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let receiver: Server;
let received: { event: string; body: Record<string, unknown> }[] = [];

const run = Date.now() % 1_000_000;
const cleanupAssets: string[] = [];
let licenseId: string | null = null;
let workOrderId: string | null = null;

/** Deliveries are asynchronous fire-and-forget; poll rather than sleep blind. */
async function waitForEvent(event: string, timeoutMs = 15_000) {
  const started = Date.now();
  for (;;) {
    const hit = received.find((r) => r.event === event);
    if (hit) return hit;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`no ${event} delivery arrived within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);

  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const parsed = JSON.parse(body) as { event: string; data: Record<string, unknown> };
      received.push({ event: parsed.event, body: parsed.data });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  const sub = await api(app)
    .post('/api/v1/integrations/webhooks')
    .set(auth(s.superAdmin))
    .send({
      url,
      events: ['license.seat_blocked', 'workorder.escalated', 'discovery.conflict'],
    });
  expect(sub.status, JSON.stringify(sub.body)).toBeLessThan(300);
});

afterAll(async () => {
  const companyId = s.superAdmin.user.companyId;
  await prisma.client.webhookDelivery.deleteMany({ where: { companyId } });
  await prisma.client.webhookSubscription.deleteMany({ where: { companyId } });
  if (workOrderId) {
    await prisma.client.$executeRawUnsafe('DELETE FROM maintenance_records WHERE id = $1', workOrderId);
  }
  if (licenseId) {
    await prisma.client.$executeRawUnsafe('DELETE FROM license_assignments WHERE "licenseId" = $1', licenseId);
    await prisma.client.$executeRawUnsafe('DELETE FROM seat_pools WHERE "licenseId" = $1', licenseId);
    await prisma.client.$executeRawUnsafe('DELETE FROM license_renewals WHERE "licenseId" = $1', licenseId).catch(() => {});
    await prisma.client.$executeRawUnsafe('DELETE FROM software_licenses WHERE id = $1', licenseId);
  }
  await prisma.client.discoveredDevice.deleteMany({
    where: { companyId, serialNumber: { contains: `WHK${run}`, mode: 'insensitive' } },
  });
  for (const id of cleanupAssets) {
    // Assignments are append-only through the client, so fixture teardown goes
    // under it - the same escape hatch every other suite's cleanup uses.
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_assignments WHERE "assetId" = $1', id);
    await prisma.client.hardwareProfile.deleteMany({ where: { assetId: id } }).catch(() => {});
    await prisma.client.assetHealth.deleteMany({ where: { assetId: id } }).catch(() => {});
    await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', id);
  }
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  await app?.close();
});

async function itAssetsCategoryId() {
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  return categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id as string;
}

describe('license.seat_blocked', () => {
  it('fires when a full pool refuses a seat', async () => {
    const license = await api(app)
      .post('/api/v1/licenses')
      .set(auth(s.superAdmin))
      .send({
        name: `Webhook seat test ${run}`,
        family: 'PRODUCTIVITY_SUITE',
        subscriptionType: 'SUBSCRIPTION',
        purchaseDate: '2026-01-01',
        expiryDate: '2027-06-30',
        seatsPurchased: 1,
        unitOfAssignment: 'USER',
      });
    expect(license.status, JSON.stringify(license.body)).toBe(201);
    licenseId = license.body.data.id;

    const first = await api(app)
      .post(`/api/v1/licenses/${licenseId}/assign`)
      .set(auth(s.superAdmin))
      .send({ userId: s.employee.user.id });
    expect(first.status, JSON.stringify(first.body)).toBeLessThan(300);

    // The pool is full; the second person is the refusal that must be heard.
    const second = await api(app)
      .post(`/api/v1/licenses/${licenseId}/assign`)
      .set(auth(s.superAdmin))
      .send({ userId: s.manager.user.id });
    expect(second.status).toBeGreaterThanOrEqual(400);

    const hit = await waitForEvent('license.seat_blocked');
    expect(hit.body.licenseId).toBe(licenseId);
    expect(hit.body.seatsPurchased).toBe(1);
    expect(hit.body.attemptedFor).toEqual({ userId: s.manager.user.id });
  });
});

describe('workorder.escalated', () => {
  it('fires when the sweep escalates an overdue order', async () => {
    const categoryId = await itAssetsCategoryId();
    const asset = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.itAdmin))
      .send({ assetTag: `WHK${run}-WO`, name: `Webhook WO asset ${run}`, categoryId });
    expect(asset.status).toBeLessThan(300);
    cleanupAssets.push(asset.body.data.id);

    const order = await api(app)
      .post('/api/v1/maintenance')
      .set(auth(s.itAdmin))
      .send({ assetId: asset.body.data.id, type: 'REPAIR', title: `Webhook escalation ${run}` });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    workOrderId = order.body.data.id;
    await api(app).post(`/api/v1/maintenance/${workOrderId}/start`).set(auth(s.itAdmin));

    // An SLA agreed and missed - the sweep's own precondition, set as data
    // because the deadline in the past cannot be created through the API.
    await prisma.client.maintenanceRecord.update({
      where: { id: workOrderId },
      data: { slaDueAt: new Date(Date.now() - 86_400_000), escalatedAt: null },
    });

    const sweep = app.get(AlertSweepService);
    const result = await sweep.runWorkOrderSweep();
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    const hit = await waitForEvent('workorder.escalated');
    expect(hit.body.workOrderId).toBe(workOrderId);
    expect(hit.body.assetTag).toBe(`WHK${run}-WO`);
  });
});

describe('discovery.conflict', () => {
  it('fires when a reported serial matches two assets - and only on the first sighting', async () => {
    const categoryId = await itAssetsCategoryId();
    const serial = `WHK${run}-DUP`;

    // Two records whose serials differ only in case: the uniqueness index is
    // exact, so both can exist - and discovery matches insensitively, so a
    // report of either spelling finds two candidates. This is precisely how
    // real fleets acquire conflicts: the same serial typed twice, differently.
    for (const [n, spelling] of [[1, serial], [2, serial.toLowerCase()]] as const) {
      const res = await api(app)
        .post('/api/v1/assets')
        .set(auth(s.itAdmin))
        .send({
          assetTag: `WHK${run}-C${n}`,
          name: `Webhook conflict asset ${n}`,
          categoryId,
          serialNumber: spelling,
        });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      cleanupAssets.push(res.body.data.id);
    }

    const ingest = () =>
      api(app)
        .post('/api/v1/discovery/ingest')
        .set(auth(s.itAdmin))
        .send({ devices: [{ hostname: `WHK${run}-HOST`, serialNumber: serial }] });

    const first = await ingest();
    expect(first.status, JSON.stringify(first.body)).toBeLessThan(300);
    expect(first.body.data.conflict).toBe(1);

    const hit = await waitForEvent('discovery.conflict');
    expect(hit.body.serialNumber).toBe(serial);

    // A daily agent re-reporting the same unresolved conflict is not news:
    // the second sighting must not produce a second webhook.
    received = received.filter((r) => r.event !== 'discovery.conflict');
    const again = await ingest();
    expect(again.status).toBeLessThan(300);
    await new Promise((r) => setTimeout(r, 3_000));
    expect(received.filter((r) => r.event === 'discovery.conflict')).toHaveLength(0);
  });
});
