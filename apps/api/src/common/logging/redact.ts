/**
 * Secret redaction for structured logs (spec section 20: never leak sensitive
 * values).
 *
 * The error filter logs a context object and the app logs the odd diagnostic
 * line. Neither should ever carry a password, token, cookie or key — but a
 * defect elsewhere could put one into an object that lands here, so this is the
 * last line of defence: it walks any value and masks anything whose key looks
 * secret, plus bearer tokens and long opaque strings embedded in text.
 *
 * It is deliberately conservative about what it masks by key name and never
 * throws — a logger that crashes is worse than one that over-masks.
 */

export const REDACTED = '[REDACTED]';

/** Key names (case-insensitive substring) whose values are always masked. */
const SECRET_KEY_PATTERNS = [
  'password',
  'passwd',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'accesskey',
  'privatekey',
  'refresh',
  'sessionid',
  'session_id',
  'mfa',
  'totp',
  'otp',
  'sha256', // document hashes can be sensitive fingerprints
  'passwordhash',
];

/** Matches a bearer token or a long opaque credential inside a string. */
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

function keyLooksSecret(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((p) => lower.includes(p));
}

function redactString(value: string): string {
  return value.replace(BEARER_PATTERN, `Bearer ${REDACTED}`).replace(JWT_PATTERN, REDACTED);
}

/**
 * Returns a deep copy of `value` with secrets masked. Cycles are handled, and
 * the input is never mutated.
 */
export function redactSecrets<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === 'string') {
    return redactString(value) as unknown as T;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return '[Circular]' as unknown as T;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, seen)) as unknown as T;
  }

  // Preserve well-known non-plain objects as a safe string rather than walking
  // their internals (which can be huge or throw on access).
  if (value instanceof Date) return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) } as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = keyLooksSecret(key) ? REDACTED : redactSecrets(val, seen);
  }
  return out as unknown as T;
}
