import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Changing what identifies a device has to leave a trace (v2.40).
 *
 * `AUDITED_FIELDS` listed serialNumber but not brand, model, imei, macAddress
 * or specs, and `recordChange` returns early when none of the listed fields
 * moved. So fifteen brand corrections were applied to production and left no
 * audit entry whatsoever, and an IMEI written to a phone the day before was
 * recorded only because the serial number happened to change in the same call.
 *
 * On a register whose purpose is saying which device is which - and which gets
 * produced as evidence when one goes missing - the numbers that identify a
 * phone must be as traceable as the number that identifies a laptop.
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

/** The newest audit entry for one asset, as the trail reports it. */
async function latestEntry(assetId: string) {
  const res = await api(app)
    .get(`/api/v1/audit?entityType=Asset&entityId=${assetId}&pageSize=1`)
    .set(auth(s.superAdmin));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data[0];
}

async function anAsset() {
  const res = await api(app).get('/api/v1/assets?pageSize=1').set(auth(s.superAdmin));
  const asset = res.body.data[0];
  expect(asset, 'the seed should provide at least one asset').toBeTruthy();
  return asset;
}

describe('identifier changes are recorded', () => {
  it('records a brand correction', async () => {
    const asset = await anAsset();
    const brand = `Brand-${Date.now()}`;

    const patch = await api(app)
      .patch(`/api/v1/assets/${asset.id}`)
      .set(auth(s.superAdmin))
      .send({ brand });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    const entry = await latestEntry(asset.id);
    expect(entry.action).toBe('ASSET_UPDATED');
    expect(entry.newValues.brand).toBe(brand);
    // The previous value matters as much as the new one: an audit trail that
    // says only what a field became cannot show what was overwritten.
    expect(entry.previousValues).toHaveProperty('brand');
  });

  it('records an IMEI change, which used to be silent', async () => {
    const asset = await anAsset();
    const imei = String(Date.now()).padStart(15, '3').slice(0, 15);

    const patch = await api(app)
      .patch(`/api/v1/assets/${asset.id}`)
      .set(auth(s.superAdmin))
      .send({ imei });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    const entry = await latestEntry(asset.id);
    expect(entry.newValues.imei).toBe(imei);
  });

  it('records a MAC address change', async () => {
    const asset = await anAsset();
    const mac = 'AC:D6:18:76:CD:B2'.replace(/B2$/, String(Date.now() % 90 + 10));

    const patch = await api(app)
      .patch(`/api/v1/assets/${asset.id}`)
      .set(auth(s.superAdmin))
      .send({ macAddress: mac });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    const entry = await latestEntry(asset.id);
    expect(String(entry.newValues.macAddress).toUpperCase()).toBe(mac.toUpperCase());
  });

  it('still writes nothing when nothing actually changed', async () => {
    // The early return is deliberate and worth keeping: re-saving an unchanged
    // asset should not fill the trail with entries that record no change.
    const asset = await anAsset();
    await api(app).patch(`/api/v1/assets/${asset.id}`).set(auth(s.superAdmin)).send({ brand: 'Stable Co' });
    const before = await latestEntry(asset.id);

    await api(app).patch(`/api/v1/assets/${asset.id}`).set(auth(s.superAdmin)).send({ brand: 'Stable Co' });
    const after = await latestEntry(asset.id);

    expect(after.id).toBe(before.id);
  });
});
