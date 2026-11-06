import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import TxnCapture from '../../../modules/txn-capture';
import { backfillInbox, drainNativeQueue } from '../../capture/pipeline';
import { formatDateTime } from '../../core/dates';
import { exportBackup, importBackup } from '../../db/backup';
import { countRaw, getMeta, setMeta } from '../../db/repo';
import { useApp } from '../../state/store';
import { Body, Button, Card, Chip, Muted, Row, Title, useData } from '../../ui/components';
import { PermissionsCard } from '../../ui/PermissionsCard';
import { space } from '../../ui/theme';

function NavRow({ title, hint, onPress }: { title: string; hint?: string; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={{ padding: space.md }}>
      <Row>
        <View style={{ flex: 1 }}>
          <Body style={{ fontWeight: '600' }}>{title}</Body>
          {hint ? <Muted>{hint}</Muted> : null}
        </View>
        <Muted style={{ fontSize: 18 }}>›</Muted>
      </Row>
    </Card>
  );
}

export default function Settings() {
  const db = useSQLiteContext();
  const bump = useApp((s) => s.bump);
  const [busy, setBusy] = useState<string | null>(null);
  const [months, setMonths] = useState(3);

  const [info] = useData(async () => ({
    review: await countRaw(db, 'unparsed'),
    last: await getMeta(db, 'last_capture_at'),
    alerts: (await getMeta(db, 'alerts')) !== 'off',
    pending: (await TxnCapture?.pendingCount()) ?? 0,
  }));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      bump();
    } catch (e) {
      Alert.alert('Something went wrong', String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }}>
      <PermissionsCard />

      <Card>
        <Title>Sync</Title>
        <Muted>
          Last capture: {info?.last ? formatDateTime(Number(info.last)) : 'never'}
          {info?.pending ? ` · ${info.pending} waiting` : ''}
        </Muted>
        <Button
          title="Sync now"
          kind="secondary"
          loading={busy === 'sync'}
          onPress={() =>
            run('sync', async () => {
              const r = await drainNativeQueue(db, { alert: false });
              Alert.alert('Synced', r ? `${r.inserted.length} new, ${r.merged} merged` : 'Nothing new');
            })
          }
        />
        <Muted>Re-scan SMS inbox (safe to repeat; duplicates are skipped)</Muted>
        <Row>
          {[1, 3, 6, 12].map((m) => (
            <Chip key={m} label={`${m} mo`} selected={months === m} onPress={() => setMonths(m)} />
          ))}
        </Row>
        <Button
          title={`Scan last ${months} months`}
          kind="secondary"
          loading={busy === 'scan'}
          onPress={() =>
            run('scan', async () => {
              const r = await backfillInbox(db, months);
              Alert.alert('Scan complete', `${r.scanned} bank messages · ${r.inserted.length} new · ${r.duplicates} already had`);
            })
          }
        />
        <Row style={{ justifyContent: 'space-between' }}>
          <Body>Alert me for each payment</Body>
          <Switch
            value={info?.alerts ?? true}
            onValueChange={async (v) => {
              await setMeta(db, 'alerts', v ? 'on' : 'off');
              bump();
            }}
          />
        </Row>
      </Card>

      <NavRow title="Categories & budgets" hint="Rename categories, set monthly budgets" onPress={() => router.push('/categories')} />
      <NavRow title="Learned rules" hint="Merchants the app remembers from your edits" onPress={() => router.push('/rules')} />
      <NavRow
        title={`Needs review${info?.review ? ` (${info.review})` : ''}`}
        hint="Bank messages that couldn't be read automatically"
        onPress={() => router.push('/review')}
      />
      <NavRow title="Add a cash expense" onPress={() => router.push('/add-transaction')} />

      <Card>
        <Title>Backup</Title>
        <Muted>Your data lives only on this phone. Export a backup to Drive or Files now and then.</Muted>
        <Row>
          <Button title="Export" kind="secondary" style={{ flex: 1 }} loading={busy === 'exp'} onPress={() => run('exp', () => exportBackup(db))} />
          <Button
            title="Restore"
            kind="secondary"
            style={{ flex: 1 }}
            loading={busy === 'imp'}
            onPress={() =>
              Alert.alert('Restore backup?', 'This replaces all current data.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Restore', style: 'destructive', onPress: () => run('imp', async () => void (await importBackup(db))) },
              ])
            }
          />
        </Row>
      </Card>
    </ScrollView>
  );
}
