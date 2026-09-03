import { describe, expect, it } from 'vitest';
import type { DependencyHealth } from '@techpioasset/contracts';
import { describeStorage, rollUp } from './health.service.js';

/**
 * What the readiness probe is allowed to claim.
 *
 * `mocked` is the one word on this endpoint that has to keep its meaning: it is
 * how an operator learns that `ai` and `push` return invented results. Spending
 * it on the local storage provider - which writes real files and is in the
 * nightly backup - devalues it everywhere it matters.
 */

const dep = (over: Partial<DependencyHealth>): DependencyHealth => ({
  name: 'x',
  status: 'up',
  critical: false,
  ...over,
});

describe('how storage is described', () => {
  it('does not call the local provider simulated', () => {
    const local = describeStorage('local', false);
    expect(local.status).not.toBe('mocked');
    expect(local.detail).not.toMatch(/simulated/i);
  });

  it('says the files are real, and says what is actually missing', () => {
    const local = describeStorage('local', false);
    expect(local.status).toBe('degraded');
    expect(local.detail).toMatch(/real/i);
    expect(local.detail).toMatch(/nightly backup/i);
    expect(local.detail).toMatch(/durable object storage/i);
  });

  it('reports durable providers as plainly up', () => {
    for (const name of ['s3', 'azure']) {
      const remote = describeStorage(name, true);
      expect(remote.status).toBe('up');
      expect(remote.detail).toBe(`Provider: ${name}`);
    }
  });

  it('never makes storage critical - the API serves without an upload working', () => {
    expect(describeStorage('local', false).critical).toBe(false);
    expect(describeStorage('s3', true).critical).toBe(false);
  });
});

describe('the overall verdict', () => {
  it('is ok only when every dependency is up', () => {
    expect(rollUp([dep({}), dep({ status: 'up' })])).toBe('ok');
  });

  it('degrades on a degraded dependency', () => {
    // This is the case that silently did not count: storage now reports
    // degraded, and before this the service still called itself ok.
    expect(rollUp([dep({}), dep({ name: 'storage', status: 'degraded' })])).toBe('degraded');
  });

  it('degrades on a mocked dependency', () => {
    expect(rollUp([dep({}), dep({ name: 'ai', status: 'mocked' })])).toBe('degraded');
  });

  it('degrades on a non-critical dependency being down', () => {
    expect(rollUp([dep({}), dep({ name: 'redis', status: 'down', critical: false })])).toBe(
      'degraded',
    );
  });

  it('errors only when a critical dependency is down', () => {
    expect(rollUp([dep({ name: 'postgres', status: 'down', critical: true })])).toBe('error');
  });

  it('lets a critical failure outrank everything else', () => {
    expect(
      rollUp([
        dep({ name: 'postgres', status: 'down', critical: true }),
        dep({ name: 'ai', status: 'mocked' }),
        dep({ name: 'storage', status: 'degraded' }),
      ]),
    ).toBe('error');
  });
});
