import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.11 — user soft delete, and the "my requests" filter.
 *
 * The line the delete tests hold: deleting a person must never delete the
 * answer to "who had that laptop in 2025". Soft delete removes the account
 * from lists and sign-in while the row, its assignment history and its audit
 * trail stay. And it is refused outright while equipment is still out.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;
let victimId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;

  // A throwaway user, created directly: the shared demo accounts are used by
  // every other suite, so deleting one of them would sabotage the next test.
  // Upsert so a crashed earlier run's leftover row cannot fail setup.
  const victim = await prisma.client.user.upsert({
    where: { companyId_email: { companyId, email: 'delete-me@techpioasset.test' } },
    update: { status: 'ACTIVE', deletedAt: null },
    create: {
      companyId,
      email: 'delete-me@techpioasset.test',
      passwordHash: 'x',
      status: 'ACTIVE',
      profile: { create: { firstName: 'Del', lastName: 'Etable' } },
    },
  });
  victimId = victim.id;
});

afterAll(async () => {
  // AssetAssignment is append-only through the Prisma client (spec section
  // 22), which is correct for the app and wrong for test residue - raw SQL is
  // the deliberate escape hatch so the suite leaves no rows behind.
  if (prisma && victimId) {
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_assignments WHERE "userId" = $1', victimId);
    await prisma.client.$executeRawUnsafe('DELETE FROM user_profiles WHERE "userId" = $1', victimId);
    await prisma.client.$executeRawUnsafe('DELETE FROM users WHERE id = $1', victimId);
  }
  await app?.close();
});

describe('soft-deleting a user', () => {
  it('is refused without users:manage', async () => {
    const res = await api(app).delete(`/api/v1/users/${victimId}`).set(auth(s.employee));
    expect(res.status).toBe(403);
  });

  it('is refused on yourself', async () => {
    const res = await api(app)
      .delete(`/api/v1/users/${s.superAdmin.user.id}`)
      .set(auth(s.superAdmin));
    expect([400, 422]).toContain(res.status);
  });

  it('is refused while assets are still assigned - return the laptop first', async () => {
    const asset = await prisma.client.asset.findFirst({
      where: { companyId },
      select: { id: true, condition: true },
    });
    const assignment = await prisma.client.assetAssignment.create({
      data: {
        assetId: asset!.id,
        userId: victimId,
        conditionOut: asset!.condition,
      },
    });

    const res = await api(app).delete(`/api/v1/users/${victimId}`).set(auth(s.superAdmin));
    expect(res.status, JSON.stringify(res.body)).toBe(409);

    // Return the equipment; history row stays, delete becomes possible.
    await prisma.client.assetAssignment.update({
      where: { id: assignment.id },
      data: { returnedAt: new Date() },
    });
  });

  it('then succeeds, vanishes from lists, keeps history, and is audited', async () => {
    const res = await api(app).delete(`/api/v1/users/${victimId}`).set(auth(s.superAdmin));
    expect(res.status, JSON.stringify(res.body)).toBe(204);

    // Gone from the People list...
    const list = await api(app)
      .get('/api/v1/users?q=delete-me@techpioasset.test')
      .set(auth(s.superAdmin));
    expect(list.body.data).toHaveLength(0);

    // ...and from direct reads...
    const one = await api(app).get(`/api/v1/users/${victimId}`).set(auth(s.superAdmin));
    expect(one.status).toBe(404);

    // ...but the row and its assignment history survive. Raw SQL on purpose:
    // the Prisma client itself filters soft-deleted rows out of reads, which
    // is exactly the behaviour under test - so proving the row still exists
    // requires going underneath it.
    const [row] = await prisma.client.$queryRawUnsafe<
      { deletedAt: Date | null; status: string }[]
    >('SELECT "deletedAt", status FROM users WHERE id = $1', victimId);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.status).toBe('DEACTIVATED');
    const history = await prisma.client.assetAssignment.count({ where: { userId: victimId } });
    expect(history).toBe(1);

    const audit = await prisma.client.auditLog.findFirst({
      where: { companyId, action: 'USER_UPDATED', entityId: victimId, actorId: s.superAdmin.user.id },
      orderBy: { createdAt: 'desc' },
      select: { newValues: true },
    });
    expect(JSON.stringify(audit?.newValues)).toContain('Soft delete');
  });

  it('a second delete of the same user 404s - it is already gone', async () => {
    const res = await api(app).delete(`/api/v1/users/${victimId}`).set(auth(s.superAdmin));
    expect(res.status).toBe(404);
  });
});

describe('the deactivated view', () => {
  it('deactivated users leave the default list and appear under view=deactivated', async () => {
    // Reuse the victim before its deletion tests run? No - this block runs
    // after them, so make a fresh deactivated (not deleted) user.
    const parked = await prisma.client.user.upsert({
      where: { companyId_email: { companyId, email: 'parked@techpioasset.test' } },
      update: { status: 'DEACTIVATED', deletedAt: null },
      create: {
        companyId,
        email: 'parked@techpioasset.test',
        passwordHash: 'x',
        status: 'DEACTIVATED',
        profile: { create: { firstName: 'Parked', lastName: 'Account' } },
      },
    });

    const activeList = await api(app)
      .get('/api/v1/users?q=parked@techpioasset.test')
      .set(auth(s.superAdmin));
    expect(activeList.body.data).toHaveLength(0);

    const deactivatedList = await api(app)
      .get('/api/v1/users?view=deactivated&q=parked@techpioasset.test')
      .set(auth(s.superAdmin));
    expect(deactivatedList.body.data).toHaveLength(1);
    expect(deactivatedList.body.data[0].status).toBe('DEACTIVATED');

    await prisma.client.$executeRawUnsafe('DELETE FROM user_profiles WHERE "userId" = $1', parked.id);
    await prisma.client.$executeRawUnsafe('DELETE FROM users WHERE id = $1', parked.id);
  });
});

describe('request items carry notes without prices (v2.12)', () => {
  it('an employee request with notes and no cost is accepted and the note persists', async () => {
    // Costs stay accepted at the API for everyone - approval routing depends
    // on them (spec section 11) - but the employee FORM never sends one; it
    // sends notes (preferredSpec) instead. This holds the notes path.
    const accepted = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        businessReason: 'Second monitor for code review work',
        items: [{ description: 'Monitor', quantity: 1, preferredSpec: '24-inch, IPS' }],
      });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);

    const item = await prisma.client.requestItem.findFirst({
      where: { requestId: accepted.body.data.id },
      select: { preferredSpec: true, estimatedCost: true },
    });
    expect(item?.preferredSpec).toBe('24-inch, IPS');
    expect(item?.estimatedCost).toBeNull();

    await prisma.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', accepted.body.data.id);
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', accepted.body.data.id);
  });
});

describe('the mine=true request filter', () => {
  it('returns only requests the caller raised', async () => {
    const res = await api(app)
      .get('/api/v1/requests?mine=true&pageSize=100')
      .set(auth(s.superAdmin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const mine = await prisma.client.assetRequest.count({
      where: { companyId, requesterId: s.superAdmin.user.id },
    });
    expect(res.body.data).toHaveLength(Math.min(mine, 100));
  });
});
