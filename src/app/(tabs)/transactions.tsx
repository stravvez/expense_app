import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, Text, View } from 'react-native';
import { formatDay, monthLabel, monthRange } from '../../core/dates';
import { formatINR } from '../../core/money';
import { listCategories, listTxns, type TxnView } from '../../db/repo';
import { useApp } from '../../state/store';
import { Chip, Empty, Input, Muted, Row, useData } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';
import { TxnItem } from '../../ui/TxnItem';

type Filter = 'all' | 'debit' | 'credit' | 'none' | number;

export default function Transactions() {
  const db = useSQLiteContext();
  const t = useTheme();
  const nav = useNavigation();
  const params = useLocalSearchParams<{ category?: string; search?: string }>();
  const month = useApp((s) => s.month);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [allTime, setAllTime] = useState(false);
  const [seenSearch, setSeenSearch] = useState<string | undefined>();
  if (params.search !== seenSearch) {
    setSeenSearch(params.search);
    if (params.search) setSearch(params.search);
  }
  const [seenParam, setSeenParam] = useState<string | undefined>();
  if (params.category !== seenParam) {
    setSeenParam(params.category);
    if (params.category) setFilter(params.category === 'none' ? 'none' : Number(params.category));
  }

  useEffect(() => {
    nav.setOptions({
      headerRight: () => (
        <Pressable onPress={() => router.push('/add-transaction')} hitSlop={10} style={{ paddingHorizontal: space.lg }}>
          <Text style={{ color: t.primary, fontSize: 26, fontWeight: '400' }}>＋</Text>
        </Pressable>
      ),
    });
  }, [nav, t.primary]);

  const [cats] = useData(() => listCategories(db));
  const [txns] = useData(() => {
    const [from, to] = monthRange(month);
    return listTxns(db, {
      from: allTime ? undefined : from,
      to: allTime ? undefined : to,
      search: search.trim() || undefined,
      direction: filter === 'debit' || filter === 'credit' ? filter : undefined,
      categoryId: filter === 'none' ? 'none' : typeof filter === 'number' ? filter : undefined,
      limit: 1000,
    });
  }, [month, search, filter, allTime]);

  const sections = useMemo(() => {
    const map = new Map<string, TxnView[]>();
    for (const x of txns ?? []) {
      const k = formatDay(x.ts);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(x);
    }
    return [...map.entries()].map(([title, data]) => ({
      title,
      data,
      total: data.filter((d) => d.direction === 'debit' && !d.excluded).reduce((a, d) => a + d.my_share_paise, 0),
    }));
  }, [txns]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: space.lg, paddingBottom: space.sm, gap: space.sm }}>
        <Input placeholder="Search name, UPI ID, note, ref…" value={search} onChangeText={setSearch} autoCorrect={false} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Chip label={allTime ? 'All time' : monthLabel(month, true)} selected onPress={() => setAllTime(!allTime)} />
          <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label="Spent" selected={filter === 'debit'} onPress={() => setFilter('debit')} />
          <Chip label="Received" selected={filter === 'credit'} onPress={() => setFilter('credit')} />
          <Chip label="⚠️ Uncategorized" selected={filter === 'none'} onPress={() => setFilter('none')} />
          {cats?.map((c) => (
            <Chip key={c.id} label={`${c.icon} ${c.name}`} selected={filter === c.id} onPress={() => setFilter(c.id)} />
          ))}
        </ScrollView>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(x) => String(x.id)}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <Row style={{ justifyContent: 'space-between', backgroundColor: t.bg, paddingTop: space.md, paddingBottom: 4 }}>
            <Muted style={{ fontWeight: '700' }}>{section.title}</Muted>
            {section.total > 0 && <Muted>{formatINR(section.total, { decimals: false })}</Muted>}
          </Row>
        )}
        renderItem={({ item }) => <TxnItem t={item} />}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.border, marginLeft: 48 }} />}
        ListEmptyComponent={
          txns ? <Empty title="No transactions" hint="Payments you make on Google Pay will show up here automatically." /> : undefined
        }
      />
    </View>
  );
}
