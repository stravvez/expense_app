import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { formatINR, toPaise } from '../core/money';
import { computeShares, type PartyId, type SplitMode } from '../core/splits';
import { addPerson, getSplit, getSplitForTxn, getTxn, listCategories, listPeople, saveSplit } from '../db/repo';
import { useApp } from '../state/store';
import { Body, Button, Card, Chip, Input, Muted, Row, Title, useData } from '../ui/components';
import { space, useTheme } from '../ui/theme';

/**
 * Split editor.
 *  ?txnId=…   split a captured payment (I paid; total fixed)
 *  ?splitId=… edit an existing split
 *  (none)     add a bill someone else paid / a cash bill
 */
export default function SplitScreen() {
  const { txnId, splitId } = useLocalSearchParams<{ txnId?: string; splitId?: string }>();
  const db = useSQLiteContext();
  const t = useTheme();
  const bump = useApp((s) => s.bump);

  const [base, reloadBase] = useData(async () => {
    const txn = txnId ? await getTxn(db, Number(txnId)) : null;
    const existing = splitId ? await getSplit(db, Number(splitId)) : txn ? await getSplitForTxn(db, txn.id) : null;
    return { txn, existing, people: await listPeople(db), cats: await listCategories(db) };
  }, [txnId, splitId]);

  const [participants, setParticipants] = useState<PartyId[]>([null]);
  const [payer, setPayer] = useState<PartyId>(null);
  const [mode, setMode] = useState<SplitMode>('equal');
  const [values, setValues] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [inited, setInited] = useState(false);

  if (base && !inited) {
    const e = base.existing;
    if (e) {
      setParticipants(e.shares.map((s) => s.personId));
      setPayer(e.payer_person_id);
      setMode(e.mode);
      setAmount(String(e.total_paise / 100));
      setDesc(e.description ?? '');
      setCategoryId(e.category_id);
      if (e.mode === 'exact') setValues(Object.fromEntries(e.shares.map((s) => [String(s.personId), String(s.sharePaise / 100)])));
      if (e.mode === 'percent') setValues(Object.fromEntries(e.shares.map((s) => [String(s.personId), String(Math.round((s.sharePaise / e.total_paise) * 1000) / 10)])));
    } else if (base.txn) setCategoryId(base.txn.category_id);
    setInited(true);
  }

  const total = base?.txn ? base.txn.amount_paise : toPaise(amount || '0');
  const result = useMemo(() => {
    const vals = new Map<PartyId, number>();
    for (const p of participants) {
      const raw = values[String(p)] ?? '';
      vals.set(p, mode === 'exact' ? toPaise(raw || '0') : Number(raw || 0));
    }
    return computeShares(total, mode, participants, vals);
  }, [participants, values, mode, total]);

  if (!base) return null;
  const { txn, people, cats } = base;
  const nameOf = (id: PartyId) => (id == null ? 'You' : people.find((p) => p.id === id)?.name ?? '?');
  const toggle = (id: PartyId) => setParticipants((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id]));
  const involvesOthers = participants.some((p) => p !== null) || payer !== null;

  const quickAdd = async () => {
    if (!newName.trim()) return;
    const id = await addPerson(db, newName);
    setNewName('');
    setParticipants((ps) => [...ps, id]);
    reloadBase();
  };

  const save = async () => {
    if (!result.ok) return;
    await saveSplit(db, {
      id: base.existing?.id,
      transactionId: txn?.id ?? null,
      payer: txn ? null : payer,
      total,
      mode,
      description: txn ? null : desc.trim() || null,
      categoryId: txn ? txn.category_id : categoryId,
      ts: txn?.ts ?? base.existing?.ts ?? Date.now(),
      shares: result.shares,
    });
    bump();
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      {txn ? (
        <Card>
          <Muted>You paid {txn.counterparty ?? txn.vpa ?? ''}</Muted>
          <Title style={{ fontSize: 24 }}>{formatINR(txn.amount_paise)}</Title>
        </Card>
      ) : (
        <Card>
          <Input label="Amount (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0.00" />
          <Input label="What was it for?" value={desc} onChangeText={setDesc} placeholder="Dinner at …" />
          <Muted>Who paid?</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[null, ...people.map((p) => p.id)].map((id) => (
              <Chip key={String(id)} label={nameOf(id)} selected={payer === id} onPress={() => setPayer(id)} />
            ))}
          </View>
          <Muted>Category</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {cats.map((c) => (
              <Chip key={c.id} label={`${c.icon} ${c.name}`} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
          </View>
        </Card>
      )}

      <Card>
        <Title>Split between</Title>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {[null, ...people.map((p) => p.id)].map((id) => (
            <Chip key={String(id)} label={nameOf(id)} selected={participants.includes(id)} onPress={() => toggle(id)} />
          ))}
        </View>
        <Row>
          <View style={{ flex: 1 }}>
            <Input placeholder="Add a person…" value={newName} onChangeText={setNewName} onSubmitEditing={quickAdd} returnKeyType="done" />
          </View>
          <Button title="Add" kind="secondary" onPress={quickAdd} />
        </Row>
      </Card>

      <Card>
        <Title>How?</Title>
        <Row>
          <Chip label="Equally" selected={mode === 'equal'} onPress={() => setMode('equal')} />
          <Chip label="Exact amounts" selected={mode === 'exact'} onPress={() => setMode('exact')} />
          <Chip label="Percentages" selected={mode === 'percent'} onPress={() => setMode('percent')} />
        </Row>
        {participants.map((p, i) => (
          <Row key={String(p)} style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
            <Body style={{ flex: 1 }}>{nameOf(p)}</Body>
            {mode !== 'equal' && (
              <View style={{ width: 110 }}>
                <Input
                  keyboardType="decimal-pad"
                  placeholder={mode === 'exact' ? '₹' : '%'}
                  value={values[String(p)] ?? ''}
                  onChangeText={(v) => setValues((s) => ({ ...s, [String(p)]: v }))}
                  style={{ paddingVertical: 6, textAlign: 'right' }}
                />
              </View>
            )}
            <Body style={{ width: 90, textAlign: 'right', fontWeight: '700' }}>{result.ok ? formatINR(result.shares[i].sharePaise) : '—'}</Body>
          </Row>
        ))}
        {!result.ok && <Muted style={{ color: t.danger }}>{result.error}</Muted>}
        {!involvesOthers && <Muted style={{ color: t.warning }}>Add at least one other person.</Muted>}
      </Card>

      <Button title="Save split" disabled={!result.ok || !involvesOthers} onPress={save} />
    </ScrollView>
  );
}
