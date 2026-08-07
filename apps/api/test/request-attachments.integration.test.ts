import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.12 — request attachments. A requester can attach a file (photo of the
 * damage, a spec sheet) to their own request, download it, and remove it.
 * The lines under test: ownership follows the request's scope (a foreign
 * request's attachment routes 404), and file validation is by signature.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let requestId: string;

// A one-pixel PNG — validated by magic bytes, so a real image is required.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);

  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Attachment fixture request - a second monitor',
      items: [{ description: 'Monitor', quantity: 1 }],
    });
  requestId = created.body.data.id;
});

afterAll(async () => {
  await prisma?.client.$executeRawUnsafe('DELETE FROM attachments WHERE "assetRequestId" = $1', requestId);
  await prisma?.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', requestId);
  await prisma?.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', requestId);
  await app?.close();
});

describe('request attachments', () => {
  let attachmentId: string;

  it('the requester can attach a file and it appears on the request', async () => {
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/attachments`)
      .set(auth(s.employee))
      .attach('file', PNG, 'damage.png');
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.attachments).toHaveLength(1);
    attachmentId = res.body.data.attachments[0].id;
    expect(res.body.data.attachments[0].originalName).toBe('damage.png');
  });

  it('rejects a file whose bytes are not an allowed type', async () => {
    const res = await api(app)
      .post(`/api/v1/requests/${requestId}/attachments`)
      .set(auth(s.employee))
      .attach('file', Buffer.from('#!/bin/sh\nrm -rf /\n'), 'evil.png');
    expect([400, 415, 422]).toContain(res.status);
  });

  it('the requester can download their attachment', async () => {
    const res = await api(app)
      .get(`/api/v1/requests/${requestId}/attachments/${attachmentId}`)
      .set(auth(s.employee));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('another employee cannot reach the attachment (scope 404)', async () => {
    const list = await api(app)
      .get(`/api/v1/requests/${requestId}/attachments/${attachmentId}`)
      .set(auth(s.employee2));
    expect(list.status).toBe(404);

    const upload = await api(app)
      .post(`/api/v1/requests/${requestId}/attachments`)
      .set(auth(s.employee2))
      .attach('file', PNG, 'sneaky.png');
    expect(upload.status).toBe(404);
  });

  it('the requester can remove their attachment', async () => {
    const res = await api(app)
      .delete(`/api/v1/requests/${requestId}/attachments/${attachmentId}`)
      .set(auth(s.employee));
    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toHaveLength(0);
  });
});
