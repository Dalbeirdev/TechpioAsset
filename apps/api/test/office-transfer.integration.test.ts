import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 2d: office transfers, and the work order a damage ticket becomes.
 *
 * AssetTransfer and IN_TRANSIT existed from v1 and no code path ever reached
 * either: an office move was a silent officeId edit, never "between" anywhere -
 * which is precisely where equipment goes missing. And an approved DAMAGE
 * ticket was where the trail ended; the repair, if it happened, was a separate
 * record nobody connected to it.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let officeA: string;
let officeB: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);

  const offices = await api(app).get('/api/v1/offices').set(auth(s.superAdmin));
  expect(offices.status).toBe(200);
  const rows = offices.body.data as { id: string; name: string }[];
  officeA = rows[0].id;
  // A second office to transfer to; create it if the seed has only one.
  if (rows.length > 1) {
    officeB = rows[1].id;
  } else {
    const created = await api(app)
      .post('/api/v1/offices')
      .set(auth(s.superAdmin))
      .send({ name: `Transfer Test Office ${Date.now()}`, code: `XFR${Date.now() % 100000}` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    officeB = created.body.data.id;
  }
});

afterAll(async () => {
  // Each run assigns a pile of test laptops to the shared employee account.
  // Left behind, they accumulate until every scope-comparison test in the
  // suite saturates its page cap and starts failing for reasons that have
  // nothing to do with the code under test. Raw SQL so the soft-delete
  // middleware does not turn this into more residue.
  await app
    .get(PrismaService)
    .client.$executeRawUnsafe(`DELETE FROM assets WHERE "assetTag" LIKE 'XFER-%'`);
  await app?.close();
});

const uniq = () => `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 900 + 100)}`;

async function freshAsset(suffix: string) {
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const itCategory = categories.body.data.find((c: { key: string }) => c.key === 'it-assets');
  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: `XFER-${suffix}`,
      name: `Transfer test laptop ${suffix}`,
      categoryId: itCategory.id,
      serialNumber: `XFERSN-${suffix}`,
      status: 'AVAILABLE',
      officeId: officeA,
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.data as { id: string; assetTag: string };
}

describe('POST /assets/:id/transfer + /transfer/receive', () => {
  it('dispatch puts the asset IN_TRANSIT and keeps it at the origin office', async () => {
    const asset = await freshAsset(uniq());

    const sent = await api(app)
      .post(`/api/v1/assets/${asset.id}/transfer`)
      .set(auth(s.itAdmin))
      .send({ toOfficeId: officeB, reason: 'Rebalancing stock' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);

    const after = sent.body.data;
    expect(after.status).toBe('IN_TRANSIT');
    // Still the origin's asset: it has not arrived anywhere yet.
    expect(after.office.id).toBe(officeA);
    expect(after.transfers).toHaveLength(1);
    expect(after.transfers[0].toOffice.id).toBe(officeB);
  });

  it('receive closes the transfer, moves the office and clears the room', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/transfer`)
      .set(auth(s.itAdmin))
      .send({ toOfficeId: officeB });

    const received = await api(app)
      .post(`/api/v1/assets/${asset.id}/transfer/receive`)
      .set(auth(s.itAdmin))
      .send({ resultingStatus: 'IN_STORAGE' });
    expect(received.status, JSON.stringify(received.body)).toBe(201);

    const after = received.body.data;
    expect(after.status).toBe('IN_STORAGE');
    expect(after.office.id).toBe(officeB);
    expect(after.transfers).toHaveLength(0);

    const row = await prisma.client.assetTransfer.findFirstOrThrow({
      where: { assetId: asset.id },
    });
    expect(row.receivedAt).not.toBeNull();
    expect(row.receivedById).toBe(s.itAdmin.user.id);
  });

  it('refuses to dispatch an assigned asset', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/transfer`)
      .set(auth(s.itAdmin))
      .send({ toOfficeId: officeB });
    expect(res.status).toBe(422);
  });

  it('refuses a transfer to the office it is already at', async () => {
    const asset = await freshAsset(uniq());
    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/transfer`)
      .set(auth(s.itAdmin))
      .send({ toOfficeId: officeA });
    expect(res.status).toBe(422);
  });

  it('refuses to receive an asset with no open transfer', async () => {
    const asset = await freshAsset(uniq());
    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/transfer/receive`)
      .set(auth(s.itAdmin))
      .send({});
    expect(res.status).toBe(422);
  });

  it('audits both halves as ASSET_TRANSFERRED', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/transfer`)
      .set(auth(s.itAdmin))
      .send({ toOfficeId: officeB });
    await api(app)
      .post(`/api/v1/assets/${asset.id}/transfer/receive`)
      .set(auth(s.itAdmin))
      .send({});

    const audit = await api(app)
      .get(`/api/v1/audit?entityId=${asset.id}&pageSize=50`)
      .set(auth(s.superAdmin));
    const transfers = audit.body.data.filter(
      (e: { action: string }) => e.action === 'ASSET_TRANSFERRED',
    );
    expect(transfers.length).toBeGreaterThanOrEqual(2);
  });

  it('is denied without assets:transfer', async () => {
    const asset = await freshAsset(uniq());
    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/transfer`)
      .set(auth(s.employee))
      .send({ toOfficeId: officeB });
    expect(res.status).toBe(403);
  });
});

describe('approved DAMAGE/REPAIR requests raise a linked work order', () => {
  /** Files a DAMAGE request about a device the employee holds, then approves it. */
  async function fileAndApprove(assetId: string) {
    const filed = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'DAMAGE',
        businessReason: 'Screen cracked after the laptop was dropped in the office',
        isReplacement: false,
        replacesAssetId: assetId,
        items: [{ description: 'Repair cracked screen', quantity: 1 }],
      });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    const requestId = filed.body.data.id as string;

    const submitted = await api(app)
      .post(`/api/v1/requests/${requestId}/submit`)
      .set(auth(s.employee));
    expect([200, 201]).toContain(submitted.status);

    // Walk every pending step. Approval is strict about WHO decides (the
    // can-decide rules), so try each plausible approver and move on with
    // whichever the step accepts.
    //
    // v2.27 - two kinds of step now, and only one of them is approved. Damage
    // takes its own route, which asks about stock before anything is bought, and
    // an assessment stage is cleared by recording an answer. Approving one is
    // refused, so the loop would spin on a stage it could never clear. For a
    // repair on kit we already own the honest answer is that nothing is being
    // bought, which also stands the costing and Finance steps aside.
    for (let step = 0; step < 8; step += 1) {
      const detail = await api(app).get(`/api/v1/requests/${requestId}`).set(auth(s.superAdmin));
      const status = detail.body.data.status as string;
      if (!status.includes('PENDING')) break; // e.g. MANAGER_APPROVAL_PENDING

      const current = (
        detail.body.data.approvals as { decision: string; kind: string }[]
      ).find((a) => a.decision === 'PENDING');

      if (current && current.kind !== 'APPROVAL') {
        const answered = await api(app)
          .patch(`/api/v1/requests/${requestId}/assessment`)
          .set(auth(s.officeAdmin))
          .send({ purchaseRequired: false });
        expect(answered.status, `could not answer ${current.kind}`).toBeLessThan(300);
        continue;
      }

      let decidedBy: string | null = null;
      for (const approver of [s.manager, s.itAdmin, s.hr, s.finance, s.officeAdmin, s.superAdmin]) {
        const decided = await api(app)
          .post(`/api/v1/requests/${requestId}/decision`)
          .set(auth(approver))
          .send({ decision: 'APPROVED' });
        if ([200, 201].includes(decided.status)) {
          decidedBy = approver.user.email;
          break;
        }
      }
      expect(decidedBy, `no account could decide step at ${status}`).not.toBeNull();
    }
    return requestId;
  }

  it('creates one work order on the named device, linked to the request', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const requestId = await fileAndApprove(asset.id);

    const workOrder = await prisma.client.maintenanceRecord.findUnique({
      where: { requestId },
    });
    expect(workOrder, 'approval should have raised a work order').not.toBeNull();
    expect(workOrder?.assetId).toBe(asset.id);
    expect(workOrder?.type).toBe('REPAIR');
    expect(workOrder?.status).toBe('REQUESTED');

    // And the ticket page can see it.
    const detail = await api(app).get(`/api/v1/requests/${requestId}`).set(auth(s.superAdmin));
    expect(detail.body.data.workOrder?.id).toBe(workOrder?.id);
  });

  it('does not raise one for a damage ticket that names no asset', async () => {
    const filed = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'DAMAGE',
        businessReason: 'Meeting room chair armrest snapped off completely',
        isReplacement: false,
        // Unique per run: the duplicate-request guard blocks an identical open
        // item from the same requester, and leftover fixtures stay open.
        items: [
          { description: `Replace broken chair ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 },
        ],
      });
    expect(filed.status).toBe(201);
    const requestId = filed.body.data.id as string;
    await api(app).post(`/api/v1/requests/${requestId}/submit`).set(auth(s.employee));

    for (let step = 0; step < 6; step += 1) {
      const detail = await api(app).get(`/api/v1/requests/${requestId}`).set(auth(s.superAdmin));
      const status = detail.body.data.status as string;
      if (!status.includes('PENDING')) break; // e.g. MANAGER_APPROVAL_PENDING
      for (const approver of [s.manager, s.itAdmin, s.hr, s.finance, s.officeAdmin, s.superAdmin]) {
        const decided = await api(app)
          .post(`/api/v1/requests/${requestId}/decision`)
          .set(auth(approver))
          .send({ decision: 'APPROVED' });
        if ([200, 201].includes(decided.status)) break;
      }
    }

    expect(await prisma.client.maintenanceRecord.findUnique({ where: { requestId } })).toBeNull();
  });
});
