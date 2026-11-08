import type { SQLiteDatabase } from 'expo-sqlite';
import TxnCapture, { type RawCapture } from '../../modules/txn-capture';
import { categorize, isTruncatedName, type CategoryKind } from '../core/categorize';
import { decideMerge } from '../core/merge';
import { parseCapture } from '../core/parsers';
import { pickRefundTarget } from '../core/refunds';
import type { Direction, ParsedTxn, TxnRow } from '../core/types';
import {
  categoryKinds,
  getMeta,
  insertRaw,
  insertTxn,
  listRules,
  mergeCandidates,
  patchTxn,
  refundCandidates,
  resolveFullName,
  setMeta,
  setRawStatus,
  setRefundOf,
} from '../db/repo';
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

type Ctx = { rules: Awaited<ReturnType<typeof listRules>>; kinds: Map<number, CategoryKind> };

async function loadCtx(db: SQLiteDatabase): Promise<Ctx> {
  const [rules, kinds] = await Promise.all([listRules(db), categoryKinds(db)]);
  return { rules, kinds };
}

/** Debits take any category; credits only "money moved" ones (from yourself, fund redemptions). */
function autoCategory(input: { counterparty?: string | null; vpa?: string | null; truncated?: boolean }, direction: Direction, ctx: Ctx) {
  const cat = categorize(input, ctx.rules);
  if (cat == null || direction === 'debit') return cat;
  const kind = ctx.kinds.get(cat);
  return kind === 'self' || kind === 'investment' ? cat : null;
}

async function linkRefund(db: SQLiteDatabase, refundId: number, p: ParsedTxn) {
  const target = pickRefundTarget(p, (await refundCandidates(db, p)).filter((c) => c.id !== refundId));
  if (target != null) await setRefundOf(db, refundId, target);
}

async function processOne(db: SQLiteDatabase, c: RawCapture, ctx: Ctx, stats: ProcessStats) {
  const rawId = await insertRaw(db, { ...c, key: captureKey(c) });
  if (rawId == null) {
    stats.duplicates++;
    return;
  }
  return handleRaw(db, rawId, c, ctx, stats);
}

async function handleRaw(db: SQLiteDatabase, rawId: number, c: Pick<RawCapture, 'source' | 'sender' | 'body' | 'ts'>, ctx: Ctx, stats: ProcessStats) {
  const res = parseCapture(c.source, c.sender, c.body, c.ts);
  if (res.kind === 'ignored') {
    stats.ignored++;
    return setRawStatus(db, rawId, 'ignored', res.reason, null);
  }
  if (res.kind === 'unparsed') {
    stats.unparsed++;
    return setRawStatus(db, rawId, 'unparsed', null, null);
  }

  let p = res.txn;
  // Bank SMS cut names short ("Redbu"); use the full name from an earlier GPay capture when known.
  let truncated = false;
  if (p.source === 'sms' && p.counterparty && isTruncatedName(p.counterparty)) {
    const full = await resolveFullName(db, p.counterparty);
    if (full) p = { ...p, counterparty: full };
    else truncated = true;
  }

  const decision = decideMerge(p, await mergeCandidates(db, p));

  if (decision.action === 'duplicate') {
    stats.duplicates++;
    return setRawStatus(db, rawId, 'duplicate', null, decision.targetId);
  }

  if (decision.action === 'merge') {
    const target = await db.getFirstAsync<TxnRow>('SELECT * FROM transactions WHERE id = ?', decision.targetId);
    const patch = { ...decision.patch };
    // A better name arrived → re-run auto categorisation (never override the user's choice).
    if (target && target.category_source === 'auto' && (patch.counterparty || patch.vpa)) {
      const cat = autoCategory({ counterparty: patch.counterparty ?? target.counterparty, vpa: patch.vpa ?? target.vpa }, target.direction, ctx);
      if (cat != null) patch.category_id = cat;
    }
    await patchTxn(db, decision.targetId, patch);
    if (target && p.isRefund && target.direction === 'credit' && target.refund_of == null) await linkRefund(db, target.id, p);
    stats.merged++;
    return setRawStatus(db, rawId, 'txn', 'merged', decision.targetId);
  }

  const cat = autoCategory({ ...p, truncated }, p.direction, ctx);
  const id = await insertTxn(db, p, cat);
  if (p.direction === 'credit' && p.isRefund) await linkRefund(db, id, p);
  stats.inserted.push(id);
  return setRawStatus(db, rawId, 'txn', null, id);
}

export function processCaptures(db: SQLiteDatabase, captures: RawCapture[]): Promise<ProcessStats> {
  return serial(async () => {
    const stats: ProcessStats = { inserted: [], merged: 0, duplicates: 0, ignored: 0, unparsed: 0 };
    if (!captures.length) return stats;
    const ctx = await loadCtx(db);
    // oldest first so merges see the earlier half of a pair
    for (const c of [...captures].sort((a, b) => a.ts - b.ts)) {
      try {
        await processOne(db, c, ctx, stats);
      } catch (e) {
        console.warn('capture processing failed', e);
      }
    }
    return stats;
  });
}

/**
 * Bump when a parser/categoriser change should be applied to data already on the phone.
 * On the next launch: skipped messages are parsed again, auto categories are recomputed,
 * shortened SMS names are expanded, and refund credits are linked to their payments.
 */
export const PARSER_VERSION = 3;

export function reparseSkipped(db: SQLiteDatabase): Promise<ProcessStats | null> {
  return serial(async () => {
    if ((await getMeta(db, 'parser_version')) === String(PARSER_VERSION)) return null;
    const stats: ProcessStats = { inserted: [], merged: 0, duplicates: 0, ignored: 0, unparsed: 0 };
    const ctx = await loadCtx(db);

    // 1. Messages skipped by older parsers.
    const skipped = await db.getAllAsync<{ id: number; source: RawCapture['source']; sender: string; body: string; ts: number }>(
      "SELECT id, source, sender, body, ts FROM raw_events WHERE status IN ('ignored', 'unparsed') ORDER BY ts"
    );
    for (const r of skipped) {
      try {
        await handleRaw(db, r.id, r, ctx, stats);
      } catch (e) {
        console.warn('reparse failed', e);
      }
    }

    // 2. Expand short names and recompute automatic categories with today's rules.
    const auto = await db.getAllAsync<TxnRow>("SELECT * FROM transactions WHERE category_source = 'auto'");
    for (const t of auto) {
      try {
        let name = t.counterparty;
        let truncated = false;
        if (t.sources === 'sms' && isTruncatedName(name)) {
          const full = await resolveFullName(db, name!);
          if (full) name = full;
          else truncated = true;
        }
        const cat = autoCategory({ counterparty: name, vpa: t.vpa, truncated }, t.direction, ctx);
        if (name !== t.counterparty || (cat != null && cat !== t.category_id)) {
          await patchTxn(db, t.id, { counterparty: name, ...(cat != null ? { category_id: cat } : {}) });
        }
      } catch (e) {
        console.warn('recategorise failed', e);
      }
    }

    // 3. Link refund credits captured before refunds were understood.
    const credits = await db.getAllAsync<{ txn_id: number; source: RawCapture['source']; sender: string; body: string; ts: number }>(
      `SELECT r.txn_id, r.source, r.sender, r.body, r.ts FROM raw_events r JOIN transactions t ON t.id = r.txn_id
       WHERE r.status = 'txn' AND t.direction = 'credit' AND t.refund_of IS NULL`
    );
    for (const r of credits) {
      const res = parseCapture(r.source, r.sender, r.body, r.ts);
      if (res.kind === 'txn' && res.txn.isRefund) await linkRefund(db, r.txn_id, res.txn);
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
