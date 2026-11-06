import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { formatINR } from '../../core/money';
import { computeBalances } from '../../core/splits';
import { addPerson, allSettlements, allSplitRecords, listPeople } from '../../db/repo';
import { useApp } from '../../state/store';
import { Body, Button, Card, Empty, Input, Muted, Row, Title, useData } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';

export default function Splits() {
  const db = useSQLiteContext();
  const t = useTheme();
  const bump = useApp((s) => s.bump);
  const [name, setName] = useState('');
  const [vpa, setVpa] = useState('');

  const [data] = useData(async () => {
    const [people, splits, settlements] = await Promise.all([listPeople(db), allSplitRecords(db), allSettlements(db)]);
    const bal = computeBalances(splits, settlements);
    return people.map((p) => ({ ...p, balance: bal.get(p.id) ?? 0 })).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  });

  const owed = (data ?? []).filter((p) => p.balance > 0).reduce((a, p) => a + p.balance, 0);
  const owe = -(data ?? []).filter((p) => p.balance < 0).reduce((a, p) => a + p.balance, 0);

  const add = async () => {
    if (!name.trim()) return;
    await addPerson(db, name, vpa);
    setName('');
    setVpa('');
    bump();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Row style={{ alignItems: 'stretch' }}>
        <Card style={{ flex: 1, backgroundColor: t.successSoft, borderColor: t.successSoft }}>
          <Muted>Owed to you</Muted>
          <Title style={{ color: t.success, fontSize: 20 }}>{formatINR(owed)}</Title>
        </Card>
        <Card style={{ flex: 1, backgroundColor: t.dangerSoft, borderColor: t.dangerSoft }}>
          <Muted>You owe</Muted>
          <Title style={{ color: t.danger, fontSize: 20 }}>{formatINR(owe)}</Title>
        </Card>
      </Row>

      <Button title="＋ Add a bill someone else paid" kind="secondary" onPress={() => router.push('/split')} />
      <Muted>To split a payment you made on GPay, open it from Transactions and tap “Split this bill”.</Muted>

      <Card>
        <Title>People</Title>
        {data?.length ? (
          data.map((p) => (
            <Card key={p.id} onPress={() => router.push(`/person/${p.id}`)} style={{ padding: space.md }}>
              <Row>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '600' }}>{p.name}</Body>
                  {p.vpa ? <Muted>{p.vpa}</Muted> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Muted style={{ fontSize: 12 }}>{p.balance > 0 ? 'owes you' : p.balance < 0 ? 'you owe' : 'settled up'}</Muted>
                  <Body style={{ fontWeight: '700', color: p.balance > 0 ? t.success : p.balance < 0 ? t.danger : t.muted }}>
                    {p.balance ? formatINR(Math.abs(p.balance)) : '✓'}
                  </Body>
                </View>
              </Row>
            </Card>
          ))
        ) : (
          <Empty title="No people yet" hint="Add the friends you split bills with." />
        )}
      </Card>

      <Card>
        <Title>Add person</Title>
        <Input placeholder="Name" value={name} onChangeText={setName} />
        <Input
          placeholder="UPI ID (optional, e.g. rahul@okaxis)"
          value={vpa}
          onChangeText={setVpa}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Muted>Adding their UPI ID lets the app recognise when they pay you back.</Muted>
        <Button title="Add" onPress={add} disabled={!name.trim()} />
      </Card>
    </ScrollView>
  );
}
