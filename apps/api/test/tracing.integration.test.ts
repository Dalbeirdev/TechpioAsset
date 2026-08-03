import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTracing, isTracingEnabled, withSpan, type TracingHandle } from '../src/observability/tracing.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.8 S4 — tracing verified against a REAL OTLP collector running
 * in-process: the exporter posts genuine protobuf/JSON payloads to it, so
 * "spans are exported" is observed rather than assumed.
 *
 * The property worth proving is the one that makes 3am debugging bearable:
 * the id in the response envelope IS the trace id, so a user's screenshot of
 * an error leads straight to the trace.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let collector: Server;
let tracing: TracingHandle | null = null;
/** Raw OTLP export bodies the collector received. */
const exports: string[] = [];

beforeAll(async () => {
  collector = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      exports.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  const port = (collector.address() as AddressInfo).port;

  // Tracing must start BEFORE the app: instrumentation patches modules as they load.
  tracing = await startTracing({
    ...process.env,
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
  });
  expect(tracing).not.toBeNull();

  app = await createTestApp();
  s = await loginAll(app);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await tracing?.shutdown(); // flushes anything still batched
  await new Promise<void>((resolve) => collector.close(() => resolve()));
});

describe('tracing is on', () => {
  it('reports itself as enabled', () => {
    expect(isTracingEnabled()).toBe(true);
  });

  it('the request id in the response IS the trace id, and the span reaches the collector', async () => {
    const before = exports.length;

    // A deliberately failing request, because its envelope carries requestId.
    const res = await api(app).get('/api/v1/assets/definitely-not-an-asset').set(auth(s.itAdmin));
    expect(res.status).toBe(404);
    const requestId: string = res.body.requestId;

    // With tracing on this is a 32-char hex trace id, not the ULID fallback.
    expect(requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(requestId).not.toMatch(/^req_/);

    // Flush and confirm the collector actually received that trace.
    await tracing!.shutdown();
    tracing = null;
    expect(exports.length).toBeGreaterThan(before);
    expect(exports.join('')).toContain(requestId);
  }, 60_000);
});

describe('withSpan', () => {
  it('runs the work and propagates failures either way', async () => {
    await expect(withSpan('probe.ok', async () => 'value')).resolves.toBe('value');
    await expect(
      withSpan('probe.throws', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
