import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * The comment cap has to be decidable.
 *
 * A request's comments are capped at the newest 100. Ordering by timestamp
 * alone leaves that undefined the moment two comments share a millisecond -
 * which a script, an import or a busy thread all manage - so the cap could drop
 * the most recent comment and keep an older one, and the existing bounded-reads
 * test failed intermittently under parallel load for exactly that reason.
 *
 * Rather than hope load reproduces it, this writes the collision: every comment
 * gets the same createdAt, so timestamp ordering decides nothing and only the
 * tiebreaker can.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let requestId: string;

const SAME_INSTANT = new Date('2026-08-19T10:00:00.000Z');
const TOTAL = 105;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Comment cap tie-break fixture',
      items: [{ description: `Cap fixture ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
    });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  requestId = created.body.data.id;

  // Sequential, so the ids ascend with creation order, but every row carries an
  // identical timestamp - the collision this is about.
  for (let i = 0; i < TOTAL; i++) {
    await prisma.client.requestComment.create({
      data: {
        requestId,
        authorId: s.employee.user.id,
        body: `comment ${i}`,
        isInternal: false,
        createdAt: SAME_INSTANT,
      },
    });
  }
});

afterAll(async () => {
  await prisma.client.$executeRawUnsafe('DELETE FROM request_comments WHERE "requestId" = $1', requestId);
  await prisma.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', requestId);
  await prisma.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', requestId);
  await app?.close();
});

describe('comment cap with colliding timestamps', () => {
  it('keeps the newest comments, not an arbitrary hundred', async () => {
    const res = await api(app).get(`/api/v1/requests/${requestId}`).set(auth(s.employee));
    const bodies = (res.body.data.comments as { body: string }[]).map((c) => c.body);

    expect(bodies).toHaveLength(100);
    // The last comment written is the one a reader most needs to see.
    expect(bodies.at(-1)).toBe(`comment ${TOTAL - 1}`);
    // ...and the window is the newest hundred, so the first five are gone.
    expect(bodies).not.toContain('comment 0');
    expect(bodies[0]).toBe(`comment ${TOTAL - 100}`);
  });

  it('returns the same window every time it is asked', async () => {
    const reads = await Promise.all(
      Array.from({ length: 5 }, () =>
        api(app).get(`/api/v1/requests/${requestId}`).set(auth(s.employee)),
      ),
    );
    const windows = reads.map((r) =>
      (r.body.data.comments as { body: string }[]).map((c) => c.body).join('|'),
    );

    // Undecidable ordering shows up here as two reads disagreeing.
    expect(new Set(windows).size).toBe(1);
  });
});
