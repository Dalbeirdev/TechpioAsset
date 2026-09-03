import { describe, expect, it } from 'vitest';
import type { DependencyHealth } from '@techpioasset/contracts';
import { describeRouted, describeStorage, rollUp, undeterminedRoute } from './health.service.js';

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

describe('how a console-configurable provider is described', () => {
  it('reports the provider production actually uses, not the env default', () => {
    // AI_PROVIDER=mock with an Anthropic key saved in the console on 13 August.
    // Reading the env var called this simulated for three weeks.
    const ai = describeRouted('ai', 'anthropic', 'operator', 'Platform → AI');
    expect(ai.status).toBe('up');
    expect(ai.detail).toBe('Provider: anthropic, configured in Platform → AI');
  });

  it('says when the environment is what won, so an operator knows where to look', () => {
    const ai = describeRouted('ai', 'azure', 'environment', 'Platform → AI');
    expect(ai.detail).toBe('Provider: azure, from the environment');
  });

  it('still reports a genuinely simulated provider as mocked', () => {
    for (const simulated of ['mock', 'simulated']) {
      const dep = describeRouted('ai', simulated, 'operator', 'Platform → AI');
      expect(dep.status).toBe('mocked');
      expect(dep.detail).toMatch(/simulated, not real/);
    }
  });

  it('describes mail and ai identically, because they route identically', () => {
    const mail = describeRouted('mail', 'SMTP', 'operator', 'Platform → Mail');
    const ai = describeRouted('ai', 'anthropic', 'operator', 'Platform → AI');
    expect(mail.status).toBe(ai.status);
    expect(mail.critical).toBe(false);
    expect(ai.critical).toBe(false);
  });

  it('degrades rather than guessing when the router cannot be questioned', () => {
    const dep = undeterminedRoute('ai', new Error('relation does not exist'));
    expect(dep.status).toBe('degraded');
    expect(dep.detail).toMatch(/relation does not exist/);
    // Claiming either state here is the bug this whole change is about.
    expect(dep.status).not.toBe('mocked');
    expect(dep.status).not.toBe('up');
  });

  it('makes an undetermined route degrade the service', () => {
    expect(rollUp([undeterminedRoute('ai', new Error('x'))])).toBe('degraded');
  });
});
