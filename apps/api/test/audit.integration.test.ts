import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * The audit log is read-only and permission-gated. It records what already
 * happens across the suite (logins, seed writes), so these tests assert access
 * control and filtering rather than seeding their own entries.
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

describe('audit log access', () => {
  it.each(['superAdmin', 'auditor', 'itAdmin', 'finance'] as AccountKey[])(
    'lets %s (holds audit:read) read the trail',
    async (role) => {
      const res = await api(app).get('/api/v1/audit?pageSize=5').set(auth(s[role]));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    },
  );

  it.each(['employee', 'hr', 'manager'] as AccountKey[])(
    'forbids %s (no audit:read)',
    async (role) => {
      const res = await api(app).get('/api/v1/audit?pageSize=5').set(auth(s[role]));
      expect(res.status).toBe(403);
    },
  );

  it('is unreadable without authentication', async () => {
    const res = await api(app).get('/api/v1/audit');
    expect(res.status).toBe(401);
  });
});

describe('audit log filtering', () => {
  it('returns entries newest-first with actor and change detail', async () => {
    const res = await api(app).get('/api/v1/audit?pageSize=10').set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    const row = res.body.data[0];
    expect(row).toHaveProperty('action');
    expect(row).toHaveProperty('entityType');
    expect(row).toHaveProperty('createdAt');
    // Newest first.
    const times = res.body.data.map((r: { createdAt: string }) => Date.parse(r.createdAt));
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });

  it('filters by action', async () => {
    const res = await api(app)
      .get('/api/v1/audit?action=LOGIN&pageSize=50')
      .set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    for (const row of res.body.data) {
      expect(row.action).toBe('LOGIN');
    }
  });

  it('rejects an unknown action value', async () => {
    const res = await api(app).get('/api/v1/audit?action=NONSENSE').set(auth(s.superAdmin));
    expect(res.status).toBe(422);
  });
});
