import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.26 - a tile and its own link must agree.
 *
 * #306 fixed one half of this: "Awaiting my approval" counted only steps with a
 * named approverId, so it read 0 for approvers with full inboxes. Auditing the
 * rest turned up the other half - the counts were right, but the links were
 * not. Several tiles counted a filtered subset and linked to an unfiltered
 * list: click "Open maintenance: 58" and land on all 174. The filters the tiles
 * needed (`open`, `warrantyWithinDays`) did not exist, and the pages ignored
 * the query string anyway.
 *
 * This walks each tile's own href and asserts the list behind it returns the
 * number on the tile - so a tile can never again point somewhere that
 * contradicts it.
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

/** The web route a tile links to, mapped onto the API list behind that page. */
const API_FOR: Record<string, (href: string) => string | null> = {
  '/my-assets': () => null, // needs the viewer's id; covered by its own case
  '/assets': (href) => `/api/v1/assets${href.slice('/assets'.length)}`,
  '/requests': (href) => `/api/v1/requests${href.slice('/requests'.length)}`,
  '/licenses': (href) => `/api/v1/licenses${href.slice('/licenses'.length)}`,
  '/maintenance': (href) => `/api/v1/maintenance${href.slice('/maintenance'.length)}`,
};

function apiPathFor(href: string): string | null {
  const base = '/' + href.slice(1).split(/[?/]/)[0];
  const map = API_FOR[base];
  return map ? map(href) : null;
}

const withPageSize = (path: string) =>
  path + (path.includes('?') ? '&' : '?') + 'pageSize=1';

describe('every tile links to what it counted', () => {
  // Roles chosen to light up different sets of tiles.
  for (const who of ['officeAdmin', 'finance', 'itAdmin', 'manager', 'employee'] as const) {
    it(`holds for ${who}`, async () => {
      const dash = await api(app).get('/api/v1/dashboard').set(auth(s[who]));
      expect(dash.status, JSON.stringify(dash.body)).toBeLessThan(300);
      const tiles = dash.body.data.tiles as { key: string; value: number; href: string }[];
      expect(tiles.length).toBeGreaterThan(0);

      for (const tile of tiles) {
        const path = apiPathFor(tile.href);
        if (!path) continue;

        const res = await api(app).get(withPageSize(path)).set(auth(s[who]));
        expect(res.status, `${tile.key} -> ${path}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
        const listed = res.body.meta.page.totalItems as number;
        expect(
          listed,
          `tile "${tile.label ?? tile.key}" says ${tile.value} but ${tile.href} shows ${listed}`,
        ).toBe(tile.value);
      }
    });
  }

  it('the my-assets tile matches the list its page loads', async () => {
    const dash = await api(app).get('/api/v1/dashboard').set(auth(s.employee));
    const tile = (dash.body.data.tiles as { key: string; value: number }[]).find(
      (t) => t.key === 'my-assets',
    )!;
    const res = await api(app)
      .get(`/api/v1/assets?assignedUserId=${s.employee.user.id}&pageSize=1`)
      .set(auth(s.employee));
    expect(res.body.meta.page.totalItems).toBe(tile.value);
  });
});

/**
 * The sweep above passes vacuously for licences on a database with none, which
 * is exactly the state that let the capacity tile stay wrong: it counted seat
 * POOLS while calling itself "Licenses near capacity" and linking to a licence
 * list, so one licence with three strained pools showed as three and its own
 * link could never agree with it.
 */
describe('the licence capacity tile counts licences, not pools', () => {
  let licenseId: string;

  beforeAll(async () => {
    const created = await api(app)
      .post('/api/v1/licenses')
      .set(auth(s.superAdmin))
      .send({
        name: `Capacity probe ${Math.random().toString(36).slice(2, 8)}`,
        family: 'PRODUCTIVITY_SUITE',
        subscriptionType: 'SUBSCRIPTION',
        purchaseDate: '2026-01-01',
        expiryDate: '2027-06-30',
        seatsPurchased: 100,
        unitOfAssignment: 'USER',
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    licenseId = created.body.data.id;

    // Two strained pools on ONE licence. The old tile counted pools, so this
    // shape is precisely what made it say 2 where the answer is 1. There is no
    // pool-creation endpoint, so they are seeded directly.
    const db = app.get(PrismaService).client;
    for (const name of ['Pool A', 'Pool B']) {
      await db.seatPool.create({
        data: {
          companyId: s.superAdmin.user.companyId,
          licenseId,
          name,
          seatsAllocated: 10,
          seatsReserved: 10,
        },
      });
    }
  });

  afterAll(async () => {
    // Shared database: a probe licence left behind would shift any later count.
    const db = app.get(PrismaService).client;
    await db.seatPool.deleteMany({ where: { licenseId } });
    await db.softwareLicense.deleteMany({ where: { id: licenseId } });
  });

  it('reports one licence, and its link returns that same licence', async () => {
    const dash = await api(app).get('/api/v1/dashboard').set(auth(s.superAdmin));
    const tile = (dash.body.data.tiles as { key: string; value: number; href: string }[]).find(
      (t) => t.key === 'licenses-at-capacity',
    )!;
    expect(tile).toBeTruthy();
    expect(tile.value, 'two strained pools on one licence is one licence').toBeGreaterThanOrEqual(1);
    expect(tile.href).toContain('nearCapacity=true');

    const listed = await api(app)
      .get('/api/v1/licenses?nearCapacity=true&pageSize=100')
      .set(auth(s.superAdmin));
    expect(listed.body.meta.page.totalItems).toBe(tile.value);
    expect((listed.body.data as { id: string }[]).some((l) => l.id === licenseId)).toBe(true);
  });
});
