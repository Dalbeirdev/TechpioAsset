import { describe, expect, it } from 'vitest';
import { RoutingMailProvider } from './routing-mail.provider.js';

/**
 * Where a send actually goes, and why nothing may infer it from MAIL_PROVIDER.
 *
 * Production ran for three weeks with MAIL_PROVIDER=mock while delivering real
 * email through SMTP settings saved in the console. Anything that reads the
 * environment variable to describe mail therefore describes the wrong thing -
 * the health probe did exactly that, and reported a service that had sent 352
 * messages as simulated and degraded.
 */

const settingsRow = {
  id: 'default',
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  username: 'help@example.com',
  passwordEncrypted: 'encrypted',
  fromAddress: 'Example <help@example.com>',
  updatedAt: new Date('2026-08-12T15:04:54Z'),
};

function build(mailProvider: string, row: typeof settingsRow | null) {
  const config = {
    get: (key: string) =>
      key === 'MAIL_PROVIDER' ? mailProvider : key === 'MAIL_FROM' ? 'test@example.com' : undefined,
  };
  const prisma = { client: { mailSettings: { findUnique: async () => row } } };
  const mfa = { decryptSecret: () => 'decrypted' };
  return new RoutingMailProvider(
    prisma as never,
    mfa as never,
    config as never,
  );
}

describe('which route a mail send would take', () => {
  it('prefers the database settings even when the environment says mock', async () => {
    // The exact production shape: MAIL_PROVIDER=mock, a live SMTP row.
    const provider = build('mock', settingsRow);
    expect(await provider.route()).toBe('database');
    expect(await provider.isLive()).toBe(true);
  });

  it('falls back to environment SMTP when no settings row exists', async () => {
    const provider = build('smtp', null);
    expect(await provider.route()).toBe('env-smtp');
    expect(await provider.isLive()).toBe(true);
  });

  it('is simulated only when neither source provides a transport', async () => {
    const provider = build('mock', null);
    expect(await provider.route()).toBe('simulated');
    expect(await provider.isLive()).toBe(false);
  });

  it('treats an unreadable settings table as no settings rather than failing', async () => {
    // dbTransport swallows the query error on purpose: a probe that throws is
    // worse than one that reports the environment fallback it would use.
    const config = { get: () => 'mock' };
    const prisma = {
      client: { mailSettings: { findUnique: async () => { throw new Error('no such table'); } } },
    };
    const provider = new RoutingMailProvider(
      prisma as never,
      { decryptSecret: () => null } as never,
      config as never,
    );
    expect(await provider.route()).toBe('simulated');
  });
});
