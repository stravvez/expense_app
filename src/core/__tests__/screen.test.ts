import { decideMerge } from '../merge';
import { parseGPayScreen, parseScreenDate } from '../parsers/gpayScreen';
import type { TxnRow } from '../types';

const NOW = new Date(2026, 10, 7, 20, 0).getTime();

const row = (o: Partial<TxnRow>): TxnRow => ({
  id: 1,
  ts: NOW,
  amount_paise: 100,
  direction: 'debit',
  counterparty: null,
  vpa: null,
  upi_ref: null,
  account_last4: null,
  category_id: null,
  category_source: 'auto',
  note: null,
  sources: 'screen',
  excluded: 0,
  ...o,
});

describe('GPay screen parser', () => {
  it('reads the live "Payment successful" screen', () => {
    const r = parseGPayScreen('₹1\nPaid to Rahul Sharma\nrahul@okaxis\nPayment successful\nUPI transaction ID\n631112345678\nDone', NOW);
    expect(r.kind).toBe('txn');
    if (r.kind !== 'txn') return;
    expect(r.txn).toMatchObject({ source: 'screen', amountPaise: 100, direction: 'debit', counterparty: 'Rahul Sharma', vpa: 'rahul@okaxis', upiRef: '631112345678', ts: NOW });
  });

  it('reads an old payment’s details page with its own date', () => {
    const r = parseGPayScreen(
      'To Redbus\n₹900\nCompleted\n5 Nov 2026, 1:35 pm\nFrom: Union Bank of India ••6790\nUPI transaction ID: 630912345678\nGoogle transaction ID: CICAgOD1234',
      NOW
    );
    expect(r.kind).toBe('txn');
    if (r.kind !== 'txn') return;
    expect(r.txn).toMatchObject({ amountPaise: 90000, direction: 'debit', counterparty: 'Redbus', upiRef: '630912345678', ts: new Date(2026, 10, 5, 13, 35).getTime() });
  });

  it('reads received money', () => {
    const r = parseGPayScreen('Received from Amit\n₹250\nCompleted\nNov 3, 2026 9:05 AM\nUPI transaction ID 630712345678', NOW);
    expect(r.kind).toBe('txn');
    if (r.kind !== 'txn') return;
    expect(r.txn).toMatchObject({ amountPaise: 25000, direction: 'credit', counterparty: 'Amit' });
  });

  it('ignores failed, pending and list screens', () => {
    expect(parseGPayScreen('₹50\nPayment failed\nUPI transaction ID 630712345678', NOW).kind).toBe('ignored');
    expect(parseGPayScreen('₹50\nPayment pending', NOW).kind).toBe('ignored');
    expect(parseGPayScreen('Rahul\n₹50 Paid\nAmit\n₹20 Received\nCompleted', NOW).kind).toBe('ignored');
    expect(parseGPayScreen('Pay ₹50\nEnter amount', NOW).kind).toBe('ignored');
  });

  it('sends undated old details pages to review instead of guessing the day', () => {
    expect(parseGPayScreen('To Redbus\n₹900\nCompleted\nUPI transaction ID: 630912345678', NOW).kind).toBe('unparsed');
  });

  it('parses common date formats', () => {
    expect(parseScreenDate('05 Nov 2026 13:35')).toBe(new Date(2026, 10, 5, 13, 35).getTime());
    expect(parseScreenDate('12 Nov 2026, 12:10 am')).toBe(new Date(2026, 10, 12, 0, 10).getTime());
  });
});

describe('merging GPay screen captures', () => {
  const screen = { source: 'screen' as const, amountPaise: 100, direction: 'debit' as const, ts: NOW + 30_000 };

  it('treats a second read of the same screen as a duplicate', () => {
    expect(decideMerge(screen, [row({})]).action).toBe('duplicate');
  });

  it('merges a screen capture into the bank SMS by UPI ref', () => {
    const d = decideMerge({ ...screen, upiRef: '631112345678', counterparty: 'Rahul' }, [row({ sources: 'sms', upi_ref: '631112345678' })]);
    expect(d).toMatchObject({ action: 'merge', patch: { counterparty: 'Rahul', sources: 'sms,screen' } });
  });

  it('merges with the SMS by amount and time when there is no ref', () => {
    expect(decideMerge(screen, [row({ sources: 'sms' })]).action).toBe('merge');
  });
});
