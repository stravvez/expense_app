import type { SQLiteDatabase } from 'expo-sqlite';
import { learnKey, normalizeParty, type RuleRow } from '../core/categorize';
import { MERGE_WINDOW_MS } from '../core/merge';
import type { PartyId, Share, SplitMode, SplitRecord, SettlementRecord } from '../core/splits';
import type { ParsedTxn, TxnRow } from '../core/types';

/* ---------------------------------------------------------------- meta */

export async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key))?.value ?? null;
}
export async function setMeta(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

/* ---------------------------------------------------------- categories */

export type Category = { id: number; key: string | null; name: string; icon: string; color: string; budget_paise: number; sort: number };

export function listCategories(db: SQLiteDatabase) {
  return db.getAllAsync<Category>('SELECT * FROM categories ORDER BY sort, id');
}
export async function updateCategory(db: SQLiteDatabase, id: number, p: Partial<Pick<Category, 'name' | 'icon' | 'color' | 'budget_paise'>>) {
  const cur = await db.getFirstAsync<Category>('SELECT * FROM categories WHERE id = ?', id);
  if (!cur) return;
  const n = { ...cur, ...p };
  await db.runAsync('UPDATE categories SET name = ?, icon = ?, color = ?, budget_paise = ? WHERE id = ?', n.name, n.icon, n.color, n.budget_paise, id);
}
export async function addCategory(db: SQLiteDatabase, name: string, icon: string, color: string) {
  const r = await db.runAsync('INSERT INTO categories (name, icon, color, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM categories))', name, icon, color);
  return r.lastInsertRowId;
}
export async function deleteCategory(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM categories WHERE id = ?', id);
}

/* --------------------------------------------------------------- rules */

export function listRules(db: SQLiteDatabase) {
  return db.getAllAsync<RuleRow>('SELECT match_type, pattern, category_id, origin FROM merchant_rules');
}
export function listLearnedRules(db: SQLiteDatabase) {
  return db.getAllAsync<RuleRow & { id: number; category_name: string }>(
    `SELECT r.id, r.match_type, r.pattern, r.category_id, r.origin, c.name AS category_name
     FROM merchant_rules r JOIN categories c ON c.id = r.category_id WHERE r.origin = 'learned' ORDER BY r.pattern`
  );
}
export async function deleteRule(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM merchant_rules WHERE id = ?', id);
}

/* -------------------------------------------------------- transactions */

export type TxnView = TxnRow & { category_name: string | null; category_icon: string | null; category_color: string | null; my_share_paise: number; has_split: number };

const TXN_SELECT = `
  SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
         CASE WHEN s.id IS NULL THEN t.amount_paise
              ELSE COALESCE((SELECT share_paise FROM split_shares WHERE split_id = s.id AND person_id IS NULL), 0) END AS my_share_paise,
         CASE WHEN s.id IS NULL THEN 0 ELSE 1 END AS has_split
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN splits s ON s.transaction_id = t.id`;

export function getTxn(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<TxnView>(`${TXN_SELECT} WHERE t.id = ?`, id);
}

export type TxnFilter = { from?: number; to?: number; search?: string; categoryId?: number | 'none'; direction?: 'debit' | 'credit'; limit?: number };

export function listTxns(db: SQLiteDatabase, f: TxnFilter = {}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const add = (clause: string, ...p: (string | number)[]) => {
    where.push(clause);
    params.push(...p);
  };
  if (f.from != null) add('t.ts >= ?', f.from);
  if (f.to != null) add('t.ts < ?', f.to);
  if (f.direction) add('t.direction = ?', f.direction);
  if (f.categoryId === 'none') add("t.category_id IS NULL AND t.direction = 'debit'");
  else if (f.categoryId != null) add('t.category_id = ?', f.categoryId);
  if (f.search) {
    where.push('(t.counterparty LIKE ? OR t.vpa LIKE ? OR t.note LIKE ? OR t.upi_ref LIKE ?)');
    const q = `%${f.search}%`;
    params.push(q, q, q, q);
  }
  const sql = `${TXN_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.ts DESC LIMIT ${f.limit ?? 500}`;
  return db.getAllAsync<TxnView>(sql, params);
}

export function mergeCandidates(db: SQLiteDatabase, p: ParsedTxn) {
  return db.getAllAsync<TxnRow>(
    `SELECT * FROM transactions
     WHERE (upi_ref IS NOT NULL AND upi_ref = ?)
        OR (amount_paise = ? AND direction = ? AND ts BETWEEN ? AND ?)`,
    p.upiRef ?? '',
    p.amountPaise,
    p.direction,
    p.ts - MERGE_WINDOW_MS,
    p.ts + MERGE_WINDOW_MS
  );
}

export async function insertTxn(db: SQLiteDatabase, p: ParsedTxn, categoryId: number | null) {
  const r = await db.runAsync(
    `INSERT INTO transactions (ts, amount_paise, direction, counterparty, vpa, upi_ref, account_last4, category_id, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.ts, p.amountPaise, p.direction, p.counterparty ?? null, p.vpa ?? null, p.upiRef ?? null, p.accountLast4 ?? null, categoryId, p.source, Date.now()
  );
  return r.lastInsertRowId;
}

const PATCHABLE = ['ts', 'counterparty', 'vpa', 'upi_ref', 'account_last4', 'category_id', 'category_source', 'note', 'sources', 'excluded', 'amount_paise', 'direction'] as const;

export async function patchTxn(db: SQLiteDatabase, id: number, patch: Partial<TxnRow>) {
  const keys = PATCHABLE.filter((k) => k in patch);
  if (!keys.length) return;
  await db.runAsync(`UPDATE transactions SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => (patch as any)[k] ?? null), id);
}

export async function deleteTxn(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM transactions WHERE id = ?', id);
}

/** Transactions from the same merchant (same learn key) that are still auto-categorised differently. */
export async function similarTxnIds(db: SQLiteDatabase, txn: Pick<TxnRow, 'id' | 'counterparty' | 'vpa'>, categoryId: number) {
  const key = learnKey(txn);
  if (!key) return [];
  const rows = await db.getAllAsync<{ id: number; counterparty: string | null; vpa: string | null }>(
    `SELECT id, counterparty, vpa FROM transactions
     WHERE id != ? AND direction = 'debit' AND category_source = 'auto' AND (category_id IS NULL OR category_id != ?)`,
    txn.id,
    categoryId
  );
  return rows.filter((r) => learnKey(r) === key).map((r) => r.id);
}

/** User picked a category: store it, learn the merchant, optionally apply to past ones. */
export async function setTxnCategory(db: SQLiteDatabase, txn: TxnRow, categoryId: number | null, applyToIds: number[] = []) {
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE transactions SET category_id = ?, category_source = 'user' WHERE id = ?", categoryId, txn.id);
    const key = learnKey(txn);
    if (key && categoryId != null) {
      await db.runAsync(
        `INSERT INTO merchant_rules (match_type, pattern, category_id, origin) VALUES ('exact', ?, ?, 'learned')
         ON CONFLICT(match_type, pattern) DO UPDATE SET category_id = excluded.category_id, origin = 'learned'`,
        key,
        categoryId
      );
    }
    for (const id of applyToIds) await db.runAsync('UPDATE transactions SET category_id = ? WHERE id = ?', categoryId, id);
  });
}

/* ---------------------------------------------------------- raw events */

export type RawEvent = { id: number; source: string; sender: string; body: string; ts: number; status: string; reason: string | null; txn_id: number | null };

/** Returns false when this exact capture was already processed. */
export async function insertRaw(db: SQLiteDatabase, e: { source: string; sender: string; body: string; ts: number; key: string }) {
  const r = await db.runAsync(
    "INSERT OR IGNORE INTO raw_events (source, sender, body, ts, native_key, status) VALUES (?, ?, ?, ?, ?, 'pending')",
    e.source, e.sender, e.body, e.ts, e.key
  );
  return r.changes > 0 ? r.lastInsertRowId : null;
}
export async function setRawStatus(db: SQLiteDatabase, id: number, status: string, reason: string | null, txnId: number | null) {
  await db.runAsync('UPDATE raw_events SET status = ?, reason = ?, txn_id = ? WHERE id = ?', status, reason, txnId, id);
}
export function listRaw(db: SQLiteDatabase, status: string, limit = 200) {
  return db.getAllAsync<RawEvent>('SELECT * FROM raw_events WHERE status = ? ORDER BY ts DESC LIMIT ?', status, limit);
}
export async function countRaw(db: SQLiteDatabase, status: string) {
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM raw_events WHERE status = ?', status))?.n ?? 0;
}

/* -------------------------------------------------------------- people */

export type Person = { id: number; name: string; vpa: string | null };

export function listPeople(db: SQLiteDatabase) {
  return db.getAllAsync<Person>('SELECT id, name, vpa FROM people ORDER BY name COLLATE NOCASE');
}
export async function addPerson(db: SQLiteDatabase, name: string, vpa?: string | null) {
  return (await db.runAsync('INSERT INTO people (name, vpa, created_at) VALUES (?, ?, ?)', name.trim(), vpa?.trim().toLowerCase() || null, Date.now())).lastInsertRowId;
}
export async function updatePerson(db: SQLiteDatabase, id: number, name: string, vpa: string | null) {
  await db.runAsync('UPDATE people SET name = ?, vpa = ? WHERE id = ?', name.trim(), vpa?.trim().toLowerCase() || null, id);
}
export async function deletePerson(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM people WHERE id = ?', id);
}
export function matchPerson(people: Person[], t: Pick<TxnRow, 'counterparty' | 'vpa'>): Person | undefined {
  const cp = normalizeParty(t.counterparty);
  return people.find((p) => (p.vpa && t.vpa && p.vpa === t.vpa.toLowerCase()) || (cp && normalizeParty(p.name) === cp));
}

/* -------------------------------------------------------------- splits */

export type SplitFull = { id: number; transaction_id: number | null; payer_person_id: number | null; total_paise: number; description: string | null; category_id: number | null; mode: SplitMode; ts: number; shares: Share[] };

async function sharesFor(db: SQLiteDatabase, splitId: number): Promise<Share[]> {
  const rows = await db.getAllAsync<{ person_id: number | null; share_paise: number }>('SELECT person_id, share_paise FROM split_shares WHERE split_id = ? ORDER BY id', splitId);
  return rows.map((r) => ({ personId: r.person_id, sharePaise: r.share_paise }));
}

export async function getSplit(db: SQLiteDatabase, splitId: number): Promise<SplitFull | null> {
  const s = await db.getFirstAsync<Omit<SplitFull, 'shares'>>('SELECT * FROM splits WHERE id = ?', splitId);
  return s ? { ...s, shares: await sharesFor(db, s.id) } : null;
}
export async function getSplitForTxn(db: SQLiteDatabase, txnId: number): Promise<SplitFull | null> {
  const s = await db.getFirstAsync<{ id: number }>('SELECT id FROM splits WHERE transaction_id = ?', txnId);
  return s ? getSplit(db, s.id) : null;
}

export async function saveSplit(
  db: SQLiteDatabase,
  s: { id?: number; transactionId: number | null; payer: PartyId; total: number; mode: SplitMode; description?: string | null; categoryId?: number | null; ts: number; shares: Share[] }
) {
  let id = s.id;
  await db.withTransactionAsync(async () => {
    if (id) {
      await db.runAsync('UPDATE splits SET payer_person_id = ?, total_paise = ?, mode = ?, description = ?, category_id = ?, ts = ? WHERE id = ?', s.payer, s.total, s.mode, s.description ?? null, s.categoryId ?? null, s.ts, id);
      await db.runAsync('DELETE FROM split_shares WHERE split_id = ?', id);
    } else {
      id = (
        await db.runAsync(
          'INSERT INTO splits (transaction_id, payer_person_id, total_paise, mode, description, category_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
          s.transactionId, s.payer, s.total, s.mode, s.description ?? null, s.categoryId ?? null, s.ts
        )
      ).lastInsertRowId;
    }
    for (const sh of s.shares) await db.runAsync('INSERT INTO split_shares (split_id, person_id, share_paise) VALUES (?, ?, ?)', id!, sh.personId, sh.sharePaise);
  });
  return id!;
}
export async function deleteSplit(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM splits WHERE id = ?', id);
}

export async function allSplitRecords(db: SQLiteDatabase): Promise<SplitRecord[]> {
  const rows = await db.getAllAsync<{ split_id: number; payer_person_id: number | null; person_id: number | null; share_paise: number }>(
    'SELECT s.id AS split_id, s.payer_person_id, sh.person_id, sh.share_paise FROM splits s JOIN split_shares sh ON sh.split_id = s.id'
  );
  const map = new Map<number, SplitRecord>();
  for (const r of rows) {
    if (!map.has(r.split_id)) map.set(r.split_id, { payerPersonId: r.payer_person_id, shares: [] });
    map.get(r.split_id)!.shares.push({ personId: r.person_id, sharePaise: r.share_paise });
  }
  return [...map.values()];
}

/** Activity involving one person, newest first: splits and settlements. */
export async function personActivity(db: SQLiteDatabase, personId: number) {
  const splits = await db.getAllAsync<{ id: number; ts: number; description: string | null; counterparty: string | null; total_paise: number; payer_person_id: number | null; their_share: number | null; my_share: number | null; transaction_id: number | null }>(
    `SELECT s.id, s.ts, s.description, t.counterparty, s.total_paise, s.payer_person_id, s.transaction_id,
       (SELECT share_paise FROM split_shares WHERE split_id = s.id AND person_id = ?) AS their_share,
       (SELECT share_paise FROM split_shares WHERE split_id = s.id AND person_id IS NULL) AS my_share
     FROM splits s LEFT JOIN transactions t ON t.id = s.transaction_id
     WHERE s.payer_person_id = ? OR EXISTS (SELECT 1 FROM split_shares WHERE split_id = s.id AND person_id = ?)
     ORDER BY s.ts DESC`,
    personId, personId, personId
  );
  const settlements = await db.getAllAsync<{ id: number; ts: number; amount_paise: number; direction: 'in' | 'out'; note: string | null; transaction_id: number | null }>(
    'SELECT id, ts, amount_paise, direction, note, transaction_id FROM settlements WHERE person_id = ? ORDER BY ts DESC',
    personId
  );
  return { splits, settlements };
}

/* --------------------------------------------------------- settlements */

export async function addSettlement(db: SQLiteDatabase, s: { personId: number; amount: number; direction: 'in' | 'out'; ts: number; transactionId?: number | null; note?: string | null }) {
  await db.runAsync('INSERT INTO settlements (person_id, amount_paise, direction, ts, transaction_id, note) VALUES (?, ?, ?, ?, ?, ?)', s.personId, s.amount, s.direction, s.ts, s.transactionId ?? null, s.note ?? null);
}
export async function deleteSettlement(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM settlements WHERE id = ?', id);
}
export function allSettlements(db: SQLiteDatabase) {
  return db.getAllAsync<SettlementRecord>('SELECT person_id AS personId, amount_paise AS amountPaise, direction FROM settlements');
}
/** Recent incoming payments not yet linked to a settlement — candidates for "they paid me back". */
export function unlinkedCredits(db: SQLiteDatabase, limit = 30) {
  return db.getAllAsync<TxnRow>(
    `SELECT t.* FROM transactions t WHERE t.direction = 'credit'
       AND NOT EXISTS (SELECT 1 FROM settlements st WHERE st.transaction_id = t.id)
     ORDER BY t.ts DESC LIMIT ?`,
    limit
  );
}
