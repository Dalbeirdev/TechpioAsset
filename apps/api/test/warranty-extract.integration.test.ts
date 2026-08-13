import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Warranty paste-and-extract (v2.16). The technician copies the manufacturer's
 * warranty page, the AI proposes the coverage end date, a human confirms. These
 * tests prove the guardrails: the AI gate actually blocks the call, the
 * permission model holds, and the mock provider's date-finding is deterministic
 * enough to exercise the flow end to end.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let assetId: string;

const SERIAL = 'WEXT-5CG1234ABC';
let savedConfig: { globallyEnabled: boolean; featureModes: unknown } | null = null;

async function setAiConfig(body: Record<string, unknown>) {
  const res = await api(app).patch('/api/v1/ai-config').set(auth(s.superAdmin)).send(body);
  expect(res.status).toBeLessThan(300);
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  // The routing provider prefers operator DB settings over env; an ai_settings
  // row left behind by manual console testing would reroute these calls away
  // from the mock. Park it for the duration and restore after.
  await prisma.client.$executeRawUnsafe(
    `UPDATE ai_settings SET id = 'parked-by-warranty-test' WHERE id = 'default'`,
  );

  const before = await api(app).get('/api/v1/ai-config').set(auth(s.superAdmin));
  savedConfig = {
    globallyEnabled: before.body.data.config.globallyEnabled,
    featureModes: before.body.data.config.featureModes,
  };

  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;
  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: `WEXT-${Math.random().toString(36).slice(2, 8)}`,
      name: 'HP Victus warranty test rig',
      brand: 'HP',
      model: 'Victus 16',
      serialNumber: SERIAL,
      categoryId,
      status: 'AVAILABLE',
    });
  assetId = created.body.data.id;
});

afterAll(async () => {
  if (savedConfig) {
    await setAiConfig({
      globallyEnabled: savedConfig.globallyEnabled,
      featureModes: savedConfig.featureModes,
    });
  }
  if (assetId) {
    await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', assetId);
  }
  await prisma.client.$executeRawUnsafe(
    `UPDATE ai_settings SET id = 'default' WHERE id = 'parked-by-warranty-test'`,
  );
  await app?.close();
});

describe('AI gate', () => {
  it('reports the feature off while AI is globally disabled, and the extract endpoint refuses', async () => {
    await setAiConfig({ globallyEnabled: false });

    const gate = await api(app)
      .get('/api/v1/ai-config/gate/WARRANTY_EXTRACTION')
      .set(auth(s.itAdmin));
    expect(gate.status).toBe(200);
    expect(gate.body.data.enabled).toBe(false);
    expect(gate.body.data.reason).toBe('GLOBALLY_DISABLED');

    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/warranty-extract`)
      .set(auth(s.itAdmin))
      .send({ text: `Warranty expiration date: 2027-09-30 for serial ${SERIAL}` });
    expect(res.status).toBe(409);
  });

  it('stays off for the feature until its mode is enabled', async () => {
    await setAiConfig({ globallyEnabled: true, featureModes: { WARRANTY_EXTRACTION: 'DISABLED' } });
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/warranty-extract`)
      .set(auth(s.itAdmin))
      .send({ text: `Warranty expiration date: 2027-09-30 for serial ${SERIAL}` });
    expect(res.status).toBe(409);
  });

  it('rejects unknown feature names on the gate endpoint', async () => {
    const res = await api(app)
      .get('/api/v1/ai-config/gate/NOT_A_FEATURE')
      .set(auth(s.itAdmin));
    expect(res.status).toBe(404);
  });
});

describe('extraction with the feature enabled', () => {
  beforeAll(async () => {
    await setAiConfig({
      globallyEnabled: true,
      featureModes: { WARRANTY_EXTRACTION: 'SUGGESTION_ONLY' },
    });
  });

  it('is closed to users without assets:update', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/warranty-extract`)
      .set(auth(s.employee))
      .send({ text: `Warranty expiration date: 2027-09-30 for serial ${SERIAL}` });
    expect(res.status).toBe(403);
  });

  it('proposes the date from pasted text and flags the serial as seen', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/warranty-extract`)
      .set(auth(s.itAdmin))
      .send({
        text:
          `HP support page for product Victus 16. Serial number: ${SERIAL}. ` +
          'Coverage type: Base warranty. Start date: 2024-10-01. ' +
          'Warranty expiration date: 2027-09-30.',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.warrantyEndDate).toBe('2027-09-30');
    expect(res.body.data.serialSeen).toBe(true);
    expect(res.body.data.simulated).toBe(true);
  });

  it('reads written-out dates and reports the latest one, noting an absent serial', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/warranty-extract`)
      .set(auth(s.itAdmin))
      .send({
        text:
          'Purchased on 12 January 2026. Standard warranty until June 30, 2027 ' +
          'according to the manufacturer support portal.',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.warrantyEndDate).toBe('2027-06-30');
    expect(res.body.data.serialSeen).toBe(false);
  });

  it('returns null (not a guess) when the text has no unambiguous date', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/warranty-extract`)
      .set(auth(s.itAdmin))
      .send({ text: 'Warranty status unknown. Purchased 30/06/2024 per the reseller invoice.' });
    expect(res.status).toBe(201);
    expect(res.body.data.warrantyEndDate).toBeNull();
  });

  it('records every extraction in the AI usage ledger', async () => {
    const rows = await prisma.client.aIUsageRecord.count({
      where: { feature: 'WARRANTY_EXTRACTION', entityId: assetId },
    });
    expect(rows).toBeGreaterThanOrEqual(3);
  });
});
