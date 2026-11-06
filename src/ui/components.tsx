import { useFocusEffect } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { formatINR } from '../core/money';
import { useApp } from '../state/store';
import { radius, space, useTheme } from './theme';

/** Run an async loader on focus and whenever data changes. */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []): [T | undefined, () => void] {
  const [data, setData] = useState<T>();
  const version = useApp((s) => s.dataVersion);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });
  const depKey = JSON.stringify(deps.map((d) => (d instanceof Date ? d.getTime() : d)));
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadRef.current().then((d) => alive && setData(d), (e) => console.warn(e));
      return () => {
        alive = false;
      };
      // re-run whenever data changes (version), on manual reload (tick) or when inputs change (depKey)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, tick, depKey])
  );
  return [data, () => setTick((t) => t + 1)];
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const t = useTheme();
  const s = [styles.card, { backgroundColor: t.card, borderColor: t.border }, style];
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [...s, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  ) : (
    <View style={s}>{children}</View>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[{ color: t.text, fontSize: 16, fontWeight: '700' }, style]}>{children}</Text>;
}

export function Muted({ children, style, numberOfLines }: { children: ReactNode; style?: object; numberOfLines?: number }) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: t.muted, fontSize: 13 }, style]}>
      {children}
    </Text>
  );
}

export function Body({ children, style, numberOfLines, selectable }: { children: ReactNode; style?: object; numberOfLines?: number; selectable?: boolean }) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} selectable={selectable} style={[{ color: t.text, fontSize: 15 }, style]}>
      {children}
    </Text>
  );
}

export function Amount({ paise, direction, style, size = 15 }: { paise: number; direction?: 'debit' | 'credit'; style?: object; size?: number }) {
  const t = useTheme();
  const color = direction === 'credit' ? t.success : t.text;
  return (
    <Text style={[{ color, fontSize: size, fontWeight: '700', fontVariant: ['tabular-nums'] }, style]}>
      {direction === 'credit' ? '+' : ''}
      {formatINR(paise)}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = { primary: t.primary, secondary: t.primarySoft, danger: t.dangerSoft, ghost: 'transparent' }[kind];
  const fg = { primary: '#fff', secondary: t.primary, danger: t.danger, ghost: t.primary }[kind];
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '700', fontSize: 15 }}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, color }: { label: string; selected?: boolean; onPress?: () => void; color?: string }) {
  const t = useTheme();
  const c = color ?? t.primary;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? c : t.border, backgroundColor: selected ? c + '22' : t.card }]}
    >
      <Text style={{ color: selected ? c : t.text, fontWeight: selected ? '700' : '500', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string }) {
  const t = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      {label ? <Muted>{label}</Muted> : null}
      <TextInput
        placeholderTextColor={t.muted}
        {...rest}
        style={[styles.input, { borderColor: t.border, color: t.text, backgroundColor: t.card }, style]}
      />
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}>{children}</View>;
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  const c = color ?? (value > 1 ? t.danger : value >= 0.8 ? t.warning : t.success);
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.track, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: c, borderRadius: 4 }} />
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ alignItems: 'center', padding: space.xl, gap: 6 }}>
      <Body style={{ fontWeight: '600' }}>{title}</Body>
      {hint ? <Muted style={{ textAlign: 'center' }}>{hint}</Muted> : null}
    </View>
  );
}

export function CategoryBadge({ icon, color, size = 36 }: { icon?: string | null; color?: string | null; size?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: (color ?? t.muted) + '22',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.48 }}>{icon ?? '❓'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
  btn: { height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
});
