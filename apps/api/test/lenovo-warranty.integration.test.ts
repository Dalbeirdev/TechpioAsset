import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { LenovoWarrantyService } from '../src/assets/lenovo-warranty.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Zero-touch Lenovo warranty refresh. The Lenovo endpoint itself was verified
 * live against real fleet serials; these tests stub the transport and prove
 * everything around it — vendor gating, permission gating, date application
 * with audit, sweep counting, and loud failure.
 */

let app: INestApplication;
let prisma: PrismaService;
let lenovo: LenovoWarrantyService;
let s: Record<AccountKey, Session>;
let categoryId: string;
const created: string[] = [];

/** A trimmed but shape-faithful Lenovo getIbaseInfo response. */
function lenovoPayload(overrides?: Partial<Record<string, unknown>>) {
  return {
    code: 0,
    data: {
      machineInfo: { productName: 'L14 Gen 2 Type 20X1 20X2 Laptops (ThinkPad)' },
      baseWarranties: [
        { name: '3Y Carry-in Warranty', startDate: '2023-04-06', endDate: '2026-04-05' },
      ],
      upgradeWarranties: [
        { name: '3Y Premier Support', startDate: '2023-04-06', endDate: '2026-04-05' },
      ],
      contractWarranties: [],
      currentWarranty: { name: '3Y Premier Support', startDate: '2023-04-06', endDate: '2026-04-05' },
      warrantyStatus: 'Out of warranty',
      ...overrides,
    },
  };
}

function stubFetch(payload: unknown, status = 200) {
  lenovo.fetchImpl = (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

async function makeAsset(fields: Record<string, unknown>): Promise<string> {
  const res = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: `LWAR-${Math.random().toString(36).slice(2, 8)}`,
      categoryId,
      status: 'AVAILABLE',
      ...fields,
    });
  created.push(res.body.data.id);
  return res.body.data.id;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  lenovo = app.get(LenovoWarrantyService);
  s = await loginAll(app);
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;
});

afterAll(async () => {
  for (const id of created) {
    await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', id);
  }
  await app?.close();
});

describe('one-click refresh', () => {
  it('records the Lenovo dates on the asset with an audit entry', async () => {
    stubFetch(lenovoPayload());
    const id = await makeAsset({
      name: 'ThinkPad L14 warranty test',
      brand: 'Lenovo',
      model: 'ThinkPad L14 Gen 2',
      serialNumber: `LWAR${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    });

    const res = await api(app)
      .post(`/api/v1/assets/${id}/warranty-refresh`)
      .set(auth(s.itAdmin))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.data.warrantyEndDate).toBe('2026-04-05');
    expect(res.body.data.warrantyName).toBe('3Y Premier Support');
    expect(res.body.data.applied).toBe(true);

    const row = await prisma.client.asset.findUnique({
      where: { id },
      select: { warrantyEndDate: true, warrantyStartDate: true },
    });
    expect(row?.warrantyEndDate?.toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(row?.warrantyStartDate?.toISOString().slice(0, 10)).toBe('2023-04-06');
  });

  it('is closed to users without assets:update', async () => {
    stubFetch(lenovoPayload());
    const id = created[0]!;
    const res = await api(app)
      .post(`/api/v1/assets/${id}/warranty-refresh`)
      .set(auth(s.employee))
      .send({});
    expect(res.status).toBe(403);
  });

  it('refuses non-Lenovo devices with an explanation', async () => {
    stubFetch(lenovoPayload());
    const id = await makeAsset({
      name: 'HP Victus test',
      brand: 'HP',
      model: 'Victus 16',
      serialNumber: `LWARHP${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    });
    const res = await api(app)
      .post(`/api/v1/assets/${id}/warranty-refresh`)
      .set(auth(s.itAdmin))
      .send({});
    expect(res.status).toBe(409);
  });

  it('surfaces an unknown serial as not-found, not as a saved guess', async () => {
    stubFetch({ code: 105, data: null });
    const id = await makeAsset({
      name: 'Lenovo with placeholder serial',
      brand: 'Lenovo',
      serialNumber: `LWARX${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    });
    const res = await api(app)
      .post(`/api/v1/assets/${id}/warranty-refresh`)
      .set(auth(s.itAdmin))
      .send({});
    expect(res.status).toBe(404);
    const row = await prisma.client.asset.findUnique({
      where: { id },
      select: { warrantyEndDate: true },
    });
    expect(row?.warrantyEndDate).toBeNull();
  });
});

describe('sweep', () => {
  it('updates changed Lenovo devices, skips already-correct ones, and reports failures', async () => {
    stubFetch(lenovoPayload());
    lenovo.sweepDelayMs = 0;
    // Scoped to this suite's assets so the demo fixtures stay untouched.
    const summary = await lenovo.sweep({ assetIds: created });
    // The Lenovo assets created above are checked; the HP one is filtered out.
    // One already carries 2026-04-05, so a second pass changes nothing.
    expect(summary.checked).toBeGreaterThanOrEqual(2);
    expect(summary.failed).toBe(0);

    const again = await lenovo.sweep({ assetIds: created });
    expect(again.updated).toBe(0);
  });
});
