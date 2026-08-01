import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.3 L2 — the licenses module end to end: guards, CRUD with the default seat
 * pool, assign/revoke with the transactional limit, renewals, encrypted keys
 * (masked always, reveal audited), and cost gating. The parallel-assignment
 * concurrency proof and the qa-pack LIC-* runs live in the L3 spec.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;

const base = '/api/v1/licenses';

beforeAll(async () => {
  // Boot with key encryption configured so the key endpoints are exercisable.
  process.env.LICENSE_KEY_SECRET = 'integration-test-key-secret';
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

async function createLicense(overrides: Record<string, unknown> = {}) {
  const res = await api(app)
    .post(base)
    .set(auth(s.superAdmin))
    .send({
      name: 'Test Suite License',
      family: 'PRODUCTIVITY_SUITE',
      subscriptionType: 'SUBSCRIPTION',
      purchaseDate: '2026-01-01',
      expiryDate: '2027-06-30',
      seatsPurchased: 2,
      unitOfAssignment: 'USER',
      ...overrides,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; pools: { id: string }[] };
}

async function cleanup(id: string) {
  // Revoke whatever is active, then delete.
  const detail = await api(app).get(`${base}/${id}`).set(auth(s.superAdmin));
  if (detail.status !== 200) return;
  for (const a of detail.body.data.assignments as { id: string; status: string }[]) {
    if (a.status === 'ACTIVE') {
      await api(app).post(`${base}/${id}/revoke`).set(auth(s.superAdmin)).send({ assignmentId: a.id });
    }
  }
  await api(app).delete(`${base}/${id}`).set(auth(s.superAdmin));
}

describe('guards', () => {
  it('refuses the list to a role without licenses:read, but serves everyone their own seats', async () => {
    expect((await api(app).get(base).set(auth(s.employee))).status).toBe(403);
    expect((await api(app).get(`${base}/mine`).set(auth(s.employee))).status).toBe(200);
  });

  it('lets IT (licenses:read) list, without cost fields', async () => {
    const license = await createLicense({ costAmount: '4999.00', costCurrency: 'EUR' });
    try {
      const res = await api(app).get(base).set(auth(s.itAdmin));
      expect(res.status).toBe(200);
      const row = res.body.data.find((l: { id: string }) => l.id === license.id);
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty('costAmount');

      // Finance holds licenses:cost:read and sees the figure.
      const fin = await api(app).get(`${base}/${license.id}`).set(auth(s.finance));
      expect(fin.status).toBe(200);
      expect(fin.body.data).toHaveProperty('costAmount');
    } finally {
      await cleanup(license.id);
    }
  });
});

describe('lifecycle', () => {
  it('creates a licence with its default pool and derived seat numbers', async () => {
    const license = await createLicense();
    try {
      const res = await api(app).get(`${base}/${license.id}`).set(auth(s.superAdmin));
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.pools).toHaveLength(1);
      expect(d.pools[0].name).toBe('Default Pool');
      expect(d.pools[0].seatsAllocated).toBe(2);
      expect(d.seatsReserved).toBe(0);
      expect(d.seatsAvailable).toBe(2);
      expect(d.status).toBe('ACTIVE');
    } finally {
      await cleanup(license.id);
    }
  });

  it('assigns up to the limit, refuses the seat beyond it with honest numbers, and frees on revoke', async () => {
    const license = await createLicense();
    try {
      const a1 = await api(app)
        .post(`${base}/${license.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee.user.id });
      expect(a1.status, JSON.stringify(a1.body)).toBe(201);
      expect(a1.body.data.seatsReserved).toBe(1);

      // The same user cannot hold two active seats on one licence.
      const dup = await api(app)
        .post(`${base}/${license.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee.user.id });
      expect(dup.status).toBe(409);

      const a2 = await api(app)
        .post(`${base}/${license.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee2.user.id });
      expect(a2.status).toBe(201);
      expect(a2.body.data.seatsAvailable).toBe(0);

      // Seat 3 of 2 — the flagship refusal.
      const blocked = await api(app)
        .post(`${base}/${license.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee3.user.id });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('SEAT_LIMIT_EXCEEDED');
      expect(blocked.body.detail).toContain('Available: 0');
      expect(blocked.body.detail).toContain('Purchased: 2');

      // The blocked attempt leaves an audit trail.
      const audit = await api(app)
        .get('/api/v1/audit?action=LICENSE_ASSIGN_BLOCKED&pageSize=5')
        .set(auth(s.superAdmin));
      expect(audit.status).toBe(200);
      expect(audit.body.data.length).toBeGreaterThanOrEqual(1);

      // The employee sees their seat under /mine.
      const mine = await api(app).get(`${base}/mine`).set(auth(s.employee));
      expect(mine.body.data.some((m: { license: { id: string } }) => m.license.id === license.id)).toBe(true);

      // Revoke one seat; the freed seat is immediately assignable.
      const revoked = await api(app)
        .post(`${base}/${license.id}/revoke`)
        .set(auth(s.superAdmin))
        .send({ assignmentId: a1.body.data.assignments.find((x: { status: string }) => x.status === 'ACTIVE').id });
      expect(revoked.status, JSON.stringify(revoked.body)).toBe(201);

      const a3 = await api(app)
        .post(`${base}/${license.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee3.user.id });
      expect(a3.status).toBe(201);
    } finally {
      await cleanup(license.id);
    }
  });

  it('renews append-only: extends expiry, adds seats, grows the default pool', async () => {
    const license = await createLicense();
    try {
      const renewed = await api(app)
        .post(`${base}/${license.id}/renewals`)
        .set(auth(s.superAdmin))
        .send({ newExpiry: '2028-06-30', seatsDelta: 1 });
      expect(renewed.status, JSON.stringify(renewed.body)).toBe(201);
      const d = renewed.body.data;
      expect(d.seatsPurchased).toBe(3);
      expect(d.pools[0].seatsAllocated).toBe(3);
      expect(d.renewals).toHaveLength(1);
      expect(d.renewals[0].seatsDelta).toBe(1);
    } finally {
      await cleanup(license.id);
    }
  });

  it('refuses shrinking below the seats currently assigned', async () => {
    const license = await createLicense();
    try {
      await api(app)
        .post(`${base}/${license.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee.user.id });
      const shrink = await api(app)
        .post(`${base}/${license.id}/renewals`)
        .set(auth(s.superAdmin))
        .send({ seatsDelta: -2 });
      expect(shrink.status).toBe(409);
    } finally {
      await cleanup(license.id);
    }
  });

  it('refuses deleting a licence with active seats, allows it once revoked', async () => {
    const license = await createLicense();
    const assigned = await api(app)
      .post(`${base}/${license.id}/assign`)
      .set(auth(s.superAdmin))
      .send({ userId: s.employee.user.id });
    const blocked = await api(app).delete(`${base}/${license.id}`).set(auth(s.superAdmin));
    expect(blocked.status).toBe(409);

    const active = assigned.body.data.assignments.find((x: { status: string }) => x.status === 'ACTIVE');
    await api(app).post(`${base}/${license.id}/revoke`).set(auth(s.superAdmin)).send({ assignmentId: active.id });
    const ok = await api(app).delete(`${base}/${license.id}`).set(auth(s.superAdmin));
    expect(ok.status).toBe(200);
  });

  it('a DEVICE licence takes an asset, not a user', async () => {
    const license = await createLicense({ unitOfAssignment: 'DEVICE', name: 'Per-Device License' });
    try {
      const wrong = await api(app)
        .post(`${base}/${license.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ userId: s.employee.user.id });
      expect(wrong.status).toBe(422);

      const assets = await api(app).get('/api/v1/assets?pageSize=1').set(auth(s.superAdmin));
      const asset = assets.body.data[0];
      const right = await api(app)
        .post(`${base}/${license.id}/assign`)
        .set(auth(s.superAdmin))
        .send({ assetId: asset.id });
      expect(right.status, JSON.stringify(right.body)).toBe(201);
    } finally {
      await cleanup(license.id);
    }
  });
});

describe('keys', () => {
  it('stores keys encrypted, serves them masked, reveals only with the permission (audited)', async () => {
    const license = await createLicense();
    try {
      const added = await api(app)
        .post(`${base}/${license.id}/keys`)
        .set(auth(s.superAdmin))
        .send({ key: 'AAAA-BBBB-CCCC-1234' });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      expect(added.body.data.masked).toContain('1234');
      expect(JSON.stringify(added.body)).not.toContain('AAAA-BBBB');

      const detail = await api(app).get(`${base}/${license.id}`).set(auth(s.superAdmin));
      expect(JSON.stringify(detail.body)).not.toContain('AAAA-BBBB');
      const keyId = detail.body.data.keys[0].id;

      // IT (no licenses:keys:reveal) is refused; Super Admin may reveal.
      const denied = await api(app)
        .post(`${base}/${license.id}/keys/${keyId}/reveal`)
        .set(auth(s.itAdmin));
      expect(denied.status).toBe(403);

      const revealed = await api(app)
        .post(`${base}/${license.id}/keys/${keyId}/reveal`)
        .set(auth(s.superAdmin));
      expect(revealed.status).toBe(201);
      expect(revealed.body.data.key).toBe('AAAA-BBBB-CCCC-1234');

      const audit = await api(app)
        .get('/api/v1/audit?action=LICENSE_KEY_REVEALED&pageSize=1')
        .set(auth(s.superAdmin));
      expect(audit.body.data.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup(license.id);
    }
  });
});
