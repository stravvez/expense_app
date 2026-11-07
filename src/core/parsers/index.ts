import type { ParseResult } from '../types';
import { parseBankSms } from './bankSms';
import { parsePaymentNotification } from './gpayNotification';
import { parseGPayScreen } from './gpayScreen';

export function parseCapture(source: 'sms' | 'notif' | 'screen', sender: string, body: string, ts: number): ParseResult {
  if (source === 'screen') return parseGPayScreen(body, ts);
  return source === 'sms' ? parseBankSms(sender, body, ts) : parsePaymentNotification(sender, body, ts);
}

export { parseBankSms, parseGPayScreen, parsePaymentNotification };
