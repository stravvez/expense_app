import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { formatTime } from '../core/dates';
import type { TxnView } from '../db/repo';
import { Amount, Body, CategoryBadge, Muted } from './components';
import { space, useTheme } from './theme';

export function TxnItem({ t }: { t: TxnView }) {
  const theme = useTheme();
  const name = t.counterparty ?? t.vpa ?? (t.direction === 'credit' ? 'Money received' : 'Payment');
  const sub = [
    formatTime(t.ts),
    t.direction === 'credit' ? 'Received' : t.category_name ?? 'Uncategorized',
    t.has_split ? `Split · your share ${(t.my_share_paise / 100).toFixed(0)}` : null,
    t.excluded ? 'Excluded' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={() => router.push(`/transaction/${t.id}`)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}
    >
      <CategoryBadge icon={t.direction === 'credit' ? '⬇️' : t.category_icon} color={t.direction === 'credit' ? theme.success : t.category_color} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body numberOfLines={1} style={{ fontWeight: '600' }}>
          {name}
        </Body>
        <Muted numberOfLines={1} style={!t.category_name && t.direction === 'debit' ? { color: theme.warning } : undefined}>
          {sub}
        </Muted>
      </View>
      <Amount paise={t.amount_paise} direction={t.direction} style={t.excluded ? { opacity: 0.4 } : undefined} />
    </Pressable>
  );
}
