import type { KeyValueStore } from './storage';

/**
 * Web fallback for {@link SqliteStore}.
 *
 * expo-sqlite has no web build, so on web the offline queue is backed by
 * localStorage. Metro resolves this `.web.ts` variant automatically for the web
 * bundle; the native build keeps using SQLite, which survives an app kill and a
 * device restart. This exists so the app runs on a laptop for review — the
 * durability guarantees of the native store do not fully apply in a browser.
 */
export class SqliteStore implements KeyValueStore {
  async get(key: string): Promise<string | null> {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* storage unavailable — no-op */
    }
  }

  async delete(key: string): Promise<void> {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* storage unavailable — no-op */
    }
  }
}
