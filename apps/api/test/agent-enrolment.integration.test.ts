import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.13 — the laptop agent's credential model.
 *
 * The property that matters: an agent is installed on hundreds of machines
 * that leave the building, so its credential must be worth almost nothing if
 * stolen. These tests hold that line — a device credential can report exactly
 * one machine's inventory and can do nothing else at all.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;

const MACHINE_A = 'test-machine-aaaa-1111';
const MACHINE_B = 'test-machine-bbbb-2222';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
});

afterAll(async () => {
  await prisma?.client.deviceAgent.deleteMany({
    where: { machineId: { in: [MACHINE_A, MACHINE_B] } },
  });
  await prisma?.client.agentEnrolmentToken.deleteMany({ where: { companyId } });
  await app?.close();
});

describe('enrolment token', () => {
  let enrolmentToken: string;

  it('is minted by an admin and returned exactly once', async () => {
    const res = await api(app)
      .post('/api/v1/discovery/agents/enrolment-token')
      .set(auth(s.itAdmin))
      .send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    enrolmentToken = res.body.data.token;
    expect(enrolmentToken).toMatch(/^tae_/);

    // Stored only as a hash.
    const row = await prisma.client.agentEnrolmentToken.findUnique({ where: { companyId } });
    expect(row?.tokenHash).not.toContain(enrolmentToken);
  });

  it('is refused to an employee', async () => {
    const res = await api(app)
      .post('/api/v1/discovery/agents/enrolment-token')
      .set(auth(s.employee))
      .send({});
    expect(res.status).toBe(403);
  });

  it('exchanges for a device credential, and a wrong token does not', async () => {
    const bad = await api(app)
      .post('/api/v1/discovery/agents/enrol')
      .set({ 'x-enrolment-token': 'tae_not-a-real-token' })
      .send({ machineId: MACHINE_A, hostname: 'LAPTOP-A', platform: 'windows' });
    expect(bad.status).toBe(401);

    const res = await api(app)
      .post('/api/v1/discovery/agents/enrol')
      .set({ 'x-enrolment-token': enrolmentToken })
      .send({
        machineId: MACHINE_A,
        hostname: 'LAPTOP-A',
        serialNumber: 'AGENT-SN-A',
        platform: 'windows',
        agentVersion: '1.0.0',
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    expect(res.body.data.deviceToken).toMatch(/^tad_/);
  });

  it('re-enrolling the same machine rotates rather than duplicates', async () => {
    const first = await prisma.client.deviceAgent.findFirst({
      where: { companyId, machineId: MACHINE_A },
      select: { id: true, tokenHash: true },
    });
    const again = await api(app)
      .post('/api/v1/discovery/agents/enrol')
      .set({ 'x-enrolment-token': enrolmentToken })
      .send({ machineId: MACHINE_A, hostname: 'LAPTOP-A-REBUILT', platform: 'windows' });
    expect(again.status).toBe(200);

    const rows = await prisma.client.deviceAgent.findMany({
      where: { companyId, machineId: MACHINE_A },
    });
    expect(rows).toHaveLength(1); // reinstalling a laptop is not a new device
    expect(rows[0].id).toBe(first!.id);
    expect(rows[0].tokenHash).not.toBe(first!.tokenHash); // credential rotated
  });
});

describe('device credential is worth almost nothing if stolen', () => {
  let deviceToken: string;
  let enrolmentToken: string;

  beforeAll(async () => {
    const mint = await api(app)
      .post('/api/v1/discovery/agents/enrolment-token')
      .set(auth(s.itAdmin))
      .send({});
    enrolmentToken = mint.body.data.token;
    const enrol = await api(app)
      .post('/api/v1/discovery/agents/enrol')
      .set({ 'x-enrolment-token': enrolmentToken })
      .send({ machineId: MACHINE_B, hostname: 'LAPTOP-B', platform: 'windows' });
    deviceToken = enrol.body.data.deviceToken;
  });

  it('can report its own inventory', async () => {
    const res = await api(app)
      .post('/api/v1/discovery/agents/report')
      .set({ Authorization: `Bearer ${deviceToken}` })
      .send({
        hostname: 'LAPTOP-B',
        serialNumber: 'AGENT-SN-B',
        hardware: { manufacturer: 'Dell', modelName: 'Latitude 7450', cpu: 'i7', ramGb: 16 },
        os: { osName: 'Windows 11', osVersion: '24H2', diskEncrypted: true },
        software: [{ name: 'Google Chrome', version: '140.0' }],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.received).toBe(1);

    // The reported machine is pinned to the credential's machineId.
    const device = await prisma.client.discoveredDevice.findFirst({
      where: { companyId, externalId: MACHINE_B },
      select: { hostname: true },
    });
    expect(device?.hostname).toBe('LAPTOP-B');
  });

  it('cannot reach ANY human endpoint with that credential', async () => {
    const asAgent = { Authorization: `Bearer ${deviceToken}` };
    for (const path of [
      '/api/v1/assets',
      '/api/v1/users',
      '/api/v1/discovery/devices',
      '/api/v1/discovery/agents',
      '/api/v1/auth/me',
      '/api/v1/requests',
    ]) {
      const res = await api(app).get(path).set(asAgent);
      expect([401, 403], `${path} let an agent credential through`).toContain(res.status);
    }
    // ...and cannot mint itself a wider one.
    const mint = await api(app)
      .post('/api/v1/discovery/agents/enrolment-token')
      .set(asAgent)
      .send({});
    expect([401, 403]).toContain(mint.status);
  });

  it('stops working the moment the laptop is revoked', async () => {
    const agent = await prisma.client.deviceAgent.findFirst({
      where: { companyId, machineId: MACHINE_B },
      select: { id: true },
    });
    const revoke = await api(app)
      .delete(`/api/v1/discovery/agents/${agent!.id}`)
      .set(auth(s.itAdmin));
    expect(revoke.status).toBe(204);

    const res = await api(app)
      .post('/api/v1/discovery/agents/report')
      .set({ Authorization: `Bearer ${deviceToken}` })
      .send({ hostname: 'LAPTOP-B' });
    expect(res.status).toBe(401);

    // The row survives revocation - enrolment history stays readable.
    const still = await prisma.client.deviceAgent.findFirst({
      where: { companyId, machineId: MACHINE_B },
      select: { revokedAt: true },
    });
    expect(still?.revokedAt).not.toBeNull();
  });
});
