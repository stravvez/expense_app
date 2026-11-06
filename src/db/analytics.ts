import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * "Spend" = what things cost me: for each debit, my share if it was split, else the full amount;
 * plus my share of bills a friend paid (splits without a transaction). Excluded txns are skipped.
 */
const SPEND_ROWS = `
  SELECT t.ts AS ts, t.category_id AS category_id, t.counterparty AS counterparty, t.vpa AS vpa,
    CASE WHEN s.id IS NULL THEN t.amount_paise
         ELSE COALESCE((SELECT share_paise FROM split_shares WHERE split_id = s.id AND person_id IS NULL), 0) END AS amount
  FROM transactions t LEFT JOIN splits s ON s.transaction_id = t.id
  WHERE t.direction = 'debit' AND t.excluded = 0
  UNION ALL
  SELECT s.ts, s.category_id, s.description, NULL,
    COALESCE((SELECT share_paise FROM split_shares WHERE split_id = s.id AND person_id IS NULL), 0)
  FROM splits s WHERE s.transaction_id IS NULL AND s.payer_person_id IS NOT NULL`;

export type Summary = { spent: number; received: number; count: number; uncategorized: number };

export async function monthSummary(db: SQLiteDatabase, from: number, to: number): Promise<Summary> {
  const spent = await db.getFirstAsync<{ v: number; n: number; u: number }>(
    `SELECT COALESCE(SUM(amount),0) AS v, COUNT(*) AS n, SUM(CASE WHEN category_id IS NULL THEN 1 ELSE 0 END) AS u
     FROM (${SPEND_ROWS}) WHERE ts >= ? AND ts < ?`,
    from, to
  );
  // Settlements (friends paying back) are not "income"
  const recv = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(amount_paise),0) AS v FROM transactions t
     WHERE direction = 'credit' AND excluded = 0 AND ts >= ? AND ts < ?
       AND NOT EXISTS (SELECT 1 FROM settlements st WHERE st.transaction_id = t.id)`,
    from, to
  );
  return { spent: spent?.v ?? 0, count: spent?.n ?? 0, uncategorized: spent?.u ?? 0, received: recv?.v ?? 0 };
}

export type CategorySpend = { category_id: number | null; name: string; icon: string; color: string; budget_paise: number; spent: number };

export async function spendByCategory(db: SQLiteDatabase, from: number, to: number) {
  return db.getAllAsync<CategorySpend>(
    `SELECT c.id AS category_id, COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.icon, '❓') AS icon,
            COALESCE(c.color, '#ADB5BD') AS color, COALESCE(c.budget_paise, 0) AS budget_paise, COALESCE(x.spent, 0) AS spent
     FROM (SELECT category_id, SUM(amount) AS spent FROM (${SPEND_ROWS}) WHERE ts >= ? AND ts < ? GROUP BY category_id) x
     LEFT JOIN categories c ON c.id = x.category_id
     UNION ALL
     SELECT c.id, c.name, c.icon, c.color, c.budget_paise, 0 FROM categories c
     WHERE c.budget_paise > 0 AND c.id NOT IN (SELECT category_id FROM (${SPEND_ROWS}) WHERE ts >= ? AND ts < ? AND category_id IS NOT NULL)
     ORDER BY spent DESC`,
    from, to, from, to
  );
}

/** Raw spend rows in range; bucketing by local day/month happens in JS (device timezone). */
export function spendRows(db: SQLiteDatabase, from: number, to: number) {
  return db.getAllAsync<{ ts: number; amount: number }>(`SELECT ts, amount FROM (${SPEND_ROWS}) WHERE ts >= ? AND ts < ?`, from, to);
}

export function topMerchants(db: SQLiteDatabase, from: number, to: number, limit = 5) {
  return db.getAllAsync<{ name: string; spent: number; n: number }>(
    `SELECT COALESCE(counterparty, vpa, 'Unknown') AS name, SUM(amount) AS spent, COUNT(*) AS n
     FROM (${SPEND_ROWS}) WHERE ts >= ? AND ts < ? GROUP BY LOWER(COALESCE(counterparty, vpa, 'Unknown'))
     ORDER BY spent DESC LIMIT ?`,
    from, to, limit
  );
}
