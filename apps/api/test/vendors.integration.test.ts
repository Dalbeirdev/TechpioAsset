import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Vendor management (v2.40).
 *
 * `vendors:manage` was granted to Finance and Procurement Manager and enforced
 * by nothing: no endpoint used it, no screen existed, and the only vendor a
 * company ever had was the "Unknown vendor" placeholder that an uploaded bill
 * falls back to. A purchase order could therefore only ever name a vendor
 * nobody chose.
 *
 * These pin the two things worth getting right: who may write, and that a
 * vendor with history cannot be removed from under it.
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

const unique = (prefix: string) => `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function createVendor(as: Session, over: Record<string, unknown> = {}) {
  return api(app)
    .post('/api/v1/vendors')
    .set(auth(as))
    .send({ code: unique('V').slice(0, 20), name: 'Sharma Computer Systems', ...over });
}

describe('who may manage vendors', () => {
  it('lets Finance add one', async () => {
    const res = await createVendor(s.finance);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.name).toBe('Sharma Computer Systems');
    expect(res.body.data.isActive).toBe(true);
  });

  it('refuses an employee, who may not manage vendors', async () => {
    const res = await createVendor(s.employee);
    expect(res.status).toBe(403);
  });

  it('refuses an auditor, who may read them but not change them', async () => {
    // The distinction the permission exists for: read access is not write access.
    const read = await api(app).get('/api/v1/vendors').set(auth(s.auditor));
    expect(read.status).toBe(200);

    const write = await createVendor(s.auditor);
    expect(write.status).toBe(403);
  });
});

describe('adding and editing a vendor', () => {
  it('uppercases the code and rejects a duplicate', async () => {
    const code = unique('dup').slice(0, 12);
    const first = await createVendor(s.finance, { code });
    expect(first.status).toBe(201);
    expect(first.body.data.code).toBe(code.toUpperCase());

    const second = await createVendor(s.finance, { code: code.toLowerCase() });
    expect(second.status).toBe(409);
  });

  it('keeps the optional details it is given', async () => {
    // A vendor is often created mid-purchase with only a name; the details are
    // optional for that reason, but must survive when supplied.
    const res = await createVendor(s.finance, {
      contactName: 'Ramesh Sharma',
      contactEmail: 'accounts@example.com',
      taxId: '03AABCN1234K1ZQ',
      city: 'Mohali',
    });
    expect(res.body.data.contactName).toBe('Ramesh Sharma');
    expect(res.body.data.taxId).toBe('03AABCN1234K1ZQ');
  });

  it('deactivates without deleting, and drops it from the picker', async () => {
    const created = await createVendor(s.finance, { name: 'Retired Supplies Co' });
    const id = created.body.data.id;

    const patched = await api(app)
      .patch(`/api/v1/vendors/${id}`)
      .set(auth(s.finance))
      .send({ isActive: false });
    expect(patched.status).toBe(200);
    expect(patched.body.data.isActive).toBe(false);

    // Gone from the picker...
    const picker = await api(app).get('/api/v1/vendors').set(auth(s.finance));
    expect(picker.body.data.some((v: { id: string }) => v.id === id)).toBe(false);

    // ...but still on the management page, so it can be brought back.
    const manage = await api(app).get('/api/v1/vendors/manage').set(auth(s.finance));
    expect(manage.body.data.some((v: { id: string }) => v.id === id)).toBe(true);
  });

  it('404s on a vendor that does not exist rather than leaking that fact', async () => {
    const res = await api(app)
      .patch('/api/v1/vendors/does-not-exist')
      .set(auth(s.finance))
      .send({ name: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('deleting a vendor', () => {
  it('removes one that has no history', async () => {
    const created = await createVendor(s.finance, { name: 'Never Used Ltd' });
    const id = created.body.data.id;

    const res = await api(app).delete(`/api/v1/vendors/${id}`).set(auth(s.finance));
    expect(res.status).toBe(200);

    const manage = await api(app).get('/api/v1/vendors/manage').set(auth(s.finance));
    expect(manage.body.data.some((v: { id: string }) => v.id === id)).toBe(false);
  });

  it('refuses to delete one an invoice points at, and says to deactivate instead', async () => {
    // The record of who was paid must not end up attributed to nobody.
    const list = await api(app).get('/api/v1/vendors').set(auth(s.finance));
    const inUse = list.body.data[0];
    expect(inUse, 'the seed should leave at least one vendor with history').toBeTruthy();

    const res = await api(app).delete(`/api/v1/vendors/${inUse.id}`).set(auth(s.finance));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/deactivate/i);
  });
});
