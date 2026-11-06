import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView } from 'react-native';
import { formatDateTime } from '../core/dates';
import { listRaw, setRawStatus } from '../db/repo';
import { useApp } from '../state/store';
import { Body, Button, Card, Empty, Muted, Row, useData } from '../ui/components';
import { space } from '../ui/theme';

/** Bank messages that looked like transactions but no parser understood. */
export default function Review() {
  const db = useSQLiteContext();
  const bump = useApp((s) => s.bump);
  const [items] = useData(() => listRaw(db, 'unparsed'));

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }}>
      <Muted>
        These messages looked like payments but couldn’t be read automatically. Add them by hand, or dismiss them. If many look the same, the parser
        can be updated to understand that format.
      </Muted>
      {items?.length === 0 && <Empty title="All clear" hint="Every bank message was understood." />}
      {items?.map((e) => (
        <Card key={e.id}>
          <Muted>
            {e.source === 'sms' ? `SMS from ${e.sender}` : 'Notification'} · {formatDateTime(e.ts)}
          </Muted>
          <Body selectable>{e.body}</Body>
          <Row>
            <Button
              title="Add manually"
              kind="secondary"
              style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/add-transaction', params: { rawId: String(e.id), ts: String(e.ts) } })}
            />
            <Button
              title="Dismiss"
              kind="ghost"
              onPress={async () => {
                await setRawStatus(db, e.id, 'dismissed', null, null);
                bump();
              }}
            />
          </Row>
        </Card>
      ))}
    </ScrollView>
  );
}

