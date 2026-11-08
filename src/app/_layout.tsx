import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import TxnCapture from '../../modules/txn-capture';
import { setupAlerts } from '../capture/alerts';
import { registerDrainTask } from '../capture/backgroundTask'; // also defines the task in global scope
import { drainNativeQueue, reparseSkipped } from '../capture/pipeline';
import { getMeta } from '../db/repo';
import { DB_NAME, migrate } from '../db/schema';
import { useApp } from '../state/store';
import { useTheme } from '../ui/theme';
import { refreshWidget } from '../widget/refresh';

/** Keeps the app in sync with GPay: processes native captures live, on resume, and in background. */
function CaptureBridge() {
  const db = useSQLiteContext();
  const bump = useApp((s) => s.bump);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const drain = () => {
      if (timer.current) clearTimeout(timer.current);
      // short debounce: the SMS and GPay notification for one payment arrive seconds apart
      timer.current = setTimeout(async () => {
        try {
          const stats = await drainNativeQueue(db);
          if (stats) bump();
        } catch (e) {
          console.warn('drain failed', e);
        }
      }, 1500);
    };

    setupAlerts().catch(() => {});
    registerDrainTask().catch((e) => console.warn('bg task', e));
    reparseSkipped(db)
      .then((s) => s && (s.inserted.length || s.merged) && bump())
      .catch((e) => console.warn('reparse failed', e));
    drain();

    const sub = TxnCapture?.addListener('onCaptured', drain);
    const app = AppState.addEventListener('change', (s) => s === 'active' && drain());
    const notif = Notifications.addNotificationResponseReceivedListener((r) => {
      const url = r.notification.request.content.data?.url;
      if (typeof url === 'string') router.push(url as never);
    });

    // keep the home-screen widget in step with every write the app makes
    refreshWidget();
    const unsubWidget = useApp.subscribe((s, prev) => {
      if (s.dataVersion !== prev.dataVersion) refreshWidget();
    });

    getMeta(db, 'onboarded').then((v) => {
      if (v !== '1') router.push('/onboarding');
    });

    return () => {
      sub?.remove();
      app.remove();
      notif.remove();
      unsubWidget();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [db, bump]);

  return null;
}

export default function RootLayout() {
  const t = useTheme();
  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
      <CaptureBridge />
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="transaction/[id]" options={{ title: 'Transaction' }} />
        <Stack.Screen name="split" options={{ title: 'Split bill', presentation: 'modal' }} />
        <Stack.Screen name="person/[id]" options={{ title: 'Person' }} />
        <Stack.Screen name="add-transaction" options={{ title: 'Add expense', presentation: 'modal' }} />
        <Stack.Screen name="categories" options={{ title: 'Categories & budgets' }} />
        <Stack.Screen name="review" options={{ title: 'Needs review' }} />
        <Stack.Screen name="rules" options={{ title: 'Learned rules' }} />
        <Stack.Screen name="recurring" options={{ title: 'Recurring payments' }} />
        <Stack.Screen name="onboarding" options={{ title: 'Set up auto-capture', presentation: 'modal' }} />
      </Stack>
    </SQLiteProvider>
  );
}
