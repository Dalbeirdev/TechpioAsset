import * as SQLite from 'expo-sqlite';
import type { KeyValueStore } from './storage';

/**
 * KeyValueStore backed by expo-sqlite.
 *
 * The offline queue is persisted in SQLite rather than AsyncStorage so it
 * survives an app kill and a device restart — a stocktake captured on Friday
 * afternoon must still be there Monday morning. The store is opened lazily and
 * the table created on first use.
 */
export class SqliteStore implements KeyValueStore {
  private db: SQLite.SQLiteDatabase | null = null;

  private async database(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db) {
      this.db = await SQLite.openDatabaseAsync('techpioasset.db');
      await this.db.execAsync(
        'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);',
      );
    }
    return this.db;
  }

  async get(key: string): Promise<string | null> {
    const db = await this.database();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      key,
    );
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const db = await this.database();
    await db.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  async delete(key: string): Promise<void> {
    const db = await this.database();
    await db.runAsync('DELETE FROM kv WHERE key = ?', key);
  }
}
