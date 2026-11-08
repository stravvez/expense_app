import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, View } from 'react-native';
import { dueLabel, formatDay } from '../core/dates';
import { formatINR } from '../core/money';
import { detectRecurring } from '../core/recurring';
import { listCategories, recurringRows } from '../db/repo';
import { Body, Card, CategoryBadge, Empty, Muted, Row, Title, useData } from '../ui/components';
import { space, useTheme } from '../ui/theme';

const CADENCE: Record<string, string> = { weekly: 'every week', monthly: 'every month', quarterly: 'every 3 months', yearly: 'every year' };

export default function RecurringScreen() {
  const db = useSQLiteContext();
  const t = useTheme();
  const [data] = useData(async () => {
    const now = Date.now();
    const [rows, cats] = await Promise.all([recurringRows(db, now - 400 * 24 * 60 * 60 * 1000), listCategories(db)]);
    return { items: detectRecurring(rows, now), cats: new Map(cats.map((c) => [c.id, c])), now };
  });

  if (!data) return null;
  const { items, cats, now } = data;
  const monthly = items.reduce((a, r) => a + r.monthly, 0);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }}>
      <Card style={{ alignItems: 'center' }}>
        <Muted>Recurring payments cost about</Muted>
        <Title style={{ fontSize: 30 }}>{formatINR(monthly, { decimals: false })}</Title>
        <Muted>per month · {items.length} found</Muted>
      </Card>
      <Muted>
        Payments to the same payee on a steady schedule with a steady amount: subscriptions, rent, recharges, SIPs. Ones that stopped for two
        cycles drop off automatically.
      </Muted>
      {!items.length && <Empty title="Nothing recurring yet" hint="It needs at least 3 monthly (or 4 weekly) payments to the same payee." />}
      {items.map((r) => {
        const c = r.category_id != null ? cats.get(r.category_id) : undefined;
        const late = r.nextTs < now - 2 * 24 * 60 * 60 * 1000;
        return (
          <Card key={r.key} style={{ padding: space.md }} onPress={() => router.push({ pathname: '/transactions', params: { search: r.name } })}>
            <Row>
              <CategoryBadge icon={c?.icon} color={c?.color} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '600' }} numberOfLines={1}>
                  {r.name}
                </Body>
                <Muted>
                  {formatINR(r.amount, { decimals: false })} {CADENCE[r.cadence]} · {r.count} payments
                </Muted>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Body style={{ fontWeight: '700', color: late ? t.warning : t.text }}>{dueLabel(r.nextTs, now)}</Body>
                <Muted>last {formatDay(r.lastTs)}</Muted>
              </View>
            </Row>
          </Card>
        );
      })}
    </ScrollView>
  );
}
