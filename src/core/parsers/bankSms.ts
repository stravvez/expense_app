import { toPaise } from '../money';
import type { Direction, ParseResult } from '../types';

/**
 * Bank SMS parser. Tuned for Union Bank of India alerts but written to tolerate the
 * common Indian bank formats, e.g.
 *   "A/c *1234 Debited for Rs:250.00 on 06-11-2026 14:32:10 by Mob Bk ref no 630912345678 Avl Bal Rs:5,000.00..."
 *   "Your a/c XXXXXX1234 is credited by Rs.500.00 on 06-11-26 by UPI ref no 630912345678"
 *   "Rs.250.00 debited from A/c XX1234 on 06-Nov-26 to VPA swiggy@icici UPI Ref 630912345678"
 */

/** Union Bank sender ids look like "AD-UNIONB", "VM-UBOIIN", "JD-UNIONB-S" */
export const UNION_BANK_SENDER = /(UNION|UBOI|UBINB|UBIN)/i;

/** Generic DLT sender id: two letters, dash, alnum header (no phone numbers). */
const DLT_SENDER = /^[A-Z]{2}-[A-Z0-9]{3,9}(-[A-Z])?$/i;

const AMOUNT = /(?:rs\.?|inr|₹)\s*[:.]?\s*([\d,]+(?:\.\d{1,2})?)/i;
const BALANCE = /(?:(?:avl\.?|available|avail\.?)\s*)?\b(?:bal(?:ance)?|bal\.?)\s*(?:is\s*)?(?:rs\.?|inr|₹)?\s*[:.]?\s*([\d,]+(?:\.\d{1,2})?)/i;
const ACCOUNT = /(?:a\/c|acct|account|ac)\s*(?:no\.?)?\s*[:.]?\s*[x*X.]*\s*(\d{3,6})\b/i;
/** Union Bank names the payee as "Fv.Redbu" or "Fvg: CHANDA D" (favouring). */
const FAVOURING = /\bfvg?\s*[.:]\s*([A-Za-z][A-Za-z0-9 .&'_-]{0,40}?)\s*(?=,|\bavl\b|\bbal\b|\bnot\b|$)/i;
const UPI_REF = /(?:upi\s*ref(?:erence)?|ref(?:erence)?|rrn|txn\s*id|utr|\bby\s+mb)\s*(?:no\.?|number|id)?\s*[:.]?\s*(\d{9,16})/i;
const VPA = /\b([a-z0-9][a-z0-9.\-_]{1,63}@[a-z][a-z0-9]{1,30})\b/i;

const DEBIT = /\b(debited|debit(?:ed)?\s+(?:for|by|with)|withdrawn|spent|paid|sent|dr\.?)\b/i;
const CREDIT = /\b(credited|credit(?:ed)?\s+(?:for|by|with)|received|deposited|cr\.?)\b/i;

const IGNORE: [RegExp, string][] = [
  [/\b(otp|one[\s-]?time\s+password|verification code)\b/i, 'otp'],
  [/\b(will be debited|due (?:on|by|date)|is due|auto[\s-]?pay.*(?:scheduled|registered)|mandate)\b/i, 'upcoming'],
  [/\b(failed|declined|unsuccessful|could not be|reversal pending)\b/i, 'failed'],
  [/\b(request(?:ed)?\s+(?:money|rs|inr|₹)|has requested|collect request)\b/i, 'request'],
  [/\b(offer|cashback upto|win|loan|pre[\s-]?approved|apply now|click)\b/i, 'promo'],
];

/** "to VPA x@y", "by Mr ABC", "from JOHN DOE" → counterparty text */
function extractCounterparty(body: string, direction: Direction): string | undefined {
  const fav = body.match(FAVOURING)?.[1]?.trim();
  if (fav) return fav;
  const patterns =
    direction === 'debit'
      ? [/\b(?:to|towards|trf to|transfer to|paid to)\s+(?:vpa\s+)?([A-Za-z][A-Za-z0-9 .&'@_-]{1,40}?)(?=\s+(?:on|ref|upi|via|avl|thru|\.|$)|[.,]|$)/i]
      : [/\b(?:from|by|trf from)\s+(?:vpa\s+)?([A-Za-z][A-Za-z0-9 .&'@_-]{1,40}?)(?=\s+(?:on|ref|upi|via|avl|thru|\.|$)|[.,]|$)/i];
  for (const p of patterns) {
    const m = body.match(p);
    if (!m) continue;
    const v = m[1].trim();
    // reject generic words that are not a party
    if (/^(mob\s*bk|mobile banking|upi|a\/c|your|account|neft|imps|rs|inr)\b/i.test(v)) continue;
    return v;
  }
  return undefined;
}

export function isBankSender(sender: string): boolean {
  return UNION_BANK_SENDER.test(sender) || DLT_SENDER.test(sender.trim());
}

export function parseBankSms(sender: string, body: string, ts: number): ParseResult {
  if (!isBankSender(sender)) return { kind: 'ignored', reason: 'sender' };
  const text = body.replace(/\s+/g, ' ').trim();

  for (const [re, reason] of IGNORE) if (re.test(text)) return { kind: 'ignored', reason };

  const amt = text.match(AMOUNT);
  const isDebit = DEBIT.test(text);
  const isCredit = CREDIT.test(text);
  if (!amt || (!isDebit && !isCredit)) {
    return UNION_BANK_SENDER.test(sender) && /(a\/c|upi)/i.test(text) ? { kind: 'unparsed' } : { kind: 'ignored', reason: 'not-txn' };
  }

  // Messages like "debited ... and credited to a/c" describe a debit for us.
  let direction: Direction;
  if (isDebit && isCredit) {
    const d = text.search(DEBIT);
    const c = text.search(CREDIT);
    direction = d <= c ? 'debit' : 'credit';
  } else direction = isDebit ? 'debit' : 'credit';

  // Non-Union senders must carry strong transaction evidence to avoid promos.
  const account = text.match(ACCOUNT)?.[1];
  const ref = text.match(UPI_REF)?.[1];
  if (!UNION_BANK_SENDER.test(sender) && !account && !ref) return { kind: 'ignored', reason: 'weak' };

  const amountPaise = toPaise(amt[1]);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) return { kind: 'unparsed' };

  const bal = text.match(BALANCE)?.[1];
  const vpa = text.match(VPA)?.[1]?.toLowerCase();
  let counterparty = extractCounterparty(text, direction);
  if (counterparty && vpa && counterparty.toLowerCase().includes(vpa)) counterparty = undefined;

  return {
    kind: 'txn',
    txn: {
      source: 'sms',
      amountPaise,
      direction,
      ts,
      upiRef: ref,
      accountLast4: account?.slice(-4),
      balancePaise: bal ? toPaise(bal) : undefined,
      vpa,
      counterparty: counterparty && !counterparty.includes('@') ? counterparty : undefined,
    },
  };
}
