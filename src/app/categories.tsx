import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { formatINR, toPaise } from '../core/money';
import { addCategory, deleteCategory, listCategories, updateCategory, type Category } from '../db/repo';
import { useApp } from '../state/store';
import { Body, Button, Card, CategoryBadge, Input, Muted, Row, Title, useData } from '../ui/components';
import { OTHER_COLOR, SERIES_LIGHT, space, useSeriesColor } from '../ui/theme';

function CategoryEditor({ c, onSaved }: { c: Category; onSaved: () => void }) {
  const db = useSQLiteContext();
  const series = useSeriesColor();
  const [name, setName] = useState(c.name);
  const [icon, setIcon] = useState(c.icon);
  const [budget, setBudget] = useState(c.budget_paise ? String(c.budget_paise / 100) : '');
  const [open, setOpen] = useState(false);

  const save = async () => {
    const b = budget.trim() ? toPaise(budget) : 0;
    await updateCategory(db, c.id, { name: name.trim() || c.name, icon: icon.trim() || c.icon, budget_paise: Number.isFinite(b) ? b : 0 });
    setOpen(false);
    onSaved();
  };

  return (
    <Card onPress={open ? undefined : () => setOpen(true)} style={{ padding: space.md }}>
      <Row>
        <CategoryBadge icon={c.icon} color={series(c.color)} />
        <Body style={{ flex: 1, fontWeight: '600' }}>{c.name}</Body>
        <Muted>{c.budget_paise ? `${formatINR(c.budget_paise, { decimals: false })}/mo` : 'No budget'}</Muted>
      </Row>
      {open && (
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <Row>
            <View style={{ width: 70 }}>
              <Input label="Icon" value={icon} onChangeText={setIcon} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Name" value={name} onChangeText={setName} />
            </View>
          </Row>
          <Input label="Monthly budget (₹), empty for none" keyboardType="decimal-pad" value={budget} onChangeText={setBudget} />
          <Muted>Colour</Muted>
          <Row style={{ flexWrap: 'wrap' }}>
            {SERIES_LIGHT.map((hex) => (
              <Pressable
                key={hex}
                accessibilityLabel={`Colour ${hex}`}
                onPress={async () => {
                  await updateCategory(db, c.id, { color: hex });
                  onSaved();
                }}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: series(hex),
                  borderWidth: c.color.toLowerCase() === hex ? 3 : 0,
                  borderColor: '#fff',
                }}
              />
            ))}
          </Row>
          {c.color.toLowerCase() === OTHER_COLOR && <Muted>Gray categories are grouped as “Other” in the donut chart.</Muted>}
          <Row>
            <Button title="Save" style={{ flex: 1 }} onPress={save} />
            <Button title="Cancel" kind="ghost" onPress={() => setOpen(false)} />
            <Button
              title="Delete"
              kind="danger"
              onPress={() =>
                Alert.alert(`Delete ${c.name}?`, 'Its transactions become uncategorized.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      await deleteCategory(db, c.id);
                      onSaved();
                    },
                  },
                ])
              }
            />
          </Row>
        </View>
      )}
    </Card>
  );
}

export default function Categories() {
  const db = useSQLiteContext();
  const bump = useApp((s) => s.bump);
  const [cats] = useData(() => listCategories(db));
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏷️');

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Muted>Tap a category to rename it or set a monthly budget. The dashboard warns you at 80% and when you go over.</Muted>
      {cats?.map((c) => <CategoryEditor key={`${c.id}-${c.name}-${c.budget_paise}-${c.color}`} c={c} onSaved={bump} />)}
      <Card>
        <Title>New category</Title>
        <Row>
          <View style={{ width: 70 }}>
            <Input value={icon} onChangeText={setIcon} />
          </View>
          <View style={{ flex: 1 }}>
            <Input placeholder="Name" value={name} onChangeText={setName} />
          </View>
        </Row>
        <Button
          title="Add"
          disabled={!name.trim()}
          onPress={async () => {
            await addCategory(db, name.trim(), icon || '🏷️', OTHER_COLOR);
            setName('');
            bump();
          }}
        />
      </Card>
    </ScrollView>
  );
}
