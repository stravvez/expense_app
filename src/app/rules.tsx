import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, View } from 'react-native';
import { deleteRule, listLearnedRules } from '../db/repo';
import { useApp } from '../state/store';
import { Body, Button, Card, Empty, Muted, Row, useData } from '../ui/components';
import { space } from '../ui/theme';

export default function Rules() {
  const db = useSQLiteContext();
  const bump = useApp((s) => s.bump);
  const [rules] = useData(() => listLearnedRules(db));

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 60 }}>
      <Muted>When you change a transaction’s category, the app remembers that merchant here and applies it to future payments.</Muted>
      {rules?.length === 0 && <Empty title="Nothing learned yet" hint="Re-categorise a transaction to teach the app." />}
      {rules?.map((r) => (
        <Card key={r.id} style={{ padding: space.md }}>
          <Row>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '600' }}>{r.pattern}</Body>
              <Muted>→ {r.category_name}</Muted>
            </View>
            <Button
              title="Forget"
              kind="ghost"
              onPress={async () => {
                await deleteRule(db, r.id);
                bump();
              }}
            />
          </Row>
        </Card>
      ))}
    </ScrollView>
  );
}
