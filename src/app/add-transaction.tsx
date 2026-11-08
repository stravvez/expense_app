import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { toPaise } from '../core/money';
import { insertTxn, listCategories, patchTxn, setRawStatus } from '../db/repo';
import { useApp } from '../state/store';
import { Button, Card, Chip, Input, Muted, Row, useData } from '../ui/components';
import { space, useTheme } from '../ui/theme';

/** Manual entry: cash spends, or a bank message the parser couldn't read (?rawId=). */
export default function AddTransaction() {
  const { rawId, ts } = useLocalSearchParams<{ rawId?: string; ts?: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const bump = useApp((s) => s.bump);
  const [cats] = useData(() => listCategories(db));
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit');
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const paise = toPaise(amount || '0');
  const valid = Number.isFinite(paise) && paise > 0;

  const save = async () => {
    const id = await insertTxn(
      db,
      { source: 'manual', amountPaise: paise, direction, ts: ts ? Number(ts) : Date.now(), counterparty: name.trim() || undefined },
      direction === 'debit' ? categoryId : null
    );
    await patchTxn(db, id, { note: note.trim() || null, category_source: 'user' });
    if (rawId) await setRawStatus(db, Number(rawId), 'txn', 'manual', id);
    bump();
    // opened from the widget on a cold start there is no screen underneath to go back to
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Row>
          <Chip label="Spent" selected={direction === 'debit'} onPress={() => setDirection('debit')} />
          <Chip label="Received" selected={direction === 'credit'} onPress={() => setDirection('credit')} color={t.success} />
        </Row>
        <Input label="Amount (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0.00" autoFocus />
        <Input label={direction === 'debit' ? 'Paid to' : 'Received from'} value={name} onChangeText={setName} placeholder="Merchant or person" />
        <Input label="Note" value={note} onChangeText={setNote} placeholder="Optional" />
      </Card>
      {direction === 'debit' && (
        <Card>
          <Muted>Category</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {cats?.map((c) => (
              <Chip key={c.id} label={`${c.icon} ${c.name}`} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
          </View>
        </Card>
      )}
      <Button title="Save" disabled={!valid} onPress={save} />
    </ScrollView>
  );
}
