import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Condition photos at handover and return (v2.32).
 *
 * The feature exists to settle "it already had that dent", so the properties
 * worth testing are the ones that make a photo evidence rather than decoration:
 * it is filed against the right custody event, it is grouped so the before and
 * after can be compared, and it cannot be quietly removed once it has become
 * one side of that comparison.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;

/** A 1x1 PNG - real bytes, because uploads are validated by magic number. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let assetId: string;
let holderId: string;
/** Assets created by nested suites, cleaned up with the main one. */
const extraAssets: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  // A dedicated asset, so custody churn here cannot disturb other suites.
  const company = s.superAdmin.user.companyId;
  const category = await prisma.client.category.findFirst({ where: { companyId: company } });
  const created = await prisma.client.asset.create({
    data: {
      companyId: company,
      assetTag: `PHOTO-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      name: 'Photo test laptop',
      categoryId: category!.id,
      qrToken: `qr-photo-${Math.random().toString(36).slice(2, 10)}`,
      status: 'AVAILABLE',
      condition: 'GOOD',
    },
    select: { id: true },
  });
  assetId = created.id;
  holderId = s.employee.user.id;
});

afterAll(async () => {
  for (const extra of extraAssets) {
    await prisma.client.$executeRawUnsafe('DELETE FROM attachments WHERE "assetId" = $1', extra);
    await prisma.client.$executeRawUnsafe(
      'DELETE FROM asset_returns WHERE "assignmentId" IN (SELECT id FROM asset_assignments WHERE "assetId" = $1)',
      extra,
    );
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_assignments WHERE "assetId" = $1', extra);
    await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', extra);
  }
  await prisma.client.$executeRawUnsafe('DELETE FROM attachments WHERE "assetId" = $1', assetId);
  await prisma.client.$executeRawUnsafe(
    'DELETE FROM asset_returns WHERE "assignmentId" IN (SELECT id FROM asset_assignments WHERE "assetId" = $1)',
    assetId,
  );
  await prisma.client.$executeRawUnsafe(
    'DELETE FROM asset_assignments WHERE "assetId" = $1',
    assetId,
  );
  await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', assetId);
  await app?.close();
});

const upload = (who: AccountKey, stage: string, caption?: string) => {
  const req = api(app)
    .post(`/api/v1/assets/${assetId}/photos`)
    .set(auth(s[who]))
    .field('stage', stage);
  if (caption) void req.field('caption', caption);
  return req.attach('file', PNG, 'condition.png');
};

const assign = () =>
  api(app)
    .post(`/api/v1/assets/${assetId}/assign`)
    .set(auth(s.itAdmin))
    .send({ userId: holderId, conditionOut: 'GOOD' });

const returnIt = () =>
  api(app)
    .post(`/api/v1/assets/${assetId}/return`)
    .set(auth(s.itAdmin))
    .send({ conditionIn: 'FAIR', damageNotes: 'Scratch on the lid', resultingStatus: 'AVAILABLE' });

const listPhotos = (who: AccountKey = 'itAdmin') =>
  api(app).get(`/api/v1/assets/${assetId}/photos`).set(auth(s[who]));

describe('condition photos', () => {
  it('refuses a handover photo when nobody holds the asset', async () => {
    // Nothing to file it against. Storing it loose would produce a photo that
    // belongs to no custody event, which is the one thing this must not do.
    const res = await upload('itAdmin', 'HANDOVER');
    // 422: this app maps VALIDATION_FAILED to Unprocessable Entity.
    expect(res.status).toBe(422);
    // The AppError message is replaced by a generic title in the response; the
    // useful wording travels in `detail`, which is what a user actually reads.
    expect(res.body.detail).toMatch(/active assignment/i);
  });

  it('files a handover photo against the open assignment', async () => {
    expect((await assign()).status).toBeLessThan(300);

    const res = await upload('itAdmin', 'HANDOVER', 'Lid, before issue');
    expect(res.status).toBeLessThan(300);
    expect(res.body.data.stage).toBe('HANDOVER');

    const groups = (await listPhotos()).body.data;
    expect(groups[0].open).toBe(true);
    expect(groups[0].handover).toHaveLength(1);
    expect(groups[0].handover[0].caption).toBe('Lid, before issue');
    // The person who took it is part of the evidence.
    expect(groups[0].handover[0].by).toBeTruthy();
  });

  it('lets the photographer clear a bad shot while the handover is open', async () => {
    const added = await upload('itAdmin', 'HANDOVER', 'Blurred');
    const id = added.body.data.id;

    const removed = await api(app)
      .delete(`/api/v1/assets/${assetId}/photos/${id}`)
      .set(auth(s.itAdmin));
    expect(removed.status).toBe(200);

    const groups = (await listPhotos()).body.data;
    expect(groups[0].handover.map((p: { caption: string }) => p.caption)).not.toContain('Blurred');
  });

  it('serves the bytes back inline', async () => {
    const groups = (await listPhotos()).body.data;
    const id = groups[0].handover[0].id;

    const res = await api(app)
      .get(`/api/v1/assets/${assetId}/photos/${id}`)
      .set(auth(s.employee))
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    // Never a shared cache: this is a picture of a named person's equipment.
    expect(res.headers['cache-control']).toContain('no-store');
    expect((res.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
  });

  it('groups the return photos with the handover they close, and keeps both conditions', async () => {
    expect((await returnIt()).status).toBeLessThan(300);

    const res = await upload('itAdmin', 'RETURN', 'Scratch on the lid');
    expect(res.status).toBeLessThan(300);

    const group = (await listPhotos()).body.data[0];
    // The whole point: before and after on one record, with the words that were
    // recorded at each end sitting next to the pictures.
    expect(group.handover.length).toBeGreaterThan(0);
    expect(group.returned).toHaveLength(1);
    expect(group.conditionOut).toBe('GOOD');
    expect(group.conditionIn).toBe('FAIR');
    expect(group.open).toBe(false);
  });

  it('will not let a handover photo be removed once a return has closed it', async () => {
    const group = (await listPhotos()).body.data[0];
    const before = group.handover[0].id;

    const res = await api(app)
      .delete(`/api/v1/assets/${assetId}/photos/${before}`)
      .set(auth(s.itAdmin));

    // Deleting it now would remove one side of an argument, at exactly the
    // moment somebody would most want to.
    expect(res.status).toBe(403);
    expect(res.body.detail).toMatch(/before/i);
  });

  it('will not let a return photo be removed at all', async () => {
    const group = (await listPhotos()).body.data[0];
    const res = await api(app)
      .delete(`/api/v1/assets/${assetId}/photos/${group.returned[0].id}`)
      .set(auth(s.itAdmin));
    expect(res.status).toBe(403);
  });

  it('refuses a photo from an employee who does not hold the asset', async () => {
    // employee2 is not the holder, so there is nothing here that is theirs to
    // record. Custody rights are the only other way in.
    const res = await upload('employee2', 'HANDOVER');
    expect(res.status).toBe(403);
  });

  it('rejects a file that is not an image, whatever it is called', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/photos`)
      .set(auth(s.itAdmin))
      .field('stage', 'RETURN')
      .attach('file', Buffer.from('%PDF-1.7 not a photograph'), 'photo.png');
    expect([400, 415, 422]).toContain(res.status);
  });

  it('rejects an unknown stage rather than guessing one', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/photos`)
      .set(auth(s.itAdmin))
      .field('stage', 'WHENEVER')
      .attach('file', PNG, 'condition.png');
    expect(res.status).toBe(422);
  });
});

/**
 * The holder's own window (v2.35).
 *
 * The employee who receives equipment can photograph what they were actually
 * handed, with no permission at all - and their own confirmation of receipt is
 * what closes the window. That self-locking is the point: after it, only a
 * custody role can change the record, so it cannot be quietly revised months
 * later by the person it would exonerate.
 */
describe("the holder's own photo window", () => {
  /** A second asset, assigned and left unacknowledged. */
  let holderAssetId: string;

  beforeAll(async () => {
    const company = s.superAdmin.user.companyId;
    const category = await prisma.client.category.findFirst({ where: { companyId: company } });
    const created = await prisma.client.asset.create({
      data: {
        companyId: company,
        assetTag: `HOLD-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        name: 'Holder window laptop',
        categoryId: category!.id,
        qrToken: `qr-hold-${Math.random().toString(36).slice(2, 10)}`,
        status: 'AVAILABLE',
        condition: 'GOOD',
      },
      select: { id: true },
    });
    holderAssetId = created.id;
    extraAssets.push(holderAssetId);

    await api(app)
      .post(`/api/v1/assets/${holderAssetId}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });
  });

  const asHolder = (stage = 'HANDOVER') =>
    api(app)
      .post(`/api/v1/assets/${holderAssetId}/photos`)
      .set(auth(s.employee))
      .field('stage', stage)
      .attach('file', PNG, 'mine.png');

  it('lets the holder photograph it with no permission at all', async () => {
    const res = await asHolder();
    expect(res.status).toBeLessThan(300);
  });

  it("marks the photo as the holder's own, which is what makes it worth more", async () => {
    const groups = (
      await api(app).get(`/api/v1/assets/${holderAssetId}/photos`).set(auth(s.itAdmin))
    ).body.data;
    const mine = groups[0].handover.find((p: { byHolder: boolean }) => p.byHolder);
    expect(mine).toBeTruthy();
    expect(mine.by).toBeTruthy();
  });

  it('refuses to let the holder photograph a return', async () => {
    // The departing holder filing the "what came back" evidence would defeat
    // the comparison the whole feature exists for.
    const res = await asHolder('RETURN');
    expect(res.status).toBe(403);
  });

  it('lets the holder take back their own shot before confirming', async () => {
    const added = await asHolder();
    const res = await api(app)
      .delete(`/api/v1/assets/${holderAssetId}/photos/${added.body.data.id}`)
      .set(auth(s.employee));
    expect(res.status).toBe(200);
  });

  it("will not let the holder remove somebody else's photo", async () => {
    const itShot = await api(app)
      .post(`/api/v1/assets/${holderAssetId}/photos`)
      .set(auth(s.itAdmin))
      .field('stage', 'HANDOVER')
      .attach('file', PNG, 'theirs.png');

    const res = await api(app)
      .delete(`/api/v1/assets/${holderAssetId}/photos/${itShot.body.data.id}`)
      .set(auth(s.employee));
    expect(res.status).toBe(403);
  });

  it('locks REMOVAL when the holder confirms, but still lets them add', async () => {
    const before = await asHolder();
    expect(before.status).toBeLessThan(300);

    const open = await prisma.client.assetAssignment.findFirst({
      where: { assetId: holderAssetId, returnedAt: null },
      select: { id: true },
    });
    const ack = await api(app)
      .post(`/api/v1/assets/assignments/${open!.id}/acknowledge`)
      .set(auth(s.employee));
    expect(ack.status).toBeLessThan(300);

    // Still allowed: a mouse gets damaged months after it was issued, and the
    // holder is the only person looking at it. Every photo carries the moment
    // it was taken, so a later one cannot pass as evidence of the handover.
    const added = await asHolder();
    expect(added.status).toBeLessThan(300);

    // Not allowed: their account of what they received stops being theirs to
    // withdraw the moment they said they received it.
    const removed = await api(app)
      .delete(`/api/v1/assets/${holderAssetId}/photos/${before.body.data.id}`)
      .set(auth(s.employee));
    expect(removed.status).toBe(403);
    expect(removed.body.detail).toMatch(/no longer be removed|confirmed/i);
  });

  it('still lets a custody role add one after the holder has locked theirs', async () => {
    // "Only an authorised role can change it" - the whole reason the lock is
    // the holder's and not everyone's.
    const res = await api(app)
      .post(`/api/v1/assets/${holderAssetId}/photos`)
      .set(auth(s.itAdmin))
      .field('stage', 'HANDOVER')
      .attach('file', PNG, 'later.png');
    expect(res.status).toBeLessThan(300);
  });
});
