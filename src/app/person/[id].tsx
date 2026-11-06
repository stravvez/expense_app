import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { formatDay } from '../../core/dates';
import { formatINR, toPaise } from '../../core/money';
import { computeBalances } from '../../core/splits';
import {
  addSettlement,
  allSettlements,
  allSplitRecords,
  deletePerson,
  deleteSettlement,
  listPeople,
  personActivity,
  updatePerson,
} from '../../db/repo';
import { useApp } from '../../state/store';
import { Body, Button, Card, Chip, Input, Muted, Row, Title, useData } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = Number(id);
  const db = useSQLiteContext();
  const t = useTheme();
  const nav = useNavigation();
  const bump = useApp((s) => s.bump);
  const [amount, setAmount] = useState('');
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [name, setName] = useState('');
  const [vpa, setVpa] = useState('');

  const [data] = useData(async () => {
    const [people, splits, settlements, activity] = await Promise.all([listPeople(db), allSplitRecords(db), allSettlements(db), personActivity(db, pid)]);
    return { person: people.find((p) => p.id === pid), balance: computeBalances(splits, settlements).get(pid) ?? 0, activity };
  }, [pid]);

  const [loaded, setLoaded] = useState<string | null>(null);
  const personKey = data?.person ? `${data.person.id}|${data.person.name}|${data.person.vpa}` : null;
  if (personKey && personKey !== loaded) {
    setLoaded(personKey);
    setName(data!.person!.name);
    setVpa(data!.person!.vpa ?? '');
  }
  const title = data?.person?.name;
  useEffect(() => {
    if (title) nav.setOptions({ title });
  }, [title, nav]);

  if (!data) return null;
  const { person, balance, activity } = data;
  if (!person) return <Muted style={{ padding: space.lg }}>Not found.</Muted>;

  const settle = async () => {
    const p = toPaise(amount || String(Math.abs(balance) / 100));
    if (!Number.isFinite(p) || p <= 0) return;
    await addSettlement(db, { personId: pid, amount: p, direction: dir, ts: Date.now(), note: 'Settled manually' });
    setAmount('');
    bump();
  };

  const items = [
    ...activity.splits.map((s) => ({ kind: 'split' as const, ts: s.ts, s })),
    ...activity.settlements.map((s) => ({ kind: 'settle' as const, ts: s.ts, s })),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Card style={{ alignItems: 'center' }}>
        <Muted>{balance > 0 ? `${person.name} owes you` : balance < 0 ? `You owe ${person.name}` : 'All settled up'}</Muted>
        <Title style={{ fontSize: 30, color: balance > 0 ? t.success : balance < 0 ? t.danger : t.text }}>{formatINR(Math.abs(balance))}</Title>
      </Card>

      <Card>
        <Title>Record a payment</Title>
        <Row>
          <Chip label={`${person.name} paid me`} selected={dir === 'in'} onPress={() => setDir('in')} />
          <Chip label={`I paid ${person.name}`} selected={dir === 'out'} onPress={() => setDir('out')} />
        </Row>
        <Input keyboardType="decimal-pad" placeholder={balance ? `Amount (default ${(Math.abs(balance) / 100).toFixed(2)})` : 'Amount'} value={amount} onChangeText={setAmount} />
        <Muted>Tip: if they paid you on GPay, open that payment in Transactions and link it instead, so it isn’t counted as income.</Muted>
        <Button title="Record" onPress={settle} />
      </Card>

      <Card>
        <Title>History</Title>
        {!items.length && <Muted>No shared bills yet.</Muted>}
        {items.map((it) =>
          it.kind === 'split' ? (
            <Card
              key={`s${it.s.id}`}
              style={{ padding: space.md }}
              onPress={() =>
                it.s.transaction_id
                  ? router.push(`/transaction/${it.s.transaction_id}`)
                  : router.push({ pathname: '/split', params: { splitId: String(it.s.id) } })
              }
            >
              <Row>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1}>{it.s.description ?? it.s.counterparty ?? 'Shared bill'}</Body>
                  <Muted>
                    {formatDay(it.s.ts)} · {it.s.payer_person_id == null ? 'you paid' : it.s.payer_person_id === pid ? `${person.name} paid` : 'someone else paid'} {formatINR(it.s.total_paise)}
                  </Muted>
                </View>
                <Body style={{ fontWeight: '700', color: it.s.payer_person_id == null ? t.success : t.danger }}>
                  {it.s.payer_person_id == null ? `+${formatINR(it.s.their_share ?? 0)}` : `−${formatINR(it.s.my_share ?? 0)}`}
                </Body>
              </Row>
            </Card>
          ) : (
            <Row key={`p${it.s.id}`} style={{ paddingVertical: 6 }}>
              <View style={{ flex: 1 }}>
                <Body>{it.s.direction === 'in' ? `💸 ${person.name} paid you` : `💸 You paid ${person.name}`}</Body>
                <Muted>
                  {formatDay(it.s.ts)}
                  {it.s.transaction_id ? ' · via GPay' : ''}
                </Muted>
              </View>
              <Body style={{ fontWeight: '700' }}>{formatINR(it.s.amount_paise)}</Body>
              <Button
                title="✕"
                kind="ghost"
                style={{ height: 32, paddingHorizontal: 8 }}
                onPress={async () => {
                  await deleteSettlement(db, it.s.id);
                  bump();
                }}
              />
            </Row>
          )
        )}
      </Card>

      <Card>
        <Title>Edit</Title>
        <Input value={name} onChangeText={setName} placeholder="Name" />
        <Input value={vpa} onChangeText={setVpa} placeholder="UPI ID" autoCapitalize="none" autoCorrect={false} />
        <Row>
          <Button
            title="Save"
            kind="secondary"
            style={{ flex: 1 }}
            onPress={async () => {
              await updatePerson(db, pid, name, vpa);
              bump();
            }}
          />
          <Button
            title="Delete"
            kind="danger"
            onPress={() =>
              Alert.alert(`Delete ${person.name}?`, 'Their splits and settlements are removed too.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    await deletePerson(db, pid);
                    bump();
                    router.back();
                  },
                },
              ])
            }
          />
        </Row>
      </Card>
    </ScrollView>
  );
}
