import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_CATEGORIES, DEFAULT_KEYWORDS } from '../core/categorize';

export const DB_NAME = 'paisa.db';
const LATEST = 1;

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let v = row?.user_version ?? 0;
  if (v >= LATEST) return;

  if (v === 0) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);

        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE,
          name TEXT NOT NULL,
          icon TEXT NOT NULL DEFAULT '📦',
          color TEXT NOT NULL DEFAULT '#868E96',
          budget_paise INTEGER NOT NULL DEFAULT 0,
          sort INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          amount_paise INTEGER NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
          counterparty TEXT,
          vpa TEXT,
          upi_ref TEXT UNIQUE,
          account_last4 TEXT,
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          category_source TEXT NOT NULL DEFAULT 'auto',
          note TEXT,
          sources TEXT NOT NULL DEFAULT '',
          excluded INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tx_ts ON transactions(ts);
        CREATE INDEX IF NOT EXISTS idx_tx_amount ON transactions(amount_paise, direction);

        CREATE TABLE IF NOT EXISTS raw_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          sender TEXT NOT NULL,
          body TEXT NOT NULL,
          ts INTEGER NOT NULL,
          native_key TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,            -- txn | duplicate | ignored | unparsed | dismissed
          reason TEXT,
          txn_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_raw_status ON raw_events(status);

        CREATE TABLE IF NOT EXISTS merchant_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          match_type TEXT NOT NULL CHECK (match_type IN ('exact','keyword')),
          pattern TEXT NOT NULL,
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          origin TEXT NOT NULL CHECK (origin IN ('default','learned')),
          UNIQUE (match_type, pattern)
        );

        CREATE TABLE IF NOT EXISTS people (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          vpa TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS splits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id INTEGER UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
          payer_person_id INTEGER REFERENCES people(id) ON DELETE CASCADE, -- NULL = me
          total_paise INTEGER NOT NULL,
          description TEXT,
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          mode TEXT NOT NULL DEFAULT 'equal',
          ts INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS split_shares (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          split_id INTEGER NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
          person_id INTEGER REFERENCES people(id) ON DELETE CASCADE, -- NULL = me
          share_paise INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_shares_split ON split_shares(split_id);

        CREATE TABLE IF NOT EXISTS settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          amount_paise INTEGER NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('in','out')),
          ts INTEGER NOT NULL,
          transaction_id INTEGER UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,
          note TEXT
        );
      `);

      for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
        await db.runAsync('INSERT OR IGNORE INTO categories (key, name, icon, color, sort) VALUES (?, ?, ?, ?, ?)', c.key, c.name, c.icon, c.color, i);
      }
      const cats = await db.getAllAsync<{ id: number; key: string }>('SELECT id, key FROM categories');
      const byKey = new Map(cats.map((c) => [c.key, c.id]));
      for (const [key, words] of Object.entries(DEFAULT_KEYWORDS)) {
        const cid = byKey.get(key);
        if (!cid) continue;
        for (const w of words) {
          await db.runAsync("INSERT OR IGNORE INTO merchant_rules (match_type, pattern, category_id, origin) VALUES ('keyword', ?, ?, 'default')", w.trim(), cid);
        }
      }
    });
    v = 1;
  }

  await db.execAsync(`PRAGMA user_version = ${LATEST}`);
}
