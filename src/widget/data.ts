import * as SQLite from 'expo-sqlite';
import { monthLabel, monthRange, startOfMonth } from '../core/dates';
import { formatINR } from '../core/money';
import { monthSummary } from '../db/analytics';
import { DB_NAME, migrate } from '../db/schema';
import type { MonthSpendData } from './MonthSpendWidget';

/**
 * Reads the numbers the widget shows. Runs both inside the app and headless (the widget can update
 * while the app is closed), so it opens the database itself. expo-sqlite shares the native
 * connection by default, so this connection is never closed: closing it would close the app's too.
 */
export async function loadMonthSpend(now = new Date()): Promise<MonthSpendData> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await migrate(db);
  const [from, to] = monthRange(startOfMonth(now));
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [month, today] = await Promise.all([monthSummary(db, from, to), monthSummary(db, dayStart, to)]);
  return {
    month: monthLabel(now),
    spent: formatINR(month.spent, { decimals: false }),
    today: formatINR(today.spent, { decimals: false }),
    count: month.count,
  };
}
