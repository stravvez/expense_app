import { parseBankSms } from '../parsers/bankSms';
import { GPAY_PACKAGE, parsePaymentNotification } from '../parsers/gpayNotification';

const T = 1_762_400_000_000;

/**
 * Representative fixtures. Replace/add real (redacted) Union Bank SMS + GPay notifications
 * from your phone here — the Settings → "Needs review" screen shows any message that didn't parse.
 */
describe('Union Bank SMS', () => {
  it('parses the short "Dr ... by MB ... Fv." format', () => {
    const r = parseBankSms('JK-UNIONB-S', 'Union Bank of India A/c*6790 Dr Rs900.00 on 05-11-26 13:35 by MB 630912345678 Fv.Redbu, Bal Rs974.65 Not U?Call 18002082244/SMS BLOCK 6790 to 9223008486', T);
    expect(r.kind).toBe('txn');
    if (r.kind !== 'txn') return;
    expect(r.txn).toMatchObject({ amountPaise: 90000, direction: 'debit', upiRef: '630912345678', accountLast4: '6790', counterparty: 'Redbu', balancePaise: 97465 });
  });
  it('parses the "Debited ... Fvg:" format', () => {
    const r = parseBankSms('JM-UNIONB-T', 'Union Bank of India A/c *6790 Debited Rs:50.00 on 31-10-2026 01:11:28 by Mob Bk ref no 630412345678, Fvg: CHANDA D Avl Bal Rs:2967.65. Not you?Call 18002082244/SMS BLOCK 6790 to 9223008486', T);
    expect(r.kind).toBe('txn');
    if (r.kind !== 'txn') return;
    expect(r.txn).toMatchObject({ amountPaise: 5000, direction: 'debit', upiRef: '630412345678', counterparty: 'CHANDA D', balancePaise: 296765 });
  });
  it('parses a UPI debit', () => {
    const r = parseBankSms(
      'AD-UNIONB',
      'A/c *1234 Debited for Rs:250.00 on 06-11-2026 14:32:10 by Mob Bk ref no 630912345678 Avl Bal Rs:5,120.50.If not you, Fwd this SMS to 9223008486 to block UPI.-Union Bank of India',
      T
    );
    expect(r.kind).toBe('txn');
    if (r.kind !== 'txn') return;
    expect(r.txn).toMatchObject({ amountPaise: 25000, direction: 'debit', upiRef: '630912345678', accountLast4: '1234', balancePaise: 512050, ts: T });
  });

  it('parses a credit', () => {
    const r = parseBankSms('VM-UBOIIN', 'A/c *1234 Credited for Rs:1,500.00 on 06-11-2026 by Mob Bk ref no 630998765432 Avl Bal Rs:6620.50 -Union Bank of India', T);
    expect(r.kind === 'txn' && r.txn).toMatchObject({ amountPaise: 150000, direction: 'credit', upiRef: '630998765432' });
  });

  it('parses debit-and-credited-to style and VPA', () => {
    const r = parseBankSms(
      'JD-UNIONB',
      'Your a/c no. XXXXXXXX1234 is debited for Rs.99.00 on 06-11-26 and credited to swiggy@icici (UPI Ref no 630911112222).',
      T
    );
    expect(r.kind === 'txn' && r.txn).toMatchObject({ amountPaise: 9900, direction: 'debit', vpa: 'swiggy@icici', upiRef: '630911112222' });
  });

  it('ignores OTP and failed messages', () => {
    expect(parseBankSms('AD-UNIONB', '123456 is your OTP for UPI txn of Rs 500. Do not share.', T).kind).toBe('ignored');
    expect(parseBankSms('AD-UNIONB', 'UPI txn of Rs.200.00 from A/c *1234 has failed. Ref no 630900001111', T).kind).toBe('ignored');
  });

  it('ignores personal numbers and promos from other senders', () => {
    expect(parseBankSms('+919876543210', 'Paid Rs 500 to you, check a/c', T).kind).toBe('ignored');
    expect(parseBankSms('AX-SHOPPR', 'Get Rs.500 cashback upto on your first order! Click now', T).kind).toBe('ignored');
  });

  it('flags Union Bank messages it cannot understand as unparsed', () => {
    expect(parseBankSms('AD-UNIONB', 'Your A/c *1234 UPI limit changed today.', T).kind).toBe('unparsed');
  });
});

describe('GPay notifications', () => {
  it('parses "₹X paid to Y"', () => {
    const r = parsePaymentNotification(GPAY_PACKAGE, '₹250 paid to Swiggy\nUsing Union Bank of India ••1234', T);
    expect(r.kind === 'txn' && r.txn).toMatchObject({ amountPaise: 25000, direction: 'debit', counterparty: 'Swiggy' });
  });

  it('parses "Paid ₹X to Y"', () => {
    const r = parsePaymentNotification(GPAY_PACKAGE, 'Payment successful\nPaid ₹1,200.50 to Rahul Sharma', T);
    expect(r.kind === 'txn' && r.txn).toMatchObject({ amountPaise: 120050, direction: 'debit', counterparty: 'Rahul Sharma' });
  });

  it('parses received money', () => {
    const r = parsePaymentNotification(GPAY_PACKAGE, 'Priya paid you ₹300\nTap to see details', T);
    expect(r.kind === 'txn' && r.txn).toMatchObject({ amountPaise: 30000, direction: 'credit', counterparty: 'Priya' });
    const r2 = parsePaymentNotification(GPAY_PACKAGE, '₹300 received from Priya', T);
    expect(r2.kind === 'txn' && r2.txn).toMatchObject({ amountPaise: 30000, direction: 'credit', counterparty: 'Priya' });
  });

  it('ignores failed payments, requests and rewards', () => {
    expect(parsePaymentNotification(GPAY_PACKAGE, 'Payment to Swiggy failed\n₹250 will be refunded', T).kind).toBe('ignored');
    expect(parsePaymentNotification(GPAY_PACKAGE, 'Rahul requested ₹200', T).kind).toBe('ignored');
    expect(parsePaymentNotification(GPAY_PACKAGE, 'You won ₹10 cashback!', T).kind).toBe('ignored');
  });

  it('ignores other apps', () => {
    expect(parsePaymentNotification('com.whatsapp', '₹250 paid to Swiggy', T).kind).toBe('ignored');
  });
});
