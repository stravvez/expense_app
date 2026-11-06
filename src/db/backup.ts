import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

// Order matters for restore (foreign keys).
const TABLES = ['meta', 'categories', 'people', 'transactions', 'merchant_rules', 'splits', 'split_shares', 'settlements', 'raw_events'] as const;

export async function exportBackup(db: SQLiteDatabase) {
  const dump: Record<string, unknown[]> = {};
  for (const t of TABLES) dump[t] = await db.getAllAsync(`SELECT * FROM ${t}`);
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `paisa-backup-${stamp}.json`);
  file.create({ overwrite: true });
  file.write(JSON.stringify({ app: 'paisa-tracker', version: 1, exportedAt: Date.now(), tables: dump }));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save backup' });
}

/** Replaces all data with the backup's contents. */
export async function importBackup(db: SQLiteDatabase): Promise<boolean> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return false;
  const parsed = JSON.parse(await new File(res.assets[0].uri).text());
  if (parsed?.app !== 'paisa-tracker' || !parsed.tables) throw new Error('Not a Paisa Tracker backup file');

  await db.execAsync('PRAGMA foreign_keys = OFF');
  try {
    await db.withTransactionAsync(async () => {
      for (const t of [...TABLES].reverse()) await db.runAsync(`DELETE FROM ${t}`);
      for (const t of TABLES) {
        for (const row of (parsed.tables[t] ?? []) as Record<string, unknown>[]) {
          const cols = Object.keys(row);
          if (!cols.every((c) => /^[a-z_0-9]+$/.test(c))) continue;
          await db.runAsync(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c] as string | number | null));
        }
      }
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON');
  }
  return true;
}
