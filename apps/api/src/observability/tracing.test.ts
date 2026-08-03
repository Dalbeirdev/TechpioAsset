import { describe, expect, it } from 'vitest';
import { isTracingEnabled, startRequestSpan, startTracing, withSpan } from './tracing';

/**
 * v2.8 S4 — the off path. "Opt-in" has to mean nothing is constructed, not
 * merely nothing is exported: an installation that never asked for tracing
 * should not pay for an SDK, an exporter, or module patching.
 */

describe('tracing is off unless asked for', () => {
  it('constructs nothing when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    const handle = await startTracing({});
    expect(handle).toBeNull();
    expect(isTracingEnabled()).toBe(false);
  });

  it('startRequestSpan returns null, so the request id falls back to its own scheme', () => {
    expect(startRequestSpan('GET /anything')).toBeNull();
  });

  it('withSpan is a plain call-through, including for failures', async () => {
    await expect(withSpan('probe', async () => 42)).resolves.toBe(42);
    await expect(
      withSpan('probe', async () => {
        throw new Error('still propagates');
      }),
    ).rejects.toThrow('still propagates');
  });
});
