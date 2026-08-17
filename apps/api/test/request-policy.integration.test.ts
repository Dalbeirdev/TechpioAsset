import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.22 - who may raise a request.
 *
 * The point of these is that the SERVER refuses. Hiding the button is a
 * courtesy to the person; only this stops a request arriving anyway from a
 * stale tab, a bookmark or curl.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let companyId: string;
const created: string[] = [];

async function setPolicy(policy: 'EVERYONE' | 'ADMINS_ONLY') {
  await prisma.client.$executeRawUnsafe(
    'UPDATE companies SET "requestPolicy" = $1::"RequestCreationPolicy" WHERE id = $2',
    policy,
    companyId,
  );
}

async function setOverride(userId: string, value: boolean | null) {
  await prisma.client.userProfile.update({
    where: { userId },
    data: { canRaiseRequests: value },
  });
}

function raise(session: Session, label: string) {
  return api(app)
    .post('/api/v1/requests')
    .set(auth(session))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      priority: 'NORMAL',
      businessReason: `Policy test - ${label} needs a spare keyboard for the desk.`,
      items: [{ description: `Keyboard ${label}-${Math.random().toString(36).slice(2, 7)}`, quantity: 1 }],
    });
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  companyId = s.employee.user.companyId;
});

beforeEach(async () => {
  await setPolicy('EVERYONE');
  await setOverride(s.employee.user.id, null);
});

afterAll(async () => {
  await setPolicy('EVERYONE');
  await setOverride(s.employee.user.id, null);
  for (const id of created) {
    await prisma.client.$executeRawUnsafe('DELETE FROM request_approvals WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', id);
  }
  await app?.close();
});

describe('the default is unchanged', () => {
  it('an employee can raise a request when the policy is EVERYONE', async () => {
    const res = await raise(s.employee, 'default');
    expect(res.status).toBe(201);
    created.push(res.body.data.id as string);
  });
});

describe('turning it off company-wide', () => {
  it('refuses an employee, and says who to ask', async () => {
    await setPolicy('ADMINS_ONLY');
    const res = await raise(s.employee, 'blocked');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/IT and HR/i);
  });

  it('still lets HR raise, because raising for others is their job', async () => {
    await setPolicy('ADMINS_ONLY');
    const res = await raise(s.hr, 'hr');
    expect(res.status).toBe(201);
    created.push(res.body.data.id as string);
  });
});

describe('per-person exceptions', () => {
  it('blocks one person while everyone else carries on', async () => {
    await setOverride(s.employee.user.id, false);

    const blocked = await raise(s.employee, 'individual');
    expect(blocked.status).toBe(403);
    expect(JSON.stringify(blocked.body)).toMatch(/turned off for your account/i);

    const other = await raise(s.employee2, 'unaffected');
    expect(other.status).toBe(201);
    created.push(other.body.data.id as string);
  });

  it('allows one person even while the company is restricted', async () => {
    await setPolicy('ADMINS_ONLY');
    await setOverride(s.employee.user.id, true);

    const res = await raise(s.employee, 'exempted');
    expect(res.status).toBe(201);
    created.push(res.body.data.id as string);
  });
});

describe('the admin controls', () => {
  it('an employee cannot change the company policy', async () => {
    const res = await api(app)
      .patch('/api/v1/company')
      .set(auth(s.employee))
      .send({ requestPolicy: 'EVERYONE' });
    expect(res.status).toBe(403);
  });

  it('a settings manager can, and it takes effect immediately', async () => {
    const saved = await api(app)
      .patch('/api/v1/company')
      .set(auth(s.superAdmin))
      .send({ requestPolicy: 'ADMINS_ONLY' });
    expect(saved.status).toBeLessThan(300);

    const blocked = await raise(s.employee, 'after-switch');
    expect(blocked.status).toBe(403);
  });

  it('an employee cannot lift their own block', async () => {
    await setOverride(s.employee.user.id, false);
    const res = await api(app)
      .patch(`/api/v1/users/${s.employee.user.id}/profile`)
      .set(auth(s.employee))
      .send({ canRaiseRequests: true });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const stillBlocked = await raise(s.employee, 'self-lift');
    expect(stillBlocked.status).toBe(403);
  });
});
