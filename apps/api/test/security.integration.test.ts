import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 6 hardening: the security properties the rest of the suite assumes but
 * does not prove directly (spec sections 3, 8, 20, 26).
 *
 * These are adversarial: each test tries to do something it should not be
 * allowed to, and asserts the platform refuses. The value is in the refusals.
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

/** Returns the id of the first asset the given session can see. */
async function firstAssetId(session: Session): Promise<string> {
  const res = await api(app).get('/api/v1/assets?pageSize=1').set(auth(session));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data[0].id;
}

describe("horizontal IDOR — one employee cannot reach another employee's records (section 3)", () => {
  it('404s when an employee fetches an asset assigned to a different employee by id', async () => {
    // employee2 holds assets employee does not; the id is valid but out of scope.
    const foreignAssetId = await firstAssetId(s.employee2);
    const asMe = await firstAssetId(s.employee);
    expect(foreignAssetId).not.toBe(asMe);

    const res = await api(app).get(`/api/v1/assets/${foreignAssetId}`).set(auth(s.employee));
    // 404, not 403: the platform does not confirm the record even exists.
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it("does not leak the foreign asset in the employee's own list", async () => {
    const foreignAssetId = await firstAssetId(s.employee2);
    const list = await api(app).get('/api/v1/assets?pageSize=100').set(auth(s.employee));
    const ids: string[] = list.body.data.map((a: { id: string }) => a.id);
    expect(ids).not.toContain(foreignAssetId);
  });

  it('scopes the asset list: an employee sees strictly fewer assets than an admin', async () => {
    const mine = await api(app).get('/api/v1/assets?pageSize=100').set(auth(s.employee));
    const all = await api(app).get('/api/v1/assets?pageSize=100').set(auth(s.superAdmin));
    expect(mine.body.meta.page.totalItems).toBeLessThan(all.body.meta.page.totalItems);
  });
});

describe('vertical privilege — an employee cannot perform privileged actions (section 26)', () => {
  it('403s when an employee tries to create an asset', async () => {
    const res = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.employee))
      .send({ name: 'Rogue asset', categoryId: 'x', officeId: 'y' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('403s when a non-admin reads the AI configuration', async () => {
    expect((await api(app).get('/api/v1/ai-config').set(auth(s.employee))).status).toBe(403);
    expect((await api(app).get('/api/v1/ai-config').set(auth(s.finance))).status).toBe(403);
  });

  it('403s when HR opens a financial report (no cost permission)', async () => {
    const res = await api(app).get('/api/v1/reports?type=SPENDING_BY_VENDOR').set(auth(s.hr));
    expect(res.status).toBe(403);
  });
});

describe('authentication is required and enforced (section 26)', () => {
  it('401s a protected endpoint with no token', async () => {
    const res = await api(app).get('/api/v1/assets');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('401s a protected endpoint with a garbage bearer token', async () => {
    const res = await api(app)
      .get('/api/v1/assets')
      .set({ Authorization: 'Bearer not-a-real-token' });
    expect(res.status).toBe(401);
  });

  it('401s an expired-looking / malformed JWT', async () => {
    const res = await api(app)
      .get('/api/v1/auth/me')
      .set({ Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalidsig' });
    expect(res.status).toBe(401);
  });
});

describe('upload validation rejects hostile files at the HTTP layer (section 8)', () => {
  // The server decides file type by magic bytes, not by the declared MIME or the
  // extension, so a file whose bytes are not a recognised allowed type is refused
  // as UNSUPPORTED_MEDIA_TYPE regardless of what it claims to be.
  it('rejects junk bytes that claim to be a PDF', async () => {
    const res = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', Buffer.from('this is plainly not a pdf', 'ascii'), {
        filename: 'malware.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an executable renamed to an image (bytes betray it)', async () => {
    // MZ header — a Windows PE executable — named .png. Its bytes are not a PNG.
    const res = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), {
        filename: 'photo.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an empty file', async () => {
    const res = await api(app)
      .post('/api/v1/invoices/upload')
      .set(auth(s.finance))
      .attach('file', Buffer.from([]), { filename: 'empty.pdf', contentType: 'application/pdf' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // Empty payloads are caught either by the required-file pipe or the validator.
    expect(['FILE_REJECTED', 'VALIDATION_FAILED']).toContain(res.body.code);
  });
});

describe('scan-a-bill is restricted to Finance and Super Admin', () => {
  // A minimal valid PDF so a permitted role gets past the permission guard and
  // into the (successful) upload path.
  const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'ascii');

  it.each(['itAdmin', 'officeAdmin', 'hr', 'employee'] as AccountKey[])(
    'blocks %s from uploading an invoice (403)',
    async (role) => {
      const res = await api(app)
        .post('/api/v1/invoices/upload')
        .set(auth(s[role]))
        .attach('file', PDF, { filename: 'bill.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    },
  );

  it.each(['finance', 'superAdmin'] as AccountKey[])(
    'allows %s to upload an invoice',
    async (role) => {
      const res = await api(app)
        .post('/api/v1/invoices/upload')
        .set(auth(s[role]))
        .attach('file', PDF, { filename: 'bill.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(201);
    },
  );
});

describe('no sensitive value leaks in responses (section 20)', () => {
  it('never returns a password hash from the profile endpoint', async () => {
    const res = await api(app).get('/api/v1/auth/me').set(auth(s.employee));
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('argon2');
  });

  it('never returns a password hash from the user list', async () => {
    const res = await api(app).get('/api/v1/users?pageSize=50').set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('argon2');
  });

  it('error responses carry no stack trace or SQL', async () => {
    const res = await api(app).get('/api/v1/assets/does-not-exist').set(auth(s.superAdmin));
    expect(res.status).toBe(404);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/at \w+.*\(.*:\d+:\d+\)/); // no "at fn (file:line:col)"
    expect(body.toLowerCase()).not.toContain('select ');
    expect(res.body).not.toHaveProperty('stack');
  });
});

describe('security response headers are present (section 20)', () => {
  it('sets a strict CSP and content-type-options and hides the framework', async () => {
    const res = await api(app).get('/api/v1/auth/me').set(auth(s.employee));
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // helmet strips the framework fingerprint.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('applies headers even to an error response', async () => {
    const res = await api(app).get('/api/v1/assets');
    expect(res.status).toBe(401);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
