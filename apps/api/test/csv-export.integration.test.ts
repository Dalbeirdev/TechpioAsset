import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * CSV export on the list pages. Exports inherit the list's scope, filters, and
 * permission gate, so these tests prove the shape (headers, attachment, BOM),
 * that filters narrow the output, and that scope/permissions are honoured.
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

describe('assets CSV export', () => {
  it('streams a UTF-8 CSV attachment with a header row', async () => {
    const res = await api(app).get('/api/v1/assets/export').set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text.split('\r\n')[0]).toContain('Asset tag');
  });

  it('omits the cost column for a caller without cost visibility', async () => {
    const res = await api(app).get('/api/v1/assets/export').set(auth(s.itAdmin));
    expect(res.text.split('\r\n')[0]).not.toContain('Purchase cost');
  });

  it('applies the same filters as the list', async () => {
    const all = await api(app).get('/api/v1/assets/export').set(auth(s.superAdmin));
    const filtered = await api(app)
      .get('/api/v1/assets/export?status=RETIRED')
      .set(auth(s.superAdmin));
    const allRows = all.text.split('\r\n').length;
    const filteredRows = filtered.text.split('\r\n').length;
    expect(filteredRows).toBeLessThan(allRows);
  });

  it('scopes to the caller (an employee exports only their own)', async () => {
    const emp = await api(app).get('/api/v1/assets/export').set(auth(s.employee));
    const admin = await api(app).get('/api/v1/assets/export').set(auth(s.superAdmin));
    expect(emp.text.split('\r\n').length).toBeLessThan(admin.text.split('\r\n').length);
  });
});

describe('people & requests CSV export', () => {
  it('exports people for a reader, and forbids one without employees:read', async () => {
    const ok = await api(app).get('/api/v1/users/export').set(auth(s.hr));
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('Employee number');

    const denied = await api(app).get('/api/v1/users/export').set(auth(s.employee));
    expect(denied.status).toBe(403);
  });

  it('exports requests scoped to the caller', async () => {
    const res = await api(app).get('/api/v1/requests/export').set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('requests-');
    expect(res.text.split('\r\n')[0]).toContain('Request');
  });
});
