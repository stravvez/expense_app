import { categorize, normalizeParty, type RuleRow } from '../categorize';
import { decideMerge, MERGE_WINDOW_MS } from '../merge';
import { computeBalances, computeShares, myShareOf } from '../splits';
import type { ParsedTxn, TxnRow } from '../types';

const T = 1_762_400_000_000;
const row = (o: Partial<TxnRow>): TxnRow => ({
  id: 1, ts: T, amount_paise: 25000, direction: 'debit', counterparty: null, vpa: null, upi_ref: null,
  account_last4: null, category_id: null, category_source: 'auto', note: null, sources: 'sms', excluded: 0, ...o,
});
const parsed = (o: Partial<ParsedTxn>): ParsedTxn => ({ source: 'notif', amountPaise: 25000, direction: 'debit', ts: T + 2000, ...o });

describe('merge', () => {
  it('merges GPay notification into the matching SMS and takes the readable name', () => {
    const d = decideMerge(parsed({ counterparty: 'Swiggy' }), [row({ upi_ref: '6309', counterparty: 'Mob Bk' })]);
    expect(d).toEqual({ action: 'merge', targetId: 1, patch: { sources: 'sms,notif', counterparty: 'Swiggy' } });
  });

  it('dedupes by UPI ref', () => {
    expect(decideMerge(parsed({ source: 'sms', upiRef: '6309' }), [row({ upi_ref: '6309' })])).toEqual({ action: 'duplicate', targetId: 1 });
  });

  it('does not merge outside the window, different amount, or same source', () => {
    expect(decideMerge(parsed({ ts: T + MERGE_WINDOW_MS + 1 }), [row({})]).action).toBe('insert');
    expect(decideMerge(parsed({ amountPaise: 25100 }), [row({})]).action).toBe('insert');
    // two separate ₹250 SMS a minute apart are two payments
    expect(decideMerge(parsed({ source: 'sms', ts: T + 60000 }), [row({})]).action).toBe('insert');
  });

  it('treats an identical re-delivered SMS (inbox backfill) as duplicate', () => {
    expect(decideMerge(parsed({ source: 'sms', ts: T }), [row({})])).toEqual({ action: 'duplicate', targetId: 1 });
  });
});

describe('categorize', () => {
  const rules: RuleRow[] = [
    { match_type: 'keyword', pattern: 'swiggy', category_id: 1, origin: 'default' },
    { match_type: 'keyword', pattern: 'ola', category_id: 3, origin: 'default' },
    { match_type: 'exact', pattern: 'swiggy instamart', category_id: 2, origin: 'learned' },
  ];
  it('normalises names', () => {
    expect(normalizeParty('Swiggy Pvt Ltd')).toBe('swiggy');
    expect(normalizeParty('swiggy.upi@axisbank')).toBe('swiggy upi');
  });
  it('learned exact rule beats keyword', () => {
    expect(categorize({ counterparty: 'Swiggy Instamart' }, rules)).toBe(2);
    expect(categorize({ counterparty: 'Swiggy' }, rules)).toBe(1);
  });
  it('uses vpa and word boundaries', () => {
    expect(categorize({ vpa: 'ola.money@axis' }, rules)).toBe(3);
    expect(categorize({ counterparty: 'Coca Cola Store' }, rules)).toBeNull();
  });
});

describe('splits', () => {
  it('splits equally with leftover paisa to me', () => {
    const r = computeShares(10000, 'equal', [null, 1, 2]);
    expect(r.ok && r.shares).toEqual([
      { personId: null, sharePaise: 3334 },
      { personId: 1, sharePaise: 3333 },
      { personId: 2, sharePaise: 3333 },
    ]);
  });
  it('validates exact and percent', () => {
    expect(computeShares(10000, 'exact', [null, 1], new Map([[null, 4000], [1, 5000]])).ok).toBe(false);
    const p = computeShares(999, 'percent', [null, 1], new Map([[null, 50], [1, 50]]));
    expect(p.ok && p.shares.map((s) => s.sharePaise)).toEqual([500, 499]);
  });
  it('computes balances with settlements', () => {
    const b = computeBalances(
      [
        { payerPersonId: null, shares: [{ personId: null, sharePaise: 3334 }, { personId: 1, sharePaise: 3333 }, { personId: 2, sharePaise: 3333 }] },
        { payerPersonId: 1, shares: [{ personId: null, sharePaise: 1000 }, { personId: 1, sharePaise: 1000 }] },
      ],
      [{ personId: 2, amountPaise: 3333, direction: 'in' }]
    );
    expect(b.get(1)).toBe(2333);
    expect(b.get(2)).toBe(0);
  });
  it('counts only my share as spend', () => {
    expect(myShareOf(10000, undefined)).toBe(10000);
    expect(myShareOf(10000, { payerPersonId: null, shares: [{ personId: null, sharePaise: 2500 }, { personId: 1, sharePaise: 7500 }] })).toBe(2500);
  });
});
