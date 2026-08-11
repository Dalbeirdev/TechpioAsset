import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ISSUE_CATEGORIES } from '@techpioasset/domain';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.14 — the published issue catalogue.
 *
 * The value of a fixed list is that it is reportable, so the checks are: the
 * chosen category is stored exactly as published, an unknown key is dropped
 * rather than persisted (a bad key would quietly corrupt the numbers), and the
 * ticket still travels the normal request pipeline.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
const created: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  for (const id of created) {
    await prisma.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM request_approvals WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', id);
  }
  await app?.close();
});

const raise = (issueCategory: string | undefined, type = 'REPAIR') =>
  api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type,
      businessReason: 'The screen flickers whenever the lid is moved',
      ...(issueCategory ? { issueCategory } : {}),
      items: [{ description: 'Laptop screen', quantity: 1 }],
    });

describe('issue catalogue', () => {
  it('stores every published category, and an employee may raise one', async () => {
    for (const category of ISSUE_CATEGORIES) {
      const res = await raise(category.key, category.requestType);
      expect(res.status, `${category.key}: ${JSON.stringify(res.body).slice(0, 160)}`).toBe(201);
      created.push(res.body.data.id);

      const row = await prisma.client.assetRequest.findUnique({
        where: { id: res.body.data.id },
        select: { issueCategory: true, type: true },
      });
      expect(row?.issueCategory).toBe(category.key);
      expect(row?.type).toBe(category.requestType);
    }
  }, 60_000);

  it('drops an unknown key rather than storing it', async () => {
    const res = await raise('NOT_A_REAL_CATEGORY');
    expect(res.status).toBe(201);
    created.push(res.body.data.id);
    const row = await prisma.client.assetRequest.findUnique({
      where: { id: res.body.data.id },
      select: { issueCategory: true },
    });
    // Null, never the junk value: the reports stay trustworthy.
    expect(row?.issueCategory).toBeNull();
  });

  it('an issue ticket still travels the normal pipeline (submit + approvals)', async () => {
    const res = await raise('HARDWARE_DAMAGE', 'DAMAGE');
    const id = res.body.data.id;
    created.push(id);

    const submitted = await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.employee));
    expect([200, 201], JSON.stringify(submitted.body).slice(0, 200)).toContain(submitted.status);

    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.employee));
    expect(detail.body.data.issueCategory).toBe('HARDWARE_DAMAGE');
    expect(detail.body.data.status).not.toBe('DRAFT');
  });
});
