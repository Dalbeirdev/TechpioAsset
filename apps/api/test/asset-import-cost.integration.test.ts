import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Cost on the asset import (v2.29).
 *
 * The import updates in place - a corrected sheet is meant to be re-uploaded -
 * so it is the one place a price can be written repeatedly without anyone
 * typing into the priced field. That makes it the obvious way around the two
 * rules the Assets service enforces, and these tests exist to prove it is not:
 *
 *   1. only a cost-visible role may set a price at all;
 *   2. a price already recorded is write-once, correctable only by a Super Admin.
 *
 * Two actors carry most of the weight. IT Admin holds assets:import and
 * deliberately NOT assets:cost:read - the combination that would otherwise let
 * a spreadsheet price the estate. Finance holds both (v2.30) but cannot correct
 * a recorded price, which makes them the caller the write-once rule is really
 * for: they are the role most likely to re-upload a sheet after fixing a figure.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;

/** Serials created here, removed in afterAll so re-runs start clean. */
const serials: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
});

afterAll(async () => {
  for (const serial of serials) {
    await prisma.client.$executeRawUnsafe(
      'DELETE FROM audit_logs WHERE "entityId" IN (SELECT id FROM assets WHERE "serialNumber" = $1)',
      serial,
    );
    await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE "serialNumber" = $1', serial);
  }
  await app?.close();
});

/** A one-row workbook, in the shape the importer reads. */
async function sheet(serial: string, cost?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Assets');
  const headers = ['Asset Id', 'Asset Name', 'Asset Category', 'Asset Type'];
  const values: (string | undefined)[] = [serial, 'Imported laptop', 'IT Assets', 'Laptop'];
  if (cost !== undefined) {
    headers.push('Purchase Cost');
    values.push(cost);
  }
  ws.addRow(headers);
  ws.addRow(values);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function upload(who: AccountKey, serial: string, cost?: string) {
  const file = await sheet(serial, cost);
  return api(app)
    .post('/api/v1/assets/import')
    .set(auth(s[who]))
    .attach('file', file, 'assets.xlsx');
}

async function costOf(serial: string): Promise<string | null> {
  const asset = await prisma.client.asset.findFirst({
    where: { serialNumber: serial },
    select: { purchaseCost: true },
  });
  return asset?.purchaseCost ? asset.purchaseCost.toString() : null;
}

function unique(tag: string): string {
  const serial = `IMPCOST-${tag}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  serials.push(serial);
  return serial;
}

describe('cost on the asset import', () => {
  /**
   * Who can do what, as of v2.30:
   *
   *   SUPER_ADMIN   import yes   cost yes    sets prices, and may correct one
   *   FINANCE       import yes   cost yes    sets prices, cannot correct one
   *   IT_ADMIN      import yes   cost no     imports; prices are dropped
   *   OFFICE_ADMIN  import no    cost no     no upload at all
   *
   * Finance gained the import right deliberately: they own pricing, and before
   * it the only account that could import costs was the Super Admin, because
   * import and cost-visibility met in no other role.
   */
  it('records a price when the importer may both import and price', async () => {
    const serial = unique('OK');
    const res = await upload('superAdmin', serial, '68,000');

    expect(res.status).toBeLessThan(300);
    expect(res.body.data.pricesSet).toBe(1);
    expect(await costOf(serial)).toBe('68000');
  });

  it('lets Finance import prices, which is the point of giving them the right', async () => {
    const serial = unique('FIN');
    const res = await upload('finance', serial, '68000');

    expect(res.status).toBeLessThan(300);
    expect(res.body.data.pricesSet).toBe(1);
    expect(await costOf(serial)).toBe('68000');
  });

  it('still refuses the upload to a role holding no import right', async () => {
    // Office Admin holds neither, and remains turned away at the endpoint.
    const res = await upload('officeAdmin', unique('OFF'), '68000');
    expect(res.status).toBe(403);
  });

  it('imports everything else but drops the price for a role that may not price', async () => {
    const serial = unique('IGN');
    const res = await upload('itAdmin', serial, '68000');

    // The upload is NOT refused. An IT Admin importing an inventory sheet that
    // happens to carry a cost column should still get their assets.
    expect(res.status).toBeLessThan(300);
    expect(res.body.data.assetsCreated).toBe(1);
    // But the money did not land, and the summary says so rather than leaving
    // it to be discovered as a missing number weeks later.
    expect(res.body.data.pricesSet).toBe(0);
    expect(res.body.data.pricesIgnored).toBe(1);
    expect(await costOf(serial)).toBeNull();
  });

  /**
   * The write-once rule, now reachable through the endpoint.
   *
   * Until Finance held the import right this branch could not be exercised over
   * HTTP at all - the only importer who could price was a Super Admin, and a
   * Super Admin is precisely who IS allowed to correct. Giving Finance import
   * is what makes "a pricer who may not correct" a real caller, and it is the
   * case that matters: Finance is the role most likely to re-upload a sheet
   * after fixing a figure in it.
   */
  it('will not let Finance overwrite a price already recorded', async () => {
    const serial = unique('LOCK');
    await upload('finance', serial, '68000');
    expect(await costOf(serial)).toBe('68000');

    const second = await upload('finance', serial, '99999');
    expect(second.status).toBeLessThan(300);
    expect(second.body.data.pricesLocked).toBe(1);
    expect(second.body.data.pricesSet).toBe(0);
    // The correction did not take. Prices are entered once.
    expect(await costOf(serial)).toBe('68000');
  });

  it('lets a Super Admin correct a price, which is the sanctioned route', async () => {
    const serial = unique('FIX');
    await upload('superAdmin', serial, '68000');

    const corrected = await upload('superAdmin', serial, '72500');
    expect(corrected.body.data.pricesSet).toBe(1);
    expect(await costOf(serial)).toBe('72500');
  });

  it('does not erase a recorded price when a later sheet omits the column', async () => {
    const serial = unique('KEEP');
    await upload('superAdmin', serial, '68000');

    // A sheet with no cost column at all must leave the price alone. Writing
    // null here would clear prices on every ordinary re-import.
    const withoutCost = await upload('superAdmin', serial);
    expect(withoutCost.status).toBeLessThan(300);
    expect(await costOf(serial)).toBe('68000');
  });

  it('leaves an audit row naming the import as the source of the price', async () => {
    const serial = unique('AUD');
    await upload('superAdmin', serial, '68000');

    const asset = await prisma.client.asset.findFirst({
      where: { serialNumber: serial },
      select: { id: true },
    });
    const entries = await prisma.client.auditLog.findMany({
      where: { entityId: asset?.id, action: 'ASSET_COST_CHANGED' },
    });
    // "Where did this asset's price come from" is the question asked of a money
    // field, and the bulk import summary cannot answer it.
    expect(entries.length).toBe(1);
    expect(JSON.stringify(entries[0]?.newValues)).toContain('import');
  });
});
