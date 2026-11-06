import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { backfillInbox } from '../capture/pipeline';
import type { PermState } from '../capture/permissions';
import { setMeta } from '../db/repo';
import { useApp } from '../state/store';
import { Body, Button, Card, Chip, Muted, Row, Title } from '../ui/components';
import { PermissionsCard } from '../ui/PermissionsCard';
import { space } from '../ui/theme';

export default function Onboarding() {
  const db = useSQLiteContext();
  const bump = useApp((s) => s.bump);
  const [perm, setPerm] = useState<PermState>();
  const [months, setMonths] = useState(6);
  const [busy, setBusy] = useState(false);

  const finish = async (doBackfill: boolean) => {
    setBusy(true);
    try {
      if (doBackfill && perm?.sms) {
        const r = await backfillInbox(db, months);
        Alert.alert('History imported', `Scanned ${r.scanned} bank messages and added ${r.inserted.length} transactions.${r.unparsed ? ` ${r.unparsed} need review.` : ''}`);
      }
      await setMeta(db, 'onboarded', '1');
      bump();
      router.back();
    } catch (e) {
      Alert.alert('Import failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }}>
      <Card>
        <Title style={{ fontSize: 20 }}>Track GPay automatically</Title>
        <Body>
          Google Pay doesn’t share your history with other apps, so Paisa Tracker reads the two things your phone already gets for every payment: Union Bank’s
          SMS alert and Google Pay’s notification. Everything stays on this phone.
        </Body>
      </Card>

      <PermissionsCard onChange={setPerm} />

      <Card>
        <Title>Import past months</Title>
        <Muted>Read old Union Bank SMS from your inbox so the dashboard starts with your history.</Muted>
        <Row>
          {[1, 3, 6, 12].map((m) => (
            <Chip key={m} label={`${m} mo`} selected={months === m} onPress={() => setMonths(m)} />
          ))}
        </Row>
      </Card>

      <Button title={perm?.sms ? `Import ${months} months & finish` : 'Finish'} loading={busy} onPress={() => finish(true)} />
      {perm?.sms && <Button title="Skip import" kind="ghost" onPress={() => finish(false)} />}
    </ScrollView>
  );
}
