import { normalizeParty } from './categorize';
import type { ParsedTxn, TxnRow } from './types';

/** How far back a refund may point. Merchant refunds can take weeks. */
export const REFUND_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

const REFUND_WORDS = /\b(refund(?:ed)?|reversal|reversed|reverted|chargeback)\b/i;

export function looksLikeRefund(text: string): boolean {
  return REFUND_WORDS.test(text);
}

/**
 * Pick the earlier debit that a refund credit pays back.
 * Candidates: debits before the refund, within REFUND_WINDOW_MS, not already refunded.
 * A match needs the same payee, or (without a payee) the exact amount within a week.
 */
export function pickRefundTarget(
  refund: Pick<ParsedTxn, 'amountPaise' | 'ts' | 'counterparty' | 'vpa'>,
  candidates: Pick<TxnRow, 'id' | 'ts' | 'amount_paise' | 'counterparty' | 'vpa'>[]
): number | null {
  const party = new Set([normalizeParty(refund.counterparty), normalizeParty(refund.vpa)].filter(Boolean));
  const scored = candidates
    .filter((c) => c.ts <= refund.ts && refund.ts - c.ts <= REFUND_WINDOW_MS && c.amount_paise >= refund.amountPaise)
    .map((c) => {
      const sameParty = [normalizeParty(c.counterparty), normalizeParty(c.vpa)].some((k) => k && party.has(k));
      const exact = c.amount_paise === refund.amountPaise;
      const recentExact = exact && refund.ts - c.ts <= 7 * 24 * 60 * 60 * 1000;
      if (!sameParty && !recentExact) return null;
      return { id: c.id, score: (sameParty ? 4 : 0) + (exact ? 2 : 0), age: refund.ts - c.ts };
    })
    .filter((x): x is { id: number; score: number; age: number } => x != null)
    .sort((a, b) => b.score - a.score || a.age - b.age);
  return scored[0]?.id ?? null;
}
