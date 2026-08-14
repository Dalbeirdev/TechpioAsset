import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.20 asset types & specifications: the seeded types are offered, the chosen
 * type's specification is stored, unknown keys never reach the column, and the
 * identity fields (MAC, IMEI) are unique per company however they are typed.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let itCategoryId: string;
let monitorTypeId: string;
let mobileTypeId: string;
const created: string[] = [];
const stamp = Math.random().toString(36).slice(2, 7).toUpperCase();

async function createAsset(body: Record<string, unknown>) {
  const res = await api(app).post('/api/v1/assets').set(auth(s.itAdmin)).send(body);
  if (res.status < 300) created.push(res.body.data.id as string);
  return res;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  const cats = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const it = cats.body.data.find((c: { key: string }) => c.key === 'it-assets');
  itCategoryId = it.id;
  monitorTypeId = it.subcategories.find((x: { key: string }) => x.key === 'monitor').id;
  mobileTypeId = it.subcategories.find((x: { key: string }) => x.key === 'mobile-phone').id;
});

afterAll(async () => {
  for (const id of created) {
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_condition_logs WHERE "assetId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', id);
  }
  await app?.close();
});

describe('the type catalogue', () => {
  it('offers the seeded types under IT Assets', async () => {
    const res = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
    const it = res.body.data.find((c: { key: string }) => c.key === 'it-assets');
    const keys = it.subcategories.map((x: { key: string }) => x.key);
    expect(keys).toEqual(
      expect.arrayContaining(['laptop', 'monitor', 'mobile-phone', 'keyboard', 'mouse', 'cable', 'projector']),
    );
  });
});

describe('specifications', () => {
  it('stores the chosen type’s fields and drops anything it did not declare', async () => {
    const res = await createAsset({
      assetTag: `TY-${stamp}-MON`,
      name: 'Samsung 24" Monitor',
      categoryId: itCategoryId,
      subcategoryId: monitorTypeId,
      brand: 'Samsung',
      serialNumber: `SN-${stamp}-MON`,
      specs: {
        screenSize: '24',
        resolution: '1920 x 1080 (FHD)',
        panel: 'IPS',
        // Not a monitor field, and not a field at all - both must be dropped.
        imei2: '123456789012345',
        somethingInvented: 'x',
      },
    });
    expect(res.status).toBe(201);

    const row = await prisma.client.asset.findUnique({
      where: { id: res.body.data.id as string },
      select: { specs: true },
    });
    expect(row?.specs).toEqual({ screenSize: '24', resolution: '1920 x 1080 (FHD)', panel: 'IPS' });
  });

  it('leaves specs null when the type declares none of the supplied keys', async () => {
    const res = await createAsset({
      assetTag: `TY-${stamp}-BARE`,
      name: 'Monitor without details',
      categoryId: itCategoryId,
      subcategoryId: monitorTypeId,
      specs: { notAField: 'ignored' },
    });
    expect(res.status).toBe(201);
    const row = await prisma.client.asset.findUnique({
      where: { id: res.body.data.id as string },
      select: { specs: true },
    });
    expect(row?.specs).toBeNull();
  });
});

describe('identity fields', () => {
  it('normalises a MAC address before storing it', async () => {
    const res = await createAsset({
      assetTag: `TY-${stamp}-L1`,
      name: 'Laptop with NIC',
      categoryId: itCategoryId,
      subcategoryId: monitorTypeId,
      macAddress: 'a4-bb-6d-1e-22-9f',
    });
    expect(res.status).toBe(201);
    const row = await prisma.client.asset.findUnique({
      where: { id: res.body.data.id as string },
      select: { macAddress: true },
    });
    expect(row?.macAddress).toBe('A4:BB:6D:1E:22:9F');
  });

  it('refuses the same MAC address however it is punctuated', async () => {
    const res = await createAsset({
      assetTag: `TY-${stamp}-L2`,
      name: 'Second laptop, same NIC',
      categoryId: itCategoryId,
      subcategoryId: monitorTypeId,
      macAddress: 'A4BB6D1E229F',
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain(`TY-${stamp}-L1`);
  });

  it('refuses a duplicate IMEI and accepts a different one', async () => {
    const first = await createAsset({
      assetTag: `TY-${stamp}-M1`,
      name: 'Company phone',
      categoryId: itCategoryId,
      subcategoryId: mobileTypeId,
      imei: '359874102345678',
    });
    expect(first.status).toBe(201);

    const dup = await createAsset({
      assetTag: `TY-${stamp}-M2`,
      name: 'Phone with a copied IMEI',
      categoryId: itCategoryId,
      subcategoryId: mobileTypeId,
      imei: '359874102345678',
    });
    expect(dup.status).toBe(409);

    const ok = await createAsset({
      assetTag: `TY-${stamp}-M3`,
      name: 'Another phone',
      categoryId: itCategoryId,
      subcategoryId: mobileTypeId,
      imei: '359874102345999',
    });
    expect(ok.status).toBe(201);
  });

  it('rejects a malformed MAC rather than silently discarding it', async () => {
    const res = await createAsset({
      assetTag: `TY-${stamp}-BAD`,
      name: 'Bad MAC',
      categoryId: itCategoryId,
      subcategoryId: monitorTypeId,
      macAddress: 'ZZ:ZZ:ZZ:ZZ:ZZ:ZZ',
    });
    expect(res.status).toBe(422);
  });

  it('lets two assets both leave the identity fields empty', async () => {
    for (const n of ['C1', 'C2']) {
      const res = await createAsset({
        assetTag: `TY-${stamp}-${n}`,
        name: `HDMI cable ${n}`,
        categoryId: itCategoryId,
      });
      expect(res.status).toBe(201);
    }
  });
});
