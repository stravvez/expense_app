import { toPaise } from '../money';
import type { Direction, ParseResult } from '../types';

/**
 * Parser for the visible text of Google Pay screens, read by the accessibility service
 * (one view's text per line). Two screens matter:
 *   • the "Payment successful" screen right after paying → timestamp = when it was seen
 *   • a payment's details page (opened from history) → timestamp read from the page
 * The UPI transaction ID on these screens is the same number as the bank SMS "ref no",
 * so both merge into one transaction.
 */

const AMOUNT = /₹\s?([\d,]+(?:\.\d{1,2})?)/g;
const REF = /(?:upi\s*transaction\s*id|upi\s*ref(?:erence)?(?:\s*no\.?)?|utr)\s*[:\-]?\s*(\d{10,16})/i;
const VPA = /\b([a-z0-9][a-z0-9.\-_]{1,63}@[a-z][a-z0-9]{1,30})\b/i;
const SUCCESS = /\b(payment successful|paid successfully|sent successfully|successful|completed)\b/i;
const FAILED = /\b(failed|declined|unsuccessful|pending|processing|cancelled|expired|reversed|refund(?:ed)? to)\b/i;
const CREDIT = /\b(received from|paid you|sent you|money received|received)\b/i;
const DEBIT = /\b(paid to|sent to|payment to|paid|sent)\b/i;

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "5 Nov 2026, 1:35 pm", "Nov 5, 2026 1:35 PM", "05 Nov 2026 13:35" → epoch ms (device time zone). */
export function parseScreenDate(text: string): number | undefined {
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
  const time = '(?:,?\\s*(?:at\\s*)?(\\d{1,2}):(\\d{2})\\s*(am|pm)?)?';
  const dmy = new RegExp(`\\b(\\d{1,2})\\s+${mon}\\.?,?\\s+(\\d{4})${time}`, 'i');
  const mdy = new RegExp(`\\b${mon}\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})${time}`, 'i');
  let d: number, m: number, y: number, h = 12, mi = 0, ap: string | undefined;
  let r = text.match(dmy);
  if (r) {
    [d, m, y] = [Number(r[1]), MONTHS[r[2].slice(0, 3).toLowerCase()], Number(r[3])];
    [h, mi, ap] = r[4] ? [Number(r[4]), Number(r[5]), r[6]] : [12, 0, undefined];
  } else if ((r = text.match(mdy))) {
    [m, d, y] = [MONTHS[r[1].slice(0, 3).toLowerCase()], Number(r[2]), Number(r[3])];
    [h, mi, ap] = r[4] ? [Number(r[4]), Number(r[5]), r[6]] : [12, 0, undefined];
  } else return undefined;
  if (ap) {
    const pm = ap.toLowerCase() === 'pm';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  const ts = new Date(y, m, d, h, mi).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

function lineAfter(lines: string[], label: RegExp): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const inline = lines[i].match(new RegExp(`^${label.source}\\s*:?\\s+(.+)$`, 'i'));
    if (inline) return inline[1];
    if (new RegExp(`^${label.source}\\s*:?$`, 'i').test(lines[i]) && lines[i + 1]) return lines[i + 1];
  }
  return undefined;
}

function cleanName(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.replace(/[.!,]+$/, '').trim();
  if (!s || s.length > 60 || /₹|\d{6,}|\b(bank|a\/c|account|you|your|xx)\b|•/i.test(s)) return undefined;
  return s;
}

export function parseGPayScreen(text: string, seenAt: number): ParseResult {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const flat = lines.join('\n');

  if (FAILED.test(flat)) return { kind: 'ignored', reason: 'failed' };

  const ref = flat.match(REF)?.[1];
  const success = SUCCESS.test(flat);
  // Lists/chats show many amounts and no transaction id: not a single payment.
  if (!ref && !success) return { kind: 'ignored', reason: 'not-payment-screen' };

  const amounts = [...flat.matchAll(AMOUNT)].map((m) => toPaise(m[1])).filter((p) => Number.isFinite(p) && p > 0);
  if (!amounts.length) return { kind: 'unparsed' };
  if (!ref && new Set(amounts).size > 1) return { kind: 'ignored', reason: 'list' };
  const amountPaise = amounts[0];

  let direction: Direction;
  if (/\b(received from|paid you|sent you|money received)\b/i.test(flat)) direction = 'credit';
  else if (/\b(paid to|sent to|payment to)\b/i.test(flat) || /^to\b/im.test(flat)) direction = 'debit';
  else if (CREDIT.test(flat) && !DEBIT.test(flat)) direction = 'credit';
  else if (DEBIT.test(flat) || success) direction = 'debit';
  else return { kind: 'unparsed' };

  const counterparty =
    direction === 'debit'
      ? cleanName(flat.match(/\b(?:paid|sent)\s+to\s*:?\s*([^\n₹]{2,60})/i)?.[1] ?? lineAfter(lines, /to/))
      : cleanName(flat.match(/\breceived\s+from\s*:?\s*([^\n₹]{2,60})/i)?.[1] ?? flat.match(/^([^\n₹]{2,60}?)\s+(?:paid|sent)\s+you\b/im)?.[1] ?? lineAfter(lines, /from/));

  // Details page of an old payment carries its own date; the success screen is "now".
  const dated = parseScreenDate(flat);
  // Without a date, only a live "…successful" screen can be stamped with the time it was seen;
  // an undated details page of an old payment would get the wrong day → let the user review it.
  if (dated == null && !/\bsuccessful(?:ly)?\b/i.test(flat)) return { kind: 'unparsed' };
  const ts = dated != null && dated <= seenAt + 60_000 ? dated : seenAt;

  return {
    kind: 'txn',
    txn: {
      source: 'screen',
      amountPaise,
      direction,
      ts,
      upiRef: ref,
      vpa: flat.match(VPA)?.[1]?.toLowerCase(),
      counterparty,
    },
  };
}
