import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 2a: handing a device from one person to the next in one step.
 *
 * Before this, A→B meant return-then-assign: two calls, and between them the
 * asset belonged to nobody. If the second call failed - a validation error, a
 * dropped connection, a closed laptop - the record said "returned, sitting in
 * storage" about a device that was physically in someone's hands. These tests
 * exist to hold that window shut.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

async function freshAsset(suffix: string) {
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const itCategory = categories.body.data.find((c: { key: string }) => c.key === 'it-assets');

  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: `RSGN-${suffix}`,
      name: `Reassign test laptop ${suffix}`,
      categoryId: itCategory.id,
      serialNumber: `RSGNSN-${suffix}`,
      status: 'AVAILABLE',
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.data as { id: string; assetTag: string };
}

const uniq = () => `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 900 + 100)}`;

describe('POST /assets/:id/reassign', () => {
  it('moves custody A→B in one call, leaving a closed return and an open assignment', async () => {
    const asset = await freshAsset(uniq());

    const assigned = await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'NEW' });
    expect(assigned.status).toBe(201);

    const moved = await api(app)
      .post(`/api/v1/assets/${asset.id}/reassign`)
      .set(auth(s.itAdmin))
      .send({
        userId: s.employee2.user.id,
        conditionIn: 'GOOD',
        conditionOut: 'GOOD',
        accessoriesIssued: 'Charger',
      });
    expect(moved.status, JSON.stringify(moved.body)).toBe(201);

    const after = moved.body.data;
    expect(after.status).toBe('ASSIGNED');
    expect(after.assignedUser.id).toBe(s.employee2.user.id);

    // The outgoing holder's row is closed - not deleted. An asset's history is
    // the point of the system; overwriting it would be the easy wrong answer.
    const open = after.assignments.filter((a: { returnedAt: string | null }) => !a.returnedAt);
    expect(open).toHaveLength(1);
    expect(open[0].user?.id ?? open[0].userId).toBe(s.employee2.user.id);

    const closed = after.assignments.filter((a: { returnedAt: string | null }) => a.returnedAt);
    expect(closed.length).toBeGreaterThanOrEqual(1);
  });

  it('records the handover as a transfer in the audit log', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    await api(app)
      .post(`/api/v1/assets/${asset.id}/reassign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee2.user.id, conditionIn: 'GOOD' });

    const audit = await api(app)
      .get(`/api/v1/audit?entityId=${asset.id}&pageSize=50`)
      .set(auth(s.superAdmin));
    expect(audit.status).toBe(200);
    expect(
      audit.body.data.some((e: { action: string }) => e.action === 'ASSET_TRANSFERRED'),
    ).toBe(true);
  });

  it('refuses to reassign an asset nobody is holding', async () => {
    const asset = await freshAsset(uniq());

    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/reassign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionIn: 'GOOD' });
    expect(res.status).toBe(422);
  });

  it('refuses to hand a device to the person already holding it', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/reassign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionIn: 'GOOD' });
    expect(res.status).toBe(422);
  });

  it('rejects a recipient from another tenant as not found', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/reassign`)
      .set(auth(s.itAdmin))
      .send({ userId: 'usr_from_some_other_company', conditionIn: 'GOOD' });
    expect(res.status).toBe(404);
  });

  it('denies an employee, who may hold a device but not move one', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/reassign`)
      .set(auth(s.employee))
      .send({ userId: s.employee2.user.id, conditionIn: 'GOOD' });
    expect(res.status).toBe(403);
  });

  it('leaves custody untouched when the call is rejected', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    await api(app)
      .post(`/api/v1/assets/${asset.id}/reassign`)
      .set(auth(s.itAdmin))
      .send({ userId: 'usr_nope', conditionIn: 'GOOD' });

    // The half-way state the two-call flow could produce: RETURNED, holder gone.
    const check = await api(app).get(`/api/v1/assets/${asset.id}`).set(auth(s.itAdmin));
    expect(check.body.data.status).toBe('ASSIGNED');
    expect(check.body.data.assignedUser.id).toBe(s.employee.user.id);
  });
});

describe('asset list exposes the open assignment for receipt confirmation', () => {
  it('lets the holder see, and confirm, their own unacknowledged assignment', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const mine = await api(app)
      .get(`/api/v1/assets?assignedUserId=${s.employee.user.id}&pageSize=100`)
      .set(auth(s.employee));
    expect(mine.status).toBe(200);

    const row = mine.body.data.find((a: { id: string }) => a.id === asset.id);
    expect(row, 'the holder should see their own device').toBeTruthy();
    expect(row.assignments).toHaveLength(1);
    expect(row.assignments[0].acknowledgedAt).toBeNull();
    // Only the open one rides along - never the device's previous holders.
    expect(row.assignments[0].userId).toBeUndefined();

    const ack = await api(app)
      .post(`/api/v1/assets/assignments/${row.assignments[0].id}/acknowledge`)
      .set(auth(s.employee))
      .send({});
    expect(ack.status, JSON.stringify(ack.body)).toBe(201);

    const again = await api(app)
      .get(`/api/v1/assets?assignedUserId=${s.employee.user.id}&pageSize=100`)
      .set(auth(s.employee));
    const acked = again.body.data.find((a: { id: string }) => a.id === asset.id);
    expect(acked.assignments[0].acknowledgedAt).not.toBeNull();
  });
});
