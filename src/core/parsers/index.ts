import type { ParseResult } from '../types';
import { parseBankSms } from './bankSms';
import { parsePaymentNotification } from './gpayNotification';

export function parseCapture(source: 'sms' | 'notif', sender: string, body: string, ts: number): ParseResult {
  return source === 'sms' ? parseBankSms(sender, body, ts) : parsePaymentNotification(sender, body, ts);
}

export { parseBankSms, parsePaymentNotification };
