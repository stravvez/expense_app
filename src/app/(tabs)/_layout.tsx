import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useTheme } from '../../ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Filled glyph when the tab is selected, outline otherwise. */
const icon = (name: IconName, outline: IconName) =>
  function TabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? name : outline} color={typeof color === 'string' ? color : undefined} size={size} />;
  };

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: icon('pie-chart', 'pie-chart-outline') }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarIcon: icon('receipt', 'receipt-outline') }} />
      <Tabs.Screen name="splits" options={{ title: 'Splits', tabBarIcon: icon('people', 'people-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings', 'settings-outline') }} />
    </Tabs>
  );
}
