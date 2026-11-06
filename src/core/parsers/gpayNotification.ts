import { toPaise } from '../money';
import type { ParseResult } from '../types';

export const GPAY_PACKAGE = 'com.google.android.apps.nbu.paisa.user';
export const UNION_BANK_APP = 'com.infrasoft.uboi';

const AMT = '(?:₹|rs\\.?|inr)\\s?([\\d,]+(?:\\.\\d{1,2})?)';
const NAME = '([^\\n₹]{1,60}?)';

/** Ordered patterns over "title\ntext". Each returns direction + amount group + name group. */
const PATTERNS: { re: RegExp; dir: 'debit' | 'credit'; amt: number; name: number }[] = [
  // "₹250 paid to Swiggy" / "₹250.00 sent to Rahul"
  { re: new RegExp(`${AMT}\\s+(?:paid|sent)\\s+to\\s+${NAME}(?:\\s*$|\\n|\\s+(?:using|via|from|on)\\b)`, 'im'), dir: 'debit', amt: 1, name: 2 },
  // "Paid ₹250 to Swiggy" / "You paid ₹250 to Swiggy"
  { re: new RegExp(`(?:you\\s+)?(?:paid|sent)\\s+${AMT}\\s+to\\s+${NAME}(?:\\s*$|\\n|\\s+(?:using|via|from|on)\\b)`, 'im'), dir: 'debit', amt: 1, name: 2 },
  // "Rahul paid you ₹500" / "Rahul sent you ₹500"
  { re: new RegExp(`^${NAME}\\s+(?:paid|sent)\\s+you\\s+${AMT}`, 'im'), dir: 'credit', amt: 2, name: 1 },
  // "Received ₹500 from Rahul" / "₹500 received from Rahul"
  { re: new RegExp(`(?:received\\s+${AMT}|${AMT}\\s+received)\\s+from\\s+${NAME}(?:\\s*$|\\n|\\s+(?:in|to|on)\\b)`, 'im'), dir: 'credit', amt: -1, name: 3 },
];

const IGNORE: [RegExp, string][] = [
  [/\b(failed|declined|unsuccessful|couldn'?t|could not|pending|processing|cancelled|expired)\b/i, 'failed'],
  [/\b(requested|request(?:ing)?\s+(?:money|₹)|is requesting|wants? ₹)\b/i, 'request'],
  [/\b(cashback|reward|scratch card|won|offer|voucher|coupon|refer)\b/i, 'promo'],
  [/\b(remind(?:er)?|due|bill is ready|recharge expir)/i, 'reminder'],
];

export function parsePaymentNotification(pkg: string, body: string, ts: number): ParseResult {
  if (pkg !== GPAY_PACKAGE && pkg !== UNION_BANK_APP) return { kind: 'ignored', reason: 'package' };
  const text = body.replace(/ /g, ' ').trim();

  for (const [re, reason] of IGNORE) if (re.test(text)) return { kind: 'ignored', reason };

  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    const amtStr = p.amt === -1 ? m[1] ?? m[2] : m[p.amt];
    const amountPaise = toPaise(amtStr);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) continue;
    const name = m[p.name]?.trim().replace(/[.!,]+$/, '');
    return {
      kind: 'txn',
      txn: {
        source: 'notif',
        amountPaise,
        direction: p.dir,
        ts,
        counterparty: name && !/^you$/i.test(name) ? name : undefined,
        vpa: name?.includes('@') ? name.toLowerCase() : undefined,
      },
    };
  }

  // Has an amount but no pattern matched → let the user look at it.
  return new RegExp(AMT, 'i').test(text) && /\b(paid|sent|received|payment)\b/i.test(text)
    ? { kind: 'unparsed' }
    : { kind: 'ignored', reason: 'not-txn' };
}
