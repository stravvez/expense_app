import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * "Spend" = what things cost me:
 *  • each debit in a spending category (investments / self-transfers are money moved, not spent):
 *    my share if it was split, else the full amount;
 *  • minus refunds, booked against the original payment's category on the refund's date;
 *  • plus my share of bills a friend paid (splits without a transaction).
 * Excluded transactions are skipped.
 */
const SPEND_ROWS = `
  SELECT t.ts AS ts, t.category_id AS category_id, t.counterparty AS counterparty, t.vpa AS vpa,
    CASE WHEN s.id IS NULL THEN t.amount_paise
         ELSE COALESCE((SELECT share_paise FROM split_shares WHERE split_id = s.id AND person_id IS NULL), 0) END AS amount
  FROM transactions t
  LEFT JOIN splits s ON s.transaction_id = t.id
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.direction = 'debit' AND t.excluded = 0 AND COALESCE(c.kind, 'spend') = 'spend'
  UNION ALL
  SELECT r.ts, o.category_id, o.counterparty, o.vpa, -r.amount_paise
  FROM transactions r
  JOIN transactions o ON o.id = r.refund_of
  LEFT JOIN categories c ON c.id = o.category_id
  WHERE r.direction = 'credit' AND r.excluded = 0 AND o.excluded = 0 AND COALESCE(c.kind, 'spend') = 'spend'
  UNION ALL
  SELECT s.ts, s.category_id, s.description, NULL,
    COALESCE((SELECT share_paise FROM split_shares WHERE split_id = s.id AND person_id IS NULL), 0)
  FROM splits s LEFT JOIN categories c ON c.id = s.category_id
  WHERE s.transaction_id IS NULL AND s.payer_person_id IS NOT NULL AND COALESCE(c.kind, 'spend') = 'spend'`;

export type Summary = { spent: number; received: number; count: number; uncategorized: number; invested: number; refunded: number };

export async function monthSummary(db: SQLiteDatabase, from: number, to: number): Promise<Summary> {
  const spent = await db.getFirstAsync<{ v: number; n: number; u: number; rf: number }>(
    `SELECT COALESCE(SUM(amount),0) AS v,
            SUM(CASE WHEN amount > 0 THEN 1 ELSE 0 END) AS n,
            SUM(CASE WHEN category_id IS NULL AND amount > 0 THEN 1 ELSE 0 END) AS u,
            COALESCE(-SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS rf
     FROM (${SPEND_ROWS}) WHERE ts >= ? AND ts < ?`,
    from, to
  );
  // Income excludes friends paying back, refunds, and money from your own accounts / investments.
  const recv = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(t.amount_paise),0) AS v FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.direction = 'credit' AND t.excluded = 0 AND t.ts >= ? AND t.ts < ?
       AND t.refund_of IS NULL AND COALESCE(c.kind, 'spend') = 'spend'
       AND NOT EXISTS (SELECT 1 FROM settlements st WHERE st.transaction_id = t.id)`,
    from, to
  );
  const inv = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(t.amount_paise),0) AS v FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.direction = 'debit' AND t.excluded = 0 AND c.kind = 'investment' AND t.ts >= ? AND t.ts < ?`,
    from, to
  );
  return {
    spent: spent?.v ?? 0,
    count: spent?.n ?? 0,
    uncategorized: spent?.u ?? 0,
    refunded: spent?.rf ?? 0,
    received: recv?.v ?? 0,
    invested: inv?.v ?? 0,
  };
}


export type CategorySpend = { category_id: number | null; name: string; icon: string; color: string; budget_paise: number; spent: number };

export async function spendByCategory(db: SQLiteDatabase, from: number, to: number) {
  return db.getAllAsync<CategorySpend>(
    `SELECT c.id AS category_id, COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.icon, '❓') AS icon,
            COALESCE(c.color, '#ADB5BD') AS color, COALESCE(c.budget_paise, 0) AS budget_paise, COALESCE(x.spent, 0) AS spent
     FROM (SELECT category_id, MAX(SUM(amount), 0) AS spent FROM (${SPEND_ROWS}) WHERE ts >= ? AND ts < ? GROUP BY category_id) x
     LEFT JOIN categories c ON c.id = x.category_id
     UNION ALL
     SELECT c.id, c.name, c.icon, c.color, c.budget_paise, 0 FROM categories c
     WHERE c.budget_paise > 0 AND c.kind = 'spend' AND c.id NOT IN (SELECT category_id FROM (${SPEND_ROWS}) WHERE ts >= ? AND ts < ? AND category_id IS NOT NULL)
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
