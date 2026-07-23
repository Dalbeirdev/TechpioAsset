import { describe, it, expect } from 'vitest';
import { redactSecrets, REDACTED } from './redact.js';

describe('redactSecrets (spec section 20: no sensitive values in logs)', () => {
  it('masks values under secret-looking keys', () => {
    const out = redactSecrets({
      email: 'user@example.com',
      password: 'hunter2',
      accessToken: 'abc.def.ghi',
      refreshToken: 'zzz',
      authorization: 'Bearer xyz',
      apiKey: 'k-123',
      passwordHash: '$argon2id$...',
    });
    expect(out.email).toBe('user@example.com');
    expect(out.password).toBe(REDACTED);
    expect(out.accessToken).toBe(REDACTED);
    expect(out.refreshToken).toBe(REDACTED);
    expect(out.authorization).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.passwordHash).toBe(REDACTED);
  });

  it('is case-insensitive on key names', () => {
    const out = redactSecrets({ Password: 'x', ACCESS_TOKEN: 'y', Cookie: 'z' });
    expect(out.Password).toBe(REDACTED);
    expect(out.ACCESS_TOKEN).toBe(REDACTED);
    expect(out.Cookie).toBe(REDACTED);
  });

  it('masks a bearer token embedded in a string value', () => {
    const out = redactSecrets({
      message: 'request failed with header Authorization: Bearer aGVsbG8td29ybGQtdG9rZW4',
    });
    expect(out.message).toContain('Bearer [REDACTED]');
    expect(out.message).not.toContain('aGVsbG8td29ybGQtdG9rZW4');
  });

  it('masks a JWT-shaped string', () => {
    const jwt = 'eyJhbGciOiJIUzI1Ni19.eyJzdWIiOiIxMjM0NTY3ODkw.dozjgNryP4J3jVmNHl0w5N';
    const out = redactSecrets({ note: `token was ${jwt}` });
    expect(out.note).not.toContain('eyJzdWIiOiIxMjM0NTY3ODkw');
    expect(out.note).toContain(REDACTED);
  });

  it('recurses through nested objects and arrays', () => {
    const out = redactSecrets({
      user: { name: 'Ann', credentials: { password: 'p' } },
      sessions: [{ sessionId: 's1' }, { sessionId: 's2' }],
    });
    expect(out.user.name).toBe('Ann');
    expect(out.user.credentials.password).toBe(REDACTED);
    expect(out.sessions[0].sessionId).toBe(REDACTED);
    expect(out.sessions[1].sessionId).toBe(REDACTED);
  });

  it('does not mutate the input', () => {
    const input = { password: 'secret', keep: 'ok' };
    const out = redactSecrets(input);
    expect(input.password).toBe('secret');
    expect(out.password).toBe(REDACTED);
  });

  it('handles circular references without throwing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = redactSecrets(a) as Record<string, unknown>;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[Circular]');
  });

  it('passes primitives and dates through unchanged', () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(null)).toBeNull();
    const d = new Date('2026-07-23T00:00:00Z');
    expect(redactSecrets(d)).toBe(d);
  });

  it('reduces an Error to a safe name/message pair', () => {
    const out = redactSecrets({ err: new Error('failed with Bearer abcdefghijklmnop') }) as {
      err: { name: string; message: string };
    };
    expect(out.err.name).toBe('Error');
    expect(out.err.message).toContain('Bearer [REDACTED]');
  });
});
