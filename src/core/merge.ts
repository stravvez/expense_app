import type { ParsedTxn, TxnRow } from './types';

/** An SMS and a GPay notification for the same payment arrive within this window. */
export const MERGE_WINDOW_MS = 5 * 60 * 1000;

/** Two reads of the same GPay screen within this window are one payment. */
export const SCREEN_REPEAT_MS = 2 * 60 * 1000;

export type MergeDecision =
  | { action: 'insert' }
  | { action: 'merge'; targetId: number; patch: Partial<TxnRow> }
  | { action: 'duplicate'; targetId: number };

function hasSource(row: Pick<TxnRow, 'sources'>, s: string) {
  return row.sources.split(',').includes(s);
}

/**
 * Decide what to do with a freshly parsed capture, given candidate rows that share
 * its amount + direction within MERGE_WINDOW_MS (and any row with the same UPI ref).
 */
export function decideMerge(p: ParsedTxn, candidates: TxnRow[]): MergeDecision {
  // 1. Same UPI ref → same payment.
  if (p.upiRef) {
    const byRef = candidates.find((c) => c.upi_ref === p.upiRef);
    if (byRef) {
      return hasSource(byRef, p.source) ? { action: 'duplicate', targetId: byRef.id } : { action: 'merge', targetId: byRef.id, patch: patchFor(byRef, p) };
    }
  }

  // 2a. The GPay screen can be read twice for one payment (animation, re-opening it).
  if (p.source === 'screen') {
    const again = candidates.find(
      (c) => hasSource(c, 'screen') && c.amount_paise === p.amountPaise && c.direction === p.direction && Math.abs(c.ts - p.ts) <= SCREEN_REPEAT_MS && !(c.upi_ref && p.upiRef && c.upi_ref !== p.upiRef)
    );
    if (again) return p.upiRef && !again.upi_ref ? { action: 'merge', targetId: again.id, patch: patchFor(again, p) } : { action: 'duplicate', targetId: again.id };
  }

  // 2. Cross-source match (SMS ↔ notification), same amount & direction, closest in time.
  const matches = candidates
    .filter(
      (c) =>
        c.amount_paise === p.amountPaise &&
        c.direction === p.direction &&
        Math.abs(c.ts - p.ts) <= MERGE_WINDOW_MS &&
        !hasSource(c, p.source) &&
        !(c.upi_ref && p.upiRef && c.upi_ref !== p.upiRef)
    )
    .sort((a, b) => Math.abs(a.ts - p.ts) - Math.abs(b.ts - p.ts));

  if (matches[0]) return { action: 'merge', targetId: matches[0].id, patch: patchFor(matches[0], p) };

  // 3. Exact re-delivery of the same source (e.g. inbox backfill of an SMS already captured live).
  const same = candidates.find(
    (c) => hasSource(c, p.source) && c.amount_paise === p.amountPaise && c.direction === p.direction && c.ts === p.ts
  );
  if (same) return { action: 'duplicate', targetId: same.id };

  return { action: 'insert' };
}

function patchFor(row: TxnRow, p: ParsedTxn): Partial<TxnRow> {
  const patch: Partial<TxnRow> = { sources: [...new Set([...row.sources.split(',').filter(Boolean), p.source])].join(',') };
  // Notifications carry the human-readable name; SMS carry the ref/account. Prefer the notification's name.
  if (p.counterparty && (p.source === 'notif' || p.source === 'screen' || !row.counterparty)) patch.counterparty = p.counterparty;
  if (p.vpa && !row.vpa) patch.vpa = p.vpa;
  if (p.upiRef && !row.upi_ref) patch.upi_ref = p.upiRef;
  if (p.accountLast4 && !row.account_last4) patch.account_last4 = p.accountLast4;
  // Keep the earliest timestamp (the moment of payment).
  if (p.ts < row.ts) patch.ts = p.ts;
  return patch;
}
