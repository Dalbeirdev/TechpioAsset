import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.8 S5 — the noisy-neighbour proof.
 *
 * The global bucket was fine with one tenant. Now that tenants are
 * provisioned, one of them exhausting the limit must NOT take the others down
 * with it. This suite saturates one tenant deliberately and then asks another
 * to do ordinary work.
 *
 * Runs with a small RATE_LIMIT_MAX (see vitest.throttle.config.ts) because
 * proving the boundary needs to actually reach it.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let tenantId: string;
let neighbourToken: string;

const run = Date.now() % 1_000_000;
const NEIGHBOUR = `neighbour-${run}@quiet-tenant.test`;
/** Comfortably above the configured limit for this lane. */
const FLOOD = 40;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);

  const created = await api(app)
    .post('/api/v1/platform/tenants')
    .set(auth(s.superAdmin))
    .send({
      name: `Quiet Tenant ${run}`,
      adminEmail: NEIGHBOUR,
      adminFirstName: 'Quiet',
      adminLastName: 'Neighbour',
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  tenantId = created.body.data.id;

  const login = await api(app)
    .post('/api/v1/auth/login')
    .send({ email: NEIGHBOUR, password: created.body.data.admin.initialPassword });
  expect(login.status).toBe(200);
  neighbourToken = login.body.data.accessToken;
}, 120_000);

afterAll(async () => {
  if (tenantId) await prisma.client.company.delete({ where: { id: tenantId } }).catch(() => undefined);
  await app?.close();
});

describe('one tenant cannot exhaust another tenant’s limit', () => {
  it('saturates tenant A, then tenant B still works', async () => {
    // Tenant A hammers a cheap authenticated endpoint until it is throttled.
    let throttled = 0;
    for (let i = 0; i < FLOOD; i++) {
      const res = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
      if (res.status === 429) throttled += 1;
    }
    expect(throttled).toBeGreaterThan(0); // A really did hit its ceiling

    // B, a different tenant, is unaffected - this is the whole point.
    const neighbour = await api(app)
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${neighbourToken}`);
    expect(neighbour.status, JSON.stringify(neighbour.body)).toBe(200);
  }, 120_000);

  it('a forged tenant claim cannot drain a real tenant’s bucket', async () => {
    // The attack this design closes: bucketing on an UNVERIFIED companyId
    // would let anyone spend someone else's allowance. A tampered token is
    // not a tenant, so it falls back to the IP bucket instead.
    const [header, payload, signature] = neighbourToken.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    claims.companyId = s.superAdmin.user.companyId; // claim to be the other tenant
    const forged = [
      header,
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      signature,
    ].join('.');

    const res = await api(app).get('/api/v1/categories').set('Authorization', `Bearer ${forged}`);
    // Rejected as authentication, never honoured as a tenant identity.
    expect([401, 429]).toContain(res.status);
  });
});
