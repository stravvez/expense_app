export type Direction = 'debit' | 'credit';
export type CaptureSource = 'sms' | 'notif' | 'manual';

/** Normalised result of parsing one SMS or notification. */
export type ParsedTxn = {
  source: CaptureSource;
  amountPaise: number;
  direction: Direction;
  ts: number;
  counterparty?: string;
  vpa?: string;
  upiRef?: string;
  accountLast4?: string;
  balancePaise?: number;
};

export type ParseResult =
  | { kind: 'txn'; txn: ParsedTxn }
  /** recognised but intentionally not a transaction (OTP, promo, failed payment, …) */
  | { kind: 'ignored'; reason: string }
  /** looked financial but no parser understood it → shown under "Needs review" */
  | { kind: 'unparsed' };

export type TxnRow = {
  id: number;
  ts: number;
  amount_paise: number;
  direction: Direction;
  counterparty: string | null;
  vpa: string | null;
  upi_ref: string | null;
  account_last4: string | null;
  category_id: number | null;
  category_source: 'auto' | 'user';
  note: string | null;
  sources: string;
  excluded: number;
};
