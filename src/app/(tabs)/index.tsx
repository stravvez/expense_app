import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { BarChart, PieChart } from 'react-native-gifted-charts';
import TxnCapture from '../../../modules/txn-capture';
import { addMonths, daysInMonth, monthLabel, monthRange } from '../../core/dates';
import { formatINR, formatINRCompact } from '../../core/money';
import { computeBalances } from '../../core/splits';
import { monthSummary, spendByCategory, spendRows, topMerchants } from '../../db/analytics';
import { allSettlements, allSplitRecords, countRaw } from '../../db/repo';
import { useApp } from '../../state/store';
import { Body, Card, Muted, ProgressBar, Row, Title, useData } from '../../ui/components';
import { OTHER_COLOR, space, useSeriesColor, useTheme } from '../../ui/theme';

export default function Dashboard() {
  const db = useSQLiteContext();
  const t = useTheme();
  const series = useSeriesColor();
  const { width } = useWindowDimensions();
  const month = useApp((s) => s.month);
  const setMonth = useApp((s) => s.setMonth);
  const [selDay, setSelDay] = useState<number | null>(null);
  const [selMonth, setSelMonth] = useState<number | null>(null);

  const [data] = useData(async () => {
    const [from, to] = monthRange(month);
    const [prevFrom] = monthRange(addMonths(month, -1));
    const trendFrom = addMonths(month, -5).getTime();
    const [summary, prev, cats, rows, trendRows, merchants, splits, settlements, review] = await Promise.all([
      monthSummary(db, from, to),
      monthSummary(db, prevFrom, from),
      spendByCategory(db, from, to),
      spendRows(db, from, to),
      spendRows(db, trendFrom, to),
      topMerchants(db, from, to),
      allSplitRecords(db),
      allSettlements(db),
      countRaw(db, 'unparsed'),
    ]);
    const balances = [...computeBalances(splits, settlements).values()];
    const owedToMe = balances.filter((b) => b > 0).reduce((a, b) => a + b, 0);
    const iOwe = -balances.filter((b) => b < 0).reduce((a, b) => a + b, 0);

    const days = new Array(daysInMonth(month)).fill(0);
    for (const r of rows) days[new Date(r.ts).getDate() - 1] += r.amount;

    const months = Array.from({ length: 6 }, (_, i) => ({ m: addMonths(month, i - 5), v: 0 }));
    for (const r of trendRows) {
      const d = new Date(r.ts);
      const idx = months.findIndex((x) => x.m.getFullYear() === d.getFullYear() && x.m.getMonth() === d.getMonth());
      if (idx >= 0) months[idx].v += r.amount;
    }
    return { summary, prev, cats, days, months, merchants, owedToMe, iOwe, review, isCurrentMonth: to > Date.now() };
  }, [month]);

  const captureOn = TxnCapture ? TxnCapture.isNotificationAccessGranted() : false;
  const chartW = width - space.lg * 2 - space.lg * 2;

  if (!data) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  const { summary, prev, cats, days, months, merchants, owedToMe, iOwe, review, isCurrentMonth } = data;
  const delta = prev.spent ? (summary.spent - prev.spent) / prev.spent : null;

  // Donut: categories with a palette hue get their own slice; gray-palette ones + uncategorised fold into "Other".
  const spent = cats.filter((c) => c.spent > 0);
  const named = spent.filter((c) => c.category_id != null && c.color.toLowerCase() !== OTHER_COLOR);
  const otherV = spent.filter((c) => !named.includes(c)).reduce((a, c) => a + c.spent, 0);
  const pie = [
    ...named.map((c) => ({ value: c.spent, color: series(c.color) })),
    ...(otherV > 0 ? [{ value: otherV, color: series(OTHER_COLOR) }] : []),
  ];

  const maxDay = Math.max(...days, 1);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }}>
      {/* Month switcher */}
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable hitSlop={12} onPress={() => setMonth(addMonths(month, -1))}>
          <Text style={{ color: t.primary, fontSize: 22, paddingHorizontal: 8 }}>‹</Text>
        </Pressable>
        <Title style={{ fontSize: 18 }}>{monthLabel(month, true)}</Title>
        <Pressable hitSlop={12} disabled={isCurrentMonth} onPress={() => setMonth(addMonths(month, 1))}>
          <Text style={{ color: isCurrentMonth ? t.border : t.primary, fontSize: 22, paddingHorizontal: 8 }}>›</Text>
        </Pressable>
      </Row>

      {(!captureOn || review > 0) && (
        <Card
          onPress={() => router.push(captureOn ? '/review' : '/onboarding')}
          style={{ backgroundColor: t.warningSoft, borderColor: t.warningSoft }}
        >
          <Body style={{ fontWeight: '700', color: t.warning }}>
            {captureOn ? `⚠️ ${review} message${review > 1 ? 's' : ''} need review` : '⚠️ Auto-capture is off'}
          </Body>
          <Muted>{captureOn ? "Some bank alerts couldn't be read automatically." : 'Grant SMS and notification access so payments are tracked automatically.'}</Muted>
        </Card>
      )}

      {/* Hero */}
      <Card>
        <Muted>Spent this month (your share)</Muted>
        <Text style={{ color: t.text, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatINR(summary.spent, { decimals: false })}</Text>
        <Muted>
          {summary.count} expenses
          {delta != null ? ` · ${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta * 100).toFixed(0)}% vs ${monthLabel(addMonths(month, -1))}` : ''}
        </Muted>
      </Card>

      <Row style={{ alignItems: 'stretch' }}>
        <Card style={{ flex: 1 }}>
          <Muted>Received</Muted>
          <Body style={{ fontWeight: '700', color: t.success }}>{formatINR(summary.received, { decimals: false })}</Body>
        </Card>
        <Card style={{ flex: 1 }} onPress={() => router.push('/splits')}>
          <Muted>Owed to you</Muted>
          <Body style={{ fontWeight: '700' }}>{formatINR(owedToMe, { decimals: false })}</Body>
        </Card>
        <Card style={{ flex: 1 }} onPress={() => router.push('/splits')}>
          <Muted>You owe</Muted>
          <Body style={{ fontWeight: '700' }}>{formatINR(iOwe, { decimals: false })}</Body>
        </Card>
      </Row>

      {/* Categories: donut + table/legend with budgets */}
      <Card>
        <Title>Where it went</Title>
        {pie.length ? (
          <View style={{ alignItems: 'center', paddingVertical: space.sm }}>
            <PieChart
              data={pie}
              donut
              radius={92}
              innerRadius={62}
              innerCircleColor={t.card}
              strokeWidth={2}
              strokeColor={t.card}
              centerLabelComponent={() => (
                <View style={{ alignItems: 'center' }}>
                  <Muted>Total</Muted>
                  <Body style={{ fontWeight: '800' }}>{formatINRCompact(summary.spent)}</Body>
                </View>
              )}
            />
          </View>
        ) : (
          <Muted>No spending yet this month.</Muted>
        )}
        {cats.map((c) => {
          const pct = summary.spent ? c.spent / summary.spent : 0;
          return (
            <Pressable
              key={`${c.category_id}`}
              onPress={() => router.push({ pathname: '/transactions', params: { category: c.category_id == null ? 'none' : String(c.category_id) } })}
              style={{ gap: 6, paddingVertical: 6 }}
            >
              <Row>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: series(c.category_id == null ? OTHER_COLOR : c.color) }} />
                <Body style={{ flex: 1 }} numberOfLines={1}>
                  {c.icon} {c.name}
                </Body>
                <Muted>{(pct * 100).toFixed(0)}%</Muted>
                <Body style={{ fontWeight: '700', minWidth: 76, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{formatINR(c.spent, { decimals: false })}</Body>
              </Row>
              {c.budget_paise > 0 && (
                <View style={{ gap: 4, paddingLeft: 18 }}>
                  <ProgressBar value={c.spent / c.budget_paise} />
                  <Muted style={{ fontSize: 12, color: c.spent > c.budget_paise ? t.danger : t.muted }}>
                    {c.spent > c.budget_paise
                      ? `⛔ Over budget by ${formatINR(c.spent - c.budget_paise, { decimals: false })}`
                      : `${formatINR(c.budget_paise - c.spent, { decimals: false })} left of ${formatINR(c.budget_paise, { decimals: false })}`}
                  </Muted>
                </View>
              )}
            </Pressable>
          );
        })}
        <Pressable onPress={() => router.push('/categories')}>
          <Muted style={{ color: t.primary, fontWeight: '600', marginTop: 4 }}>Set budgets →</Muted>
        </Pressable>
      </Card>

      {/* Daily spend */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Title>Daily spending</Title>
          <Muted>{selDay != null ? `${selDay + 1} ${monthLabel(month)}: ${formatINR(days[selDay], { decimals: false })}` : 'Tap a bar'}</Muted>
        </Row>
        <BarChart
          data={days.map((v, i) => ({
            value: v / 100,
            frontColor: selDay === i ? t.text : t.primary,
            label: (i + 1) % 5 === 0 || i === 0 ? String(i + 1) : '',
            onPress: () => setSelDay(i === selDay ? null : i),
          }))}
          width={chartW - 36}
          height={140}
          barWidth={Math.max(4, (chartW - 36) / days.length - 3)}
          spacing={2}
          initialSpacing={2}
          barBorderTopLeftRadius={3}
          barBorderTopRightRadius={3}
          noOfSections={3}
          maxValue={Math.ceil(maxDay / 100 / 3) * 3 || 3}
          yAxisThickness={0}
          xAxisThickness={1}
          xAxisColor={t.border}
          rulesColor={t.border}
          rulesType="solid"
          yAxisTextStyle={{ color: t.muted, fontSize: 10 }}
          xAxisLabelTextStyle={{ color: t.muted, fontSize: 10 }}
          formatYLabel={(v: string) => formatINRCompact(Number(v) * 100)}
          disableScroll
        />
      </Card>

      {/* 6-month trend */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Title>Last 6 months</Title>
          <Muted>{selMonth != null ? `${monthLabel(months[selMonth].m)}: ${formatINR(months[selMonth].v, { decimals: false })}` : 'Tap a bar'}</Muted>
        </Row>
        <BarChart
          data={months.map((x, i) => ({
            value: x.v / 100,
            label: monthLabel(x.m),
            frontColor: i === 5 ? t.primary : t.primary + '80',
            onPress: () => setSelMonth(i === selMonth ? null : i),
          }))}
          width={chartW - 36}
          height={140}
          barWidth={(chartW - 36) / 6 - 14}
          spacing={12}
          initialSpacing={6}
          barBorderTopLeftRadius={4}
          barBorderTopRightRadius={4}
          noOfSections={3}
          yAxisThickness={0}
          xAxisThickness={1}
          xAxisColor={t.border}
          rulesColor={t.border}
          rulesType="solid"
          yAxisTextStyle={{ color: t.muted, fontSize: 10 }}
          xAxisLabelTextStyle={{ color: t.muted, fontSize: 11 }}
          formatYLabel={(v: string) => formatINRCompact(Number(v) * 100)}
          disableScroll
        />
      </Card>

      {/* Top merchants */}
      <Card>
        <Title>Top merchants</Title>
        {merchants.length ? (
          merchants.map((m) => (
            <Row key={m.name} style={{ paddingVertical: 4 }}>
              <Body style={{ flex: 1 }} numberOfLines={1}>
                {m.name}
              </Body>
              <Muted>{m.n}×</Muted>
              <Body style={{ fontWeight: '700', minWidth: 76, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{formatINR(m.spent, { decimals: false })}</Body>
            </Row>
          ))
        ) : (
          <Muted>Nothing yet.</Muted>
        )}
      </Card>
    </ScrollView>
  );
}
