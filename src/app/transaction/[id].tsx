import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { formatDateTime } from '../../core/dates';
import { formatINR } from '../../core/money';
import {
  addSettlement,
  deleteSplit,
  deleteTxn,
  getSplitForTxn,
  getTxn,
  listCategories,
  listPeople,
  matchPerson,
  patchTxn,
  setTxnCategory,
  similarTxnIds,
} from '../../db/repo';
import { useApp } from '../../state/store';
import { Body, Button, Card, Chip, Input, Muted, Row, Title, useData } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';

export default function TransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const txnId = Number(id);
  const db = useSQLiteContext();
  const t = useTheme();
  const bump = useApp((s) => s.bump);

  const [data] = useData(async () => {
    const [txn, cats, split, people] = await Promise.all([getTxn(db, txnId), listCategories(db), getSplitForTxn(db, txnId), listPeople(db)]);
    const settled = await db.getFirstAsync<{ person_id: number; name: string }>(
      'SELECT s.person_id, p.name FROM settlements s JOIN people p ON p.id = s.person_id WHERE s.transaction_id = ?',
      txnId
    );
    return { txn, cats, split, people, settled };
  }, [txnId]);

  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [loadedId, setLoadedId] = useState<number | null>(null);
  if (data?.txn && data.txn.id !== loadedId) {
    setLoadedId(data.txn.id);
    setNote(data.txn.note ?? '');
    setName(data.txn.counterparty ?? '');
  }

  if (!data) return null;
  const { txn, cats, split, people, settled } = data;
  if (!txn) return <Muted style={{ padding: space.lg }}>Transaction not found.</Muted>;

  const pickCategory = async (catId: number) => {
    const similar = await similarTxnIds(db, txn, catId);
    const cat = cats.find((c) => c.id === catId)!;
    const apply = async (ids: number[]) => {
      await setTxnCategory(db, txn, catId, ids);
      bump();
    };
    if (similar.length) {
      Alert.alert(
        `Apply ${cat.name} to ${similar.length} more?`,
        `Other payments to ${txn.counterparty ?? txn.vpa} will also be categorized as ${cat.name}. Future ones will be automatically.`,
        [
          { text: 'Only this one', onPress: () => apply([]) },
          { text: `Apply to all`, onPress: () => apply(similar) },
        ]
      );
    } else await apply([]);
  };

  const saveText = async () => {
    const patch: Record<string, string | null> = {};
    if ((txn.note ?? '') !== note) patch.note = note || null;
    if ((txn.counterparty ?? '') !== name && name.trim()) patch.counterparty = name.trim();
    if (Object.keys(patch).length) {
      await patchTxn(db, txn.id, patch);
      bump();
    }
  };

  const suggested = txn.direction === 'credit' && !settled ? matchPerson(people, txn) : undefined;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }}>
      <Card style={{ alignItems: 'center', gap: 4 }}>
        <Muted>{txn.direction === 'credit' ? 'Received from' : 'Paid to'}</Muted>
        <Title style={{ fontSize: 18, textAlign: 'center' }}>{txn.counterparty ?? txn.vpa ?? 'Unknown'}</Title>
        <Text style={{ color: txn.direction === 'credit' ? t.success : t.text, fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
          {txn.direction === 'credit' ? '+' : ''}
          {formatINR(txn.amount_paise)}
        </Text>
        <Muted>{formatDateTime(txn.ts)}</Muted>
        {split && <Muted style={{ color: t.primary, fontWeight: '600' }}>Your share: {formatINR(txn.my_share_paise)}</Muted>}
      </Card>

      {txn.direction === 'debit' && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Title>Category</Title>
            {txn.category_source === 'auto' && txn.category_id != null && <Muted>auto</Muted>}
          </Row>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {cats.map((c) => (
              <Chip key={c.id} label={`${c.icon} ${c.name}`} selected={txn.category_id === c.id} onPress={() => pickCategory(c.id)} />
            ))}
          </View>
        </Card>
      )}

      {txn.direction === 'debit' && (
        <Card>
          <Title>Split</Title>
          {split ? (
            <>
              <Muted>
                Split {split.mode} between {split.shares.length} · you paid {formatINR(split.total_paise)}
              </Muted>
              {split.shares.map((s, i) => (
                <Row key={i} style={{ justifyContent: 'space-between' }}>
                  <Body>{s.personId == null ? 'You' : people.find((p) => p.id === s.personId)?.name ?? 'Someone'}</Body>
                  <Body style={{ fontWeight: '700' }}>{formatINR(s.sharePaise)}</Body>
                </Row>
              ))}
              <Row>
                <Button title="Edit split" kind="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/split', params: { txnId: String(txn.id) } })} />
                <Button
                  title="Remove"
                  kind="danger"
                  onPress={async () => {
                    await deleteSplit(db, split.id);
                    bump();
                  }}
                />
              </Row>
            </>
          ) : (
            <>
              <Muted>Shared this bill? Split it so only your share counts as spending, and track who owes you.</Muted>
              <Button title="Split this bill" onPress={() => router.push({ pathname: '/split', params: { txnId: String(txn.id) } })} />
            </>
          )}
        </Card>
      )}

      {txn.direction === 'credit' && (
        <Card>
          <Title>Repayment</Title>
          {settled ? (
            <Muted>Recorded as {settled.name} paying you back.</Muted>
          ) : (
            <>
              <Muted>Was this a friend paying you back? Link it to settle their balance.</Muted>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(suggested ? [suggested, ...people.filter((p) => p.id !== suggested.id)] : people).map((p) => (
                  <Chip
                    key={p.id}
                    label={p.id === suggested?.id ? `⭐ ${p.name}` : p.name}
                    selected={p.id === suggested?.id}
                    onPress={async () => {
                      await addSettlement(db, { personId: p.id, amount: txn.amount_paise, direction: 'in', ts: txn.ts, transactionId: txn.id });
                      bump();
                    }}
                  />
                ))}
                {!people.length && <Muted>Add people in the Splits tab first.</Muted>}
              </View>
            </>
          )}
        </Card>
      )}

      <Card>
        <Title>Details</Title>
        <Input label="Name" value={name} onChangeText={setName} onBlur={saveText} placeholder="Merchant or person" />
        <Input label="Note" value={note} onChangeText={setNote} onBlur={saveText} placeholder="Add a note" multiline />
        {txn.vpa && <Muted>UPI ID: {txn.vpa}</Muted>}
        {txn.upi_ref && <Muted>UPI ref: {txn.upi_ref}</Muted>}
        {txn.account_last4 && <Muted>Account: ••{txn.account_last4}</Muted>}
        <Muted>Captured from: {txn.sources.split(',').map((s) => ({ sms: 'Bank SMS', notif: 'GPay notification', screen: 'GPay screen', manual: 'Manual' })[s] ?? s).join(' + ')}</Muted>
        <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <Body>Exclude from analytics</Body>
            <Muted>For self-transfers, refunds, investments…</Muted>
          </View>
          <Switch
            value={!!txn.excluded}
            onValueChange={async (v) => {
              await patchTxn(db, txn.id, { excluded: v ? 1 : 0 });
              bump();
            }}
          />
        </Row>
      </Card>

      <Button
        title="Delete transaction"
        kind="danger"
        onPress={() =>
          Alert.alert('Delete transaction?', 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                await deleteTxn(db, txn.id);
                bump();
                router.back();
              },
            },
          ])
        }
      />
    </ScrollView>
  );
}
