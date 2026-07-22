import { ulid as generate } from 'ulid';

/**
 * Client-side ULID for offline operation ids.
 *
 * A ULID is time-ordered and collision-resistant without a server round trip,
 * which is exactly what an offline queue needs: the device mints the idempotency
 * key locally, and the server recognises a replay by it.
 */
export function ulid(): string {
  return generate();
}
