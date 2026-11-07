import type { SQLiteDatabase } from 'expo-sqlite';
import TxnCapture, { type RawCapture } from '../../modules/txn-capture';
import { categorize } from '../core/categorize';
import { decideMerge } from '../core/merge';
import { parseCapture } from '../core/parsers';
import type { TxnRow } from '../core/types';
import { getMeta, insertRaw, insertTxn, listRules, mergeCandidates, patchTxn, setRawStatus, setMeta } from '../db/repo';
import { alertNewTransactions } from './alerts';

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Stable identity of a capture, shared by the live receiver and inbox backfill. */
export function captureKey(c: Pick<RawCapture, 'source' | 'sender' | 'body' | 'ts'>) {
  return `${c.source}|${c.sender}|${Math.floor(c.ts / 1000)}|${hash(c.body.replace(/\s+/g, ' ').trim())}`;
}

export type ProcessStats = { inserted: number[]; merged: number; duplicates: number; ignored: number; unparsed: number };

// Serialise all processing (foreground listener, app-resume, background task, backfill).
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

type Rules = Awaited<ReturnType<typeof listRules>>;

async function processOne(db: SQLiteDatabase, c: RawCapture, rules: Rules, stats: ProcessStats) {
  const rawId = await insertRaw(db, { ...c, key: captureKey(c) });
  if (rawId == null) {
    stats.duplicates++;
    return;
  }
  return handleRaw(db, rawId, c, rules, stats);
}

async function handleRaw(db: SQLiteDatabase, rawId: number, c: Pick<RawCapture, 'source' | 'sender' | 'body' | 'ts'>, rules: Rules, stats: ProcessStats) {
  const res = parseCapture(c.source, c.sender, c.body, c.ts);
  if (res.kind === 'ignored') {
    stats.ignored++;
    return setRawStatus(db, rawId, 'ignored', res.reason, null);
  }
  if (res.kind === 'unparsed') {
    stats.unparsed++;
    return setRawStatus(db, rawId, 'unparsed', null, null);
  }

  const p = res.txn;
  const decision = decideMerge(p, await mergeCandidates(db, p));

  if (decision.action === 'duplicate') {
    stats.duplicates++;
    return setRawStatus(db, rawId, 'duplicate', null, decision.targetId);
  }

  if (decision.action === 'merge') {
    const target = await db.getFirstAsync<TxnRow>('SELECT * FROM transactions WHERE id = ?', decision.targetId);
    const patch = { ...decision.patch };
    // A better name arrived → re-run auto categorisation (never override the user's choice).
    if (target && target.category_source === 'auto' && target.direction === 'debit' && (patch.counterparty || patch.vpa)) {
      const cat = categorize({ counterparty: patch.counterparty ?? target.counterparty, vpa: patch.vpa ?? target.vpa }, rules);
      if (cat != null) patch.category_id = cat;
    }
    await patchTxn(db, decision.targetId, patch);
    stats.merged++;
    return setRawStatus(db, rawId, 'txn', 'merged', decision.targetId);
  }

  const cat = p.direction === 'debit' ? categorize(p, rules) : null;
  const id = await insertTxn(db, p, cat);
  stats.inserted.push(id);
  return setRawStatus(db, rawId, 'txn', null, id);
}

export function processCaptures(db: SQLiteDatabase, captures: RawCapture[]): Promise<ProcessStats> {
  return serial(async () => {
    const stats: ProcessStats = { inserted: [], merged: 0, duplicates: 0, ignored: 0, unparsed: 0 };
    if (!captures.length) return stats;
    const rules = await listRules(db);
    // oldest first so merges see the earlier half of a pair
    for (const c of [...captures].sort((a, b) => a.ts - b.ts)) {
      try {
        await processOne(db, c, rules, stats);
      } catch (e) {
        console.warn('capture processing failed', e);
      }
    }
    return stats;
  });
}

/**
 * Bump when a parser change can turn previously skipped messages into transactions.
 * On the next launch, raw events marked ignored/unparsed are parsed again.
 */
export const PARSER_VERSION = 2;

export function reparseSkipped(db: SQLiteDatabase): Promise<ProcessStats | null> {
  return serial(async () => {
    if ((await getMeta(db, 'parser_version')) === String(PARSER_VERSION)) return null;
    const stats: ProcessStats = { inserted: [], merged: 0, duplicates: 0, ignored: 0, unparsed: 0 };
    const rows = await db.getAllAsync<{ id: number; source: RawCapture['source']; sender: string; body: string; ts: number }>(
      "SELECT id, source, sender, body, ts FROM raw_events WHERE status IN ('ignored', 'unparsed') ORDER BY ts"
    );
    const rules = await listRules(db);
    for (const r of rows) {
      try {
        await handleRaw(db, r.id, r, rules, stats);
      } catch (e) {
        console.warn('reparse failed', e);
      }
    }
    await setMeta(db, 'parser_version', String(PARSER_VERSION));
    return stats;
  });
}

/** Pull everything the native receivers queued, process it, then acknowledge. */
export async function drainNativeQueue(db: SQLiteDatabase, opts: { alert?: boolean } = {}) {
  if (!TxnCapture) return null;
  const pending = await TxnCapture.drainQueue();
  if (!pending.length) return null;
  const stats = await processCaptures(db, pending);
  await TxnCapture.ackEvents(pending.map((p) => p.id));
  await setMeta(db, 'last_capture_at', String(Date.now()));
  if (opts.alert !== false && stats.inserted.length) await alertNewTransactions(db, stats.inserted);
  return stats;
}

/** First-run / on-demand import of past bank SMS from the inbox. */
export async function backfillInbox(db: SQLiteDatabase, months: number) {
  if (!TxnCapture) throw new Error('Capture module unavailable (are you running in Expo Go?)');
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const msgs = await TxnCapture.readInbox(since.getTime(), 20000);
  const stats = await processCaptures(db, msgs);
  await setMeta(db, 'backfilled_at', String(Date.now()));
  return { scanned: msgs.length, ...stats };
}
