import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { formatINR } from '../core/money';
import { getMeta, getTxn } from '../db/repo';

export const ALERT_CHANNEL = 'captured';

export async function setupAlerts() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
    name: 'Captured expenses',
    importance: AndroidImportance.DEFAULT,
  });
}

/** One local notification per newly captured debit (summarised when there are many). */
export async function alertNewTransactions(db: SQLiteDatabase, ids: number[]) {
  if ((await getMeta(db, 'alerts')) === 'off') return;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;

  const txns = (await Promise.all(ids.map((id) => getTxn(db, id)))).filter((t) => t && t.direction === 'debit');
  if (!txns.length) return;

  if (txns.length > 3) {
    const total = txns.reduce((a, t) => a + t!.amount_paise, 0);
    await Notifications.scheduleNotificationAsync({
      content: { title: `${txns.length} new expenses captured`, body: `${formatINR(total)} total. Tap to review.`, data: { url: '/transactions' } },
      trigger: { channelId: ALERT_CHANNEL },
    });
    return;
  }
  for (const t of txns) {
    const who = t!.counterparty ?? t!.vpa ?? 'Unknown';
    const cat = t!.category_name ? `${t!.category_icon} ${t!.category_name}` : 'Uncategorized. Tap to pick a category';
    await Notifications.scheduleNotificationAsync({
      content: { title: `${formatINR(t!.amount_paise)} to ${who}`, body: `${cat} · Tap to edit or split`, data: { url: `/transaction/${t!.id}` } },
      trigger: { channelId: ALERT_CHANNEL },
    });
  }
}
