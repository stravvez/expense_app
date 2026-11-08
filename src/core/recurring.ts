import { normalizeParty } from './categorize';

export type RecurringInput = { ts: number; amount: number; counterparty: string | null; vpa: string | null; category_id: number | null };

export type Recurring = {
  key: string;
  name: string;
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  /** typical amount, paise */
  amount: number;
  /** cost normalised to one month, paise */
  monthly: number;
  count: number;
  lastTs: number;
  nextTs: number;
  category_id: number | null;
};

const DAY = 24 * 60 * 60 * 1000;
const CADENCES: { cadence: Recurring['cadence']; days: number; tol: number; perMonth: number; min: number }[] = [
  { cadence: 'weekly', days: 7, tol: 2, perMonth: 30 / 7, min: 4 },
  { cadence: 'monthly', days: 30.4, tol: 5, perMonth: 1, min: 3 },
  { cadence: 'quarterly', days: 91, tol: 10, perMonth: 1 / 3, min: 3 },
  { cadence: 'yearly', days: 365, tol: 20, perMonth: 1 / 12, min: 2 },
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Finds payments that repeat on a steady schedule with a steady amount (subscriptions, rent,
 * recharges, SIPs). A payee qualifies when most gaps between payments match one cadence and
 * amounts stay within ±20% of the typical amount. Payments that stopped are dropped.
 */
export function detectRecurring(rows: RecurringInput[], now: number): Recurring[] {
  const groups = new Map<string, RecurringInput[]>();
  for (const r of rows) {
    const key = normalizeParty(r.counterparty) || normalizeParty(r.vpa);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.ts - b.ts);
    // Several payments on one day (e.g. split bill) count once.
    const days: RecurringInput[] = [];
    for (const r of list) if (!days.length || r.ts - days[days.length - 1].ts > DAY) days.push(r);
    if (days.length < 2) continue;

    const gaps = days.slice(1).map((r, i) => (r.ts - days[i].ts) / DAY);
    const typicalGap = median(gaps);
    const c = CADENCES.find((x) => Math.abs(typicalGap - x.days) <= x.tol);
    if (!c || days.length < c.min) continue;
    const onBeat = gaps.filter((g) => Math.abs(g - c.days) <= c.tol).length;
    if (onBeat / gaps.length < 0.6) continue;

    const amount = median(days.map((r) => r.amount));
    const steady = days.filter((r) => Math.abs(r.amount - amount) <= amount * 0.2).length;
    if (steady / days.length < 0.75) continue;

    const last = days[days.length - 1];
    // Stopped: more than two cycles since the last payment.
    if (now - last.ts > (c.days * 2 + c.tol) * DAY) continue;

    out.push({
      key,
      name: last.counterparty ?? last.vpa ?? key,
      cadence: c.cadence,
      amount: Math.round(amount),
      monthly: Math.round(amount * c.perMonth),
      count: days.length,
      lastTs: last.ts,
      nextTs: last.ts + Math.round(c.days * DAY),
      category_id: last.category_id,
    });
  }
  return out.sort((a, b) => a.nextTs - b.nextTs);
}
