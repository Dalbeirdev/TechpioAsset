import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Dynamic request form backend (v2.17): the requester-scoped asset list, the
 * DB-driven equipment catalog, target-asset ownership enforcement and details
 * persistence. Ownership is the security-relevant part - the form filters,
 * but only the API check makes it a rule.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let categoryId: string;
let myAssetId: string;
let othersAssetId: string;
const created: string[] = [];
const requests: string[] = [];

async function makeAsset(holder: 'employee' | 'employee2', tag: string): Promise<string> {
  const create = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: tag,
      name: `AAA Dyn ThinkPad ${tag}`,
      brand: 'Lenovo',
      model: 'ThinkPad T14',
      categoryId,
      status: 'AVAILABLE',
    });
  const id = create.body.data.id as string;
  created.push(id);
  const assign = await api(app)
    .post(`/api/v1/assets/${id}/assign`)
    .set(auth(s.itAdmin))
    .send({ userId: s[holder].user.id });
  if (assign.status >= 300) throw new Error(`assign failed: ${assign.status} ${JSON.stringify(assign.body)}`);
  return id;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  myAssetId = await makeAsset('employee', `DYNQ-${suffix}A`);
  othersAssetId = await makeAsset('employee2', `DYNQ-${suffix}B`);
});

afterAll(async () => {
  for (const id of requests) {
    await prisma.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM request_approvals WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', id);
  }
  for (const id of created) {
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_assignments WHERE "assetId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', id);
  }
  await app?.close();
});

describe('GET /requests/eligible-assets', () => {
  it('returns only the callers own assigned assets, without cost fields', async () => {
    const res = await api(app).get('/api/v1/requests/eligible-assets').set(auth(s.employee));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a: { id: string }) => a.id);
    expect(ids).toContain(myAssetId);
    expect(ids).not.toContain(othersAssetId);
    const mine = res.body.data.find((a: { id: string }) => a.id === myAssetId);
    expect(mine.purchaseCost).toBeUndefined();
    expect(mine.assetTag).toBeDefined();
  });
});

describe('GET /requests/catalog', () => {
  it('merges the baseline with company asset names, grouped', async () => {
    const res = await api(app).get('/api/v1/requests/catalog').set(auth(s.employee));
    expect(res.status).toBe(200);
    const allItems = res.body.data.groups.flatMap((g: { items: string[] }) => g.items);
    expect(allItems).toContain('HDMI Cable');
    expect(allItems.some((n: string) => n.startsWith('AAA Dyn ThinkPad'))).toBe(true);
    expect(res.body.data.categories.length).toBeGreaterThan(0);
  });
});

describe('POST /requests with details', () => {
  it('rejects a target asset assigned to someone else', async () => {
    const res = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'UPGRADE',
        priority: 'NORMAL',
        businessReason: 'My machine is too slow for the current workload.',
        details: { targetAssetId: othersAssetId, upgradeType: 'RAM', requestedSpec: '32 GB' },
        items: [{ description: 'RAM upgrade to 32 GB', quantity: 1 }],
      });
    expect(res.status).toBe(422);
  });

  it('accepts the callers own asset and persists the structured details', async () => {
    const res = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'UPGRADE',
        priority: 'NORMAL',
        businessReason: 'Compiles exhaust memory daily; more RAM needed.',
        preferredSpec: 'RAM upgrade · current: 16 GB · requested: 32 GB',
        details: {
          targetAssetId: myAssetId,
          upgradeType: 'RAM',
          currentSpec: '16 GB',
          requestedSpec: '32 GB',
        },
        items: [{ description: 'RAM upgrade to 32 GB', quantity: 1 }],
      });
    expect(res.status).toBe(201);
    requests.push(res.body.data.id);

    const detail = await api(app)
      .get(`/api/v1/requests/${res.body.data.id}`)
      .set(auth(s.employee));
    expect(detail.status).toBe(200);
    expect(detail.body.data.details.upgradeType).toBe('RAM');
    expect(detail.body.data.details.requestedSpec).toBe('32 GB');
    expect(detail.body.data.aboutAsset.id).toBe(myAssetId);
  });

  it('admin with assets:read may reference an asset held by someone else', async () => {
    const res = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.itAdmin))
      .send({
        type: 'REPAIR',
        priority: 'NORMAL',
        businessReason: 'Raised by IT on behalf of the holder after inspection.',
        details: { targetAssetId: othersAssetId },
        items: [{ description: 'Keyboard repair', quantity: 1 }],
      });
    expect(res.status).toBe(201);
    requests.push(res.body.data.id);
  });
});

describe('uncatalogued items + catalog promotion', () => {
  const customName = `USB-C to HDMI Adapter ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  it('stores an uncatalogued item with its metadata on the request', async () => {
    const res = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        priority: 'NORMAL',
        businessReason: 'Need to present from my laptop to the meeting-room TV.',
        items: [
          {
            description: customName,
            quantity: 2,
            isUncatalogued: true,
            manufacturer: 'Anker',
            model: 'A8312',
            referenceUrl: 'https://example.com/a8312',
            preferredSpec: '4K60 support required',
          },
        ],
      });
    expect(res.status).toBe(201);
    requests.push(res.body.data.id);

    const detail = await api(app).get(`/api/v1/requests/${res.body.data.id}`).set(auth(s.employee));
    const item = detail.body.data.items[0];
    expect(item.isUncatalogued).toBe(true);
    expect(item.manufacturer).toBe('Anker');
    expect(item.model).toBe('A8312');
    expect(item.referenceUrl).toBe('https://example.com/a8312');
  });

  it('employee may not promote items into the catalog', async () => {
    const res = await api(app)
      .post('/api/v1/requests/catalog-items')
      .set(auth(s.employee))
      .send({ name: customName });
    expect(res.status).toBe(403);
  });

  it('admin promotes the item; it appears in the catalog; duplicates are refused', async () => {
    const res = await api(app)
      .post('/api/v1/requests/catalog-items')
      .set(auth(s.itAdmin))
      .send({ name: customName });
    expect(res.status).toBe(201);
    const catalogItemId = res.body.data.id as string;

    const cat = await api(app).get('/api/v1/requests/catalog').set(auth(s.employee));
    const all = cat.body.data.groups.flatMap((g: { items: string[] }) => g.items);
    expect(all).toContain(customName);

    const dup = await api(app)
      .post('/api/v1/requests/catalog-items')
      .set(auth(s.itAdmin))
      .send({ name: customName.toLowerCase() });
    expect(dup.status).toBe(409);

    await prisma.client.$executeRawUnsafe('DELETE FROM catalog_items WHERE id = $1', catalogItemId);
  });
});
